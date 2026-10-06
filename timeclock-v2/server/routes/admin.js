import { uid, now, audit, parseJson, transaction } from "../db.js";
import { bad, unauthorized, forbidden, notFound } from "../http.js";
import { hashPassword, validPassword, deleteUserSessions } from "../auth.js";
import {
  getCompany, companySettings, companyLocation, listEmployees, getEmployee, normalizeLogin, normalizeName, nextSortOrder, publicUser,
  employeeMonth, replaceDaySessions, holidayOverrides, setHolidayOverride,
  getProfile, saveProfile, getMonthRecord, saveMonthRecord, employeePay, exportBackup, importLegacy,
} from "../services.js";
import { normalizeRules, minutesToHours } from "../../shared/attendance.js";
import { parseYm, fmtHM, parseDateKey } from "../../shared/time.js";
import { hasExactHolidayData, isAutoHoliday } from "../../shared/holidays.js";

function requireAdmin(ctx) {
  if (!ctx.user) throw unauthorized();
  if (ctx.user.role !== "admin") throw forbidden("not_admin", "需要管理員權限");
  return getCompany(ctx.db, ctx.user.company_id);
}

function settingsResponse(company) {
  const s = companySettings(company);
  return { name: company.name, code: company.code, rules: s.rules, salaryVisible: s.salaryVisible, allowSelfRegister: s.allowSelfRegister, location: companyLocation(company) };
}

export function registerAdminRoutes(router) {
  // ---- 員工 ----
  router.get("/api/admin/employees", (ctx) => {
    const company = requireAdmin(ctx);
    return { employees: listEmployees(ctx.db, company.id, { includeLogin: true }) };
  });

  router.post("/api/admin/employees", (ctx) => {
    const company = requireAdmin(ctx);
    const name = normalizeName(ctx.body.name), login = normalizeLogin(ctx.body.login);
    if (!validPassword(ctx.body.password)) throw bad("weak_password", "密碼至少 6 碼");
    if (ctx.db.prepare("SELECT 1 FROM users WHERE company_id = ? AND login = ?").get(company.id, login)) throw bad("login_taken", "這個帳號已存在");
    const id = uid();
    ctx.db.prepare("INSERT INTO users(id, company_id, role, name, login, password_hash, status, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, company.id, "employee", name, login, hashPassword(ctx.body.password), "active", nextSortOrder(ctx.db, company.id), now());
    audit(ctx.db, company.id, ctx.user.id, "employee.create", id, { name });
    return { employees: listEmployees(ctx.db, company.id, { includeLogin: true }) };
  });

  router.patch("/api/admin/employees/:id", (ctx) => {
    const company = requireAdmin(ctx);
    const emp = getEmployee(ctx.db, company.id, ctx.params.id);
    const b = ctx.body;
    const changes = {};
    if (b.name !== undefined) changes.name = normalizeName(b.name);
    if (b.login !== undefined) {
      const login = normalizeLogin(b.login);
      if (login !== emp.login && ctx.db.prepare("SELECT 1 FROM users WHERE company_id = ? AND login = ?").get(company.id, login)) throw bad("login_taken", "這個帳號已存在");
      changes.login = login;
    }
    if (b.password !== undefined) {
      if (!validPassword(b.password)) throw bad("weak_password", "密碼至少 6 碼");
      changes.password_hash = hashPassword(b.password);
    }
    if (!Object.keys(changes).length) throw bad("nothing_to_update", "沒有要修改的欄位");
    const sets = Object.keys(changes).map((k) => `${k} = ?`).join(", ");
    ctx.db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).run(...Object.values(changes), emp.id);
    if (changes.password_hash) deleteUserSessions(ctx.db, emp.id);
    audit(ctx.db, company.id, ctx.user.id, "employee.update", emp.id, Object.keys(changes));
    return { employee: { ...publicUser({ ...emp, ...changes }), login: changes.login || emp.login } };
  });

  // 審核：approve 通過、reject 拒絕（刪除待審核帳號）
  router.post("/api/admin/employees/:id/review", (ctx) => {
    const company = requireAdmin(ctx);
    const emp = getEmployee(ctx.db, company.id, ctx.params.id);
    if (emp.status !== "pending") throw bad("not_pending", "此帳號不是待審核狀態");
    if (ctx.body.decision === "approve") ctx.db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(emp.id);
    else if (ctx.body.decision === "reject") { deleteUserSessions(ctx.db, emp.id); ctx.db.prepare("DELETE FROM users WHERE id = ?").run(emp.id); }
    else throw bad("invalid_decision", "決定需為 approve 或 reject");
    audit(ctx.db, company.id, ctx.user.id, `employee.${ctx.body.decision}`, emp.id, null);
    return { employees: listEmployees(ctx.db, company.id, { includeLogin: true }) };
  });

  // 封存／還原：封存後不能登入、不出現在名單，但歷史打卡保留
  router.post("/api/admin/employees/:id/archive", (ctx) => {
    const company = requireAdmin(ctx);
    const emp = getEmployee(ctx.db, company.id, ctx.params.id);
    if (typeof ctx.body.archived !== "boolean") throw bad("invalid_request");
    if (emp.status === "pending") throw bad("pending", "待審核帳號請用審核功能");
    if (ctx.body.archived) { ctx.db.prepare("UPDATE users SET status = 'archived', archived_at = ? WHERE id = ?").run(now(), emp.id); deleteUserSessions(ctx.db, emp.id); }
    else ctx.db.prepare("UPDATE users SET status = 'active', archived_at = NULL WHERE id = ?").run(emp.id);
    audit(ctx.db, company.id, ctx.user.id, ctx.body.archived ? "employee.archive" : "employee.restore", emp.id, null);
    return { employees: listEmployees(ctx.db, company.id, { includeLogin: true }) };
  });

  router.put("/api/admin/employees/order", (ctx) => {
    const company = requireAdmin(ctx);
    const ids = ctx.body.ids;
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) throw bad("invalid_request");
    transaction(ctx.db, () => {
      const upd = ctx.db.prepare("UPDATE users SET sort_order = ? WHERE id = ? AND company_id = ? AND role = 'employee'");
      ids.forEach((id, i) => upd.run(i + 1, id, company.id));
    });
    return { employees: listEmployees(ctx.db, company.id, { includeLogin: true }) };
  });

  // ---- 考勤 ----
  router.get("/api/admin/attendance/:ym", (ctx) => {
    const company = requireAdmin(ctx);
    if (!parseYm(ctx.params.ym)) throw bad("invalid_ym", "月份格式不正確");
    const employees = listEmployees(ctx.db, company.id, { includeArchived: ctx.query.get("includeArchived") === "1" }).filter((e) => e.status !== "pending");
    const rows = employees.map((e) => {
      const m = employeeMonth(ctx.db, { id: e.id }, company, ctx.params.ym);
      return { employee: e, totals: m.totals, unmatched: m.unmatched.length };
    });
    return { ym: ctx.params.ym, rows, rules: companySettings(company).rules };
  });

  router.get("/api/admin/attendance/:ym/:employeeId", (ctx) => {
    const company = requireAdmin(ctx);
    const emp = getEmployee(ctx.db, company.id, ctx.params.employeeId);
    return { employee: publicUser(emp), ...employeeMonth(ctx.db, emp, company, ctx.params.ym, { withPunches: true }) };
  });

  router.put("/api/admin/attendance/:employeeId/days/:date", (ctx) => {
    const company = requireAdmin(ctx);
    const emp = getEmployee(ctx.db, company.id, ctx.params.employeeId);
    const result = replaceDaySessions(ctx.db, company, emp, ctx.params.date, ctx.body.sessions, ctx.user.id);
    const ym = ctx.params.date.slice(0, 7);
    return { ...result, month: employeeMonth(ctx.db, emp, company, ym, { withPunches: true }) };
  });

  router.get("/api/admin/attendance-export/:ym", (ctx) => {
    const company = requireAdmin(ctx);
    if (!parseYm(ctx.params.ym)) throw bad("invalid_ym");
    const tz = companySettings(company).rules.timezone;
    const employees = listEmployees(ctx.db, company.id, { includeArchived: false }).filter((e) => e.status === "active");
    const lines = [["員工", "日期", "時段", "總工時(時)", "正常(時)", "加班(時)", "假日(時)", "加權工時(時)", "假日"]];
    for (const e of employees) {
      const m = employeeMonth(ctx.db, e, company, ctx.params.ym);
      for (const d of m.days) {
        if (!d.totalMin) continue;
        const seg = d.sessions.map((s) => `${fmtHM(s.inTs, tz)}-${fmtHM(s.outTs, tz)}`).join(" / ");
        lines.push([e.name, d.dateKey, seg, minutesToHours(d.totalMin), minutesToHours(d.baseMin), minutesToHours(d.otMin), minutesToHours(d.holidayMin), minutesToHours(d.weightedMin), d.isHoliday ? "是" : ""]);
      }
    }
    const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = "﻿" + lines.map((r) => r.map(esc).join(",")).join("\r\n");
    return { __raw: true, status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="attendance-${ctx.params.ym}.csv"` }, body: csv };
  });

  // ---- 假日 ----
  router.get("/api/admin/holidays/:year", (ctx) => {
    const company = requireAdmin(ctx);
    const year = Number(ctx.params.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw bad("invalid_year");
    const overrides = holidayOverrides(ctx.db, company.id, year);
    const auto = [];
    for (let m = 1; m <= 12; m++) for (let d = 1; d <= 31; d++) {
      const key = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (parseDateKey(key) && isAutoHoliday(key)) auto.push(key);
    }
    return { year, auto, overrides, exact: hasExactHolidayData(year) };
  });

  router.put("/api/admin/holidays/:date", (ctx) => {
    const company = requireAdmin(ctx);
    setHolidayOverride(ctx.db, company.id, ctx.user.id, ctx.params.date, ctx.body.kind);
    return { overrides: holidayOverrides(ctx.db, company.id, ctx.params.date.slice(0, 4)) };
  });

  // ---- 設定 ----
  router.get("/api/admin/settings", (ctx) => settingsResponse(requireAdmin(ctx)));

  router.put("/api/admin/settings", (ctx) => {
    const company = requireAdmin(ctx);
    const b = ctx.body;
    const s = parseJson(company.settings, {});
    let name = company.name;
    if (b.name !== undefined) { name = String(b.name).trim().slice(0, 60); if (!name) throw bad("invalid_name", "公司名稱不能空白"); }
    if (b.rules !== undefined) s.rules = normalizeRules({ ...(s.rules || {}), ...b.rules });
    if (b.salaryVisible !== undefined) s.salaryVisible = Boolean(b.salaryVisible);
    if (b.allowSelfRegister !== undefined) s.allowSelfRegister = Boolean(b.allowSelfRegister);
    let location = company.location;
    if (b.location !== undefined) {
      if (b.location === null) location = null;
      else {
        const lat = Number(b.location.lat), lng = Number(b.location.lng), radius = Number(b.location.radius);
        if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) throw bad("invalid_location", "經緯度不正確");
        if (!(radius >= 20 && radius <= 5000)) throw bad("invalid_radius", "範圍需在 20 到 5000 公尺之間");
        location = JSON.stringify({ lat, lng, radius, address: String(b.location.address || "").slice(0, 120) });
      }
    }
    ctx.db.prepare("UPDATE companies SET name = ?, settings = ?, location = ? WHERE id = ?").run(name, JSON.stringify(s), location, company.id);
    audit(ctx.db, company.id, ctx.user.id, "settings.update", null, Object.keys(b));
    return settingsResponse(getCompany(ctx.db, company.id));
  });

  // ---- 薪資 ----
  router.get("/api/admin/salary/:ym", (ctx) => {
    const company = requireAdmin(ctx);
    if (!parseYm(ctx.params.ym)) throw bad("invalid_ym");
    const employees = listEmployees(ctx.db, company.id, { includeArchived: ctx.query.get("includeArchived") === "1" }).filter((e) => e.status !== "pending");
    return { ym: ctx.params.ym, rows: employees.map((e) => employeePay(ctx.db, getEmployee(ctx.db, company.id, e.id), company, ctx.params.ym)) };
  });

  router.put("/api/admin/salary/:employeeId/profile", (ctx) => {
    const company = requireAdmin(ctx);
    const emp = getEmployee(ctx.db, company.id, ctx.params.employeeId);
    return { profile: saveProfile(ctx.db, company.id, ctx.user.id, emp.id, ctx.body) };
  });

  router.put("/api/admin/salary/:employeeId/months/:ym", (ctx) => {
    const company = requireAdmin(ctx);
    const emp = getEmployee(ctx.db, company.id, ctx.params.employeeId);
    saveMonthRecord(ctx.db, company.id, ctx.user.id, emp.id, ctx.params.ym, ctx.body.data, ctx.body.published);
    return employeePay(ctx.db, emp, company, ctx.params.ym);
  });

  // 一鍵發佈／取消整月所有員工
  router.post("/api/admin/salary/:ym/publish", (ctx) => {
    const company = requireAdmin(ctx);
    if (!parseYm(ctx.params.ym)) throw bad("invalid_ym");
    const published = Boolean(ctx.body.published);
    const employees = listEmployees(ctx.db, company.id, { includeArchived: false }).filter((e) => e.status === "active");
    transaction(ctx.db, () => { for (const e of employees) saveMonthRecord(ctx.db, company.id, ctx.user.id, e.id, ctx.params.ym, undefined, published); });
    return { ym: ctx.params.ym, published, count: employees.length };
  });

  // ---- 備份／匯入／稽核 ----
  router.get("/api/admin/backup", (ctx) => exportBackup(ctx.db, requireAdmin(ctx)));

  router.post("/api/admin/import-legacy", (ctx) => {
    const company = requireAdmin(ctx);
    return importLegacy(ctx.db, company, ctx.user.id, ctx.body, hashPassword);
  });

  router.get("/api/admin/audit", (ctx) => {
    const company = requireAdmin(ctx);
    const limit = Math.min(Number(ctx.query.get("limit")) || 100, 500);
    const rows = ctx.db.prepare("SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE a.company_id = ? ORDER BY a.id DESC LIMIT ?").all(company.id, limit);
    return { entries: rows.map((r) => ({ id: r.id, at: r.at, action: r.action, target: r.target, actor: r.actor_name, detail: parseJson(r.detail, null) })) };
  });
}
