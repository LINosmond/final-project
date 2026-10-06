// 商業邏輯：讀寫資料庫並呼叫 shared/ 的純函式。
import { uid, now, transaction, parseJson, audit } from "./db.js";
import { bad, notFound, conflict } from "./http.js";
import { normalizeRules, monthAttendance, pairSessions, monthFetchKeys } from "../shared/attendance.js";
import { normalizeProfile, effectiveRecord, computePay } from "../shared/salary.js";
import { dayRange, zonedToTs, parseDateKey, parseYm, addDays, parseHM, localParts, dateKeyOf } from "../shared/time.js";
import { normalizeOverrideKind } from "../shared/holidays.js";
import { distanceMeters } from "../shared/geo.js";
export { distanceMeters };

// ---------- 公司 ----------
export function companySettings(row) {
  const s = parseJson(row.settings ?? row.company_settings, {});
  return {
    rules: normalizeRules(s.rules),
    salaryVisible: s.salaryVisible === true,
    allowSelfRegister: s.allowSelfRegister !== false,
  };
}

export function companyLocation(row) {
  const loc = parseJson(row.location ?? row.company_location, null);
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng) || !(loc.radius > 0)) return null;
  return { lat: loc.lat, lng: loc.lng, radius: loc.radius, address: typeof loc.address === "string" ? loc.address : "" };
}

export function getCompany(db, id) {
  const row = db.prepare("SELECT * FROM companies WHERE id = ?").get(id);
  if (!row) throw notFound("company_not_found");
  return row;
}

export function createCompany(db, { name, code, adminName, adminLogin, adminPasswordHash }) {
  const n = String(name || "").trim(), c = String(code || "").trim().toLowerCase();
  if (!n) throw bad("invalid_name", "請輸入公司名稱");
  if (!/^[a-z0-9][a-z0-9-]{2,30}$/.test(c)) throw bad("invalid_code", "公司代碼需 3 到 31 碼，只能用小寫英數字與連字號");
  if (db.prepare("SELECT 1 FROM companies WHERE code = ?").get(c)) throw conflict("code_taken", "公司代碼已被使用");
  const companyId = uid(), adminId = uid(), t = now();
  transaction(db, () => {
    db.prepare("INSERT INTO companies(id, code, name, settings, location, created_at) VALUES (?,?,?,?,?,?)")
      .run(companyId, c, n, JSON.stringify({ rules: normalizeRules({}), salaryVisible: false, allowSelfRegister: true }), null, t);
    db.prepare("INSERT INTO users(id, company_id, role, name, login, password_hash, status, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(adminId, companyId, "admin", String(adminName || "管理員").trim() || "管理員", normalizeLogin(adminLogin), adminPasswordHash, "active", 0, t);
    audit(db, companyId, adminId, "company.create", companyId, { code: c });
  });
  return { companyId, adminId };
}

export function normalizeLogin(v) {
  const s = String(v || "").replace(/[\s-]/g, "").toLowerCase();
  if (s.length < 3 || s.length > 40) throw bad("invalid_login", "帳號需 3 到 40 碼（建議用手機號碼）");
  return s;
}

export function normalizeName(v) {
  const s = String(v || "").trim();
  if (!s || s.length > 30) throw bad("invalid_name", "請輸入姓名（30 字以內）");
  return s;
}

// ---------- 員工 ----------
export function publicUser(u) {
  return { id: u.id, name: u.name, role: u.role, status: u.status, sortOrder: u.sort_order };
}

export function listEmployees(db, companyId, { includeArchived = true, includeLogin = false } = {}) {
  const rows = db.prepare("SELECT * FROM users WHERE company_id = ? AND role = 'employee' ORDER BY sort_order, created_at").all(companyId);
  return rows.filter((u) => includeArchived || u.status !== "archived").map((u) => ({
    ...publicUser(u), ...(includeLogin ? { login: u.login, createdAt: u.created_at, archivedAt: u.archived_at } : {}),
  }));
}

export function getEmployee(db, companyId, id) {
  const u = db.prepare("SELECT * FROM users WHERE id = ? AND company_id = ? AND role = 'employee'").get(id, companyId);
  if (!u) throw notFound("employee_not_found", "找不到這位員工");
  return u;
}

export function nextSortOrder(db, companyId) {
  return (db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM users WHERE company_id = ?").get(companyId).m || 0) + 1;
}

// ---------- 打卡 ----------
function punchRows(db, employeeId, fromTs, toTs) {
  return db.prepare("SELECT id, type, ts, actual_ts, lat, lng, source FROM punches WHERE employee_id = ? AND deleted_at IS NULL AND ts >= ? AND ts < ? ORDER BY ts")
    .all(employeeId, fromTs, toTs).map(rowToPunch);
}

export function rowToPunch(r) {
  return { id: r.id, type: r.type, ts: r.ts, actualTs: r.actual_ts ?? null, lat: r.lat ?? null, lng: r.lng ?? null, source: r.source };
}

// 員工目前狀態：看最近兩天的打卡配對結果決定下一步是上班還是下班
export function employeeState(db, employee, company, nowTs = now()) {
  const { rules } = companySettings(company);
  const tz = rules.timezone;
  const today = dateKeyOf(nowTs, tz);
  const range = dayRange(today, tz);
  const from = range.start - rules.maxShiftMinutes * 60000;
  const punches = punchRows(db, employee.id, from, range.end + 24 * 3600 * 1000);
  const { sessions, unmatched } = pairSessions(punches, rules);
  const open = unmatched.find((u) => u.reason === "missing_out" && nowTs - u.ts <= rules.maxShiftMinutes * 60000 && punches[punches.length - 1]?.id === u.id);
  const todayPunches = punches.filter((p) => dateKeyOf(p.ts, tz) === today || sessions.some((s) => s.dateKey === today && (s.inId === p.id || s.outId === p.id)));
  return {
    dateKey: today,
    nextType: open ? "out" : "in",
    openSince: open ? open.ts : null,
    todayPunches,
    todaySessions: sessions.filter((s) => s.dateKey === today),
    todayMinutes: sessions.filter((s) => s.dateKey === today).reduce((s, x) => s + x.minutes, 0),
  };
}


const PUNCH_WINDOW_MS = 45 * 60 * 1000;

// 員工自己打卡：伺服器驗證順序、時間窗、定位、冪等
export function selfPunch(db, employee, company, body, nowTs = now()) {
  const { rules } = companySettings(company);
  const type = body.type === "out" ? "out" : body.type === "in" ? "in" : null;
  if (!type) throw bad("invalid_type", "打卡類型不正確");
  const ts = Number(body.ts);
  if (!Number.isFinite(ts)) throw bad("invalid_ts", "打卡時間不正確");
  if (Math.abs(ts - nowTs) > PUNCH_WINDOW_MS) throw bad("ts_out_of_window", "打卡時間與現在差距太大，請重新選擇");
  const clientId = typeof body.clientId === "string" && body.clientId.length >= 8 && body.clientId.length <= 80 ? body.clientId : null;

  if (clientId) {
    const dup = db.prepare("SELECT * FROM punches WHERE company_id = ? AND client_id = ?").get(company.id, clientId);
    if (dup) return { punch: rowToPunch(dup), duplicate: true, state: employeeState(db, employee, company, nowTs) };
  }

  const loc = companyLocation(company);
  if (loc) {
    const lat = Number(body.lat), lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw bad("location_required", "打卡需要提供目前位置，請開啟定位權限");
    const dist = distanceMeters(lat, lng, loc.lat, loc.lng);
    if (dist > loc.radius) throw bad("out_of_range", `你目前不在打卡範圍內（距離約 ${Math.round(dist)} 公尺，允許 ${loc.radius} 公尺）`);
  }

  const state = employeeState(db, employee, company, nowTs);
  if (state.nextType !== type) throw conflict("wrong_order", type === "in" ? "你還在上班中，請先打下班卡" : "尚未打上班卡");
  if (type === "out" && ts <= state.openSince) throw bad("ts_before_in", "下班時間不能早於上班時間");
  if (type === "in") {
    const lastToday = state.todayPunches[state.todayPunches.length - 1];
    if (lastToday && ts <= lastToday.ts) throw bad("ts_before_last", "上班時間不能早於上一筆打卡");
  }

  const id = uid();
  db.prepare("INSERT INTO punches(id, company_id, employee_id, type, ts, actual_ts, lat, lng, source, client_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, company.id, employee.id, type, ts, nowTs, Number.isFinite(Number(body.lat)) ? Number(body.lat) : null, Number.isFinite(Number(body.lng)) ? Number(body.lng) : null, "self", clientId, employee.id, nowTs);
  const row = db.prepare("SELECT * FROM punches WHERE id = ?").get(id);
  return { punch: rowToPunch(row), duplicate: false, state: employeeState(db, employee, company, nowTs) };
}

// ---------- 假日 ----------
export function holidayOverrides(db, companyId, year = null) {
  const rows = year
    ? db.prepare("SELECT date, kind FROM holiday_overrides WHERE company_id = ? AND date LIKE ?").all(companyId, `${year}-%`)
    : db.prepare("SELECT date, kind FROM holiday_overrides WHERE company_id = ?").all(companyId);
  const out = {};
  for (const r of rows) out[r.date] = r.kind;
  return out;
}

export function setHolidayOverride(db, companyId, actorId, date, kind) {
  if (!parseDateKey(date)) throw bad("invalid_date", "日期格式不正確");
  const k = kind == null || kind === "" || kind === "auto" ? null : normalizeOverrideKind(kind);
  if (kind != null && kind !== "" && kind !== "auto" && !k) throw bad("invalid_kind", "假日設定不正確");
  if (k) db.prepare("INSERT INTO holiday_overrides(company_id, date, kind) VALUES (?,?,?) ON CONFLICT(company_id, date) DO UPDATE SET kind = excluded.kind").run(companyId, date, k);
  else db.prepare("DELETE FROM holiday_overrides WHERE company_id = ? AND date = ?").run(companyId, date);
  audit(db, companyId, actorId, "holiday.set", date, { kind: k });
}

// ---------- 月考勤 ----------
export function employeeMonth(db, employee, company, ym, { withPunches = false } = {}) {
  if (!parseYm(ym)) throw bad("invalid_ym", "月份格式不正確");
  const { rules } = companySettings(company);
  const tz = rules.timezone;
  const { from, to } = monthFetchKeys(ym);
  const fromTs = dayRange(from, tz).start, toTs = dayRange(to, tz).end;
  const punches = punchRows(db, employee.id, fromTs, toTs);
  const overrides = holidayOverrides(db, company.id, ym.slice(0, 4));
  const result = monthAttendance(punches, ym, overrides, rules);
  if (withPunches) {
    const byId = new Map(punches.map((p) => [p.id, p]));
    for (const d of result.days) {
      d.sessions = d.sessions.map((s) => ({ ...s, in: byId.get(s.inId), out: byId.get(s.outId) }));
    }
    result.unmatched = result.unmatched.map((u) => ({ ...u, punch: byId.get(u.id) }));
  }
  return result;
}

// 管理員補登／修改某員工某一天：只動該天歸屬的打卡，其餘不碰
export function replaceDaySessions(db, company, employee, dateKey, sessionsInput, actorId) {
  if (!parseDateKey(dateKey)) throw bad("invalid_date", "日期格式不正確");
  if (!Array.isArray(sessionsInput) || sessionsInput.length > 6) throw bad("invalid_sessions", "時段格式不正確");
  const { rules } = companySettings(company);
  const tz = rules.timezone;
  const p = parseDateKey(dateKey);

  // 解析輸入：in/out 為 "HH:MM"，out 早於等於 in 代表跨到隔天
  const built = [];
  for (const s of sessionsInput) {
    const inMin = parseHM(s?.in), outMin = parseHM(s?.out);
    if (inMin == null && outMin == null) continue;
    if (inMin == null || outMin == null) throw bad("incomplete_session", "每個時段都要有上班和下班時間");
    let inTs = zonedToTs(p.year, p.month, p.day, Math.floor(inMin / 60), inMin % 60, tz);
    let outTs = zonedToTs(p.year, p.month, p.day, Math.floor(outMin / 60), outMin % 60, tz);
    if (outTs <= inTs) outTs += 24 * 3600 * 1000;
    if ((outTs - inTs) / 60000 > rules.maxShiftMinutes) throw bad("session_too_long", "單一時段超過允許的最長班距");
    built.push({ inTs, outTs });
  }
  built.sort((a, b) => a.inTs - b.inTs);
  for (let i = 1; i < built.length; i++) if (built[i].inTs < built[i - 1].outTs) throw bad("sessions_overlap", "時段互相重疊");

  // 找出目前歸屬於這一天的打卡：該日時段的上下班，加上該日未配對的打卡
  const range = dayRange(dateKey, tz);
  const existing = punchRows(db, employee.id, range.start - rules.maxShiftMinutes * 60000, range.end + rules.maxShiftMinutes * 60000);
  const { sessions, unmatched } = pairSessions(existing, rules);
  const removeIds = new Set();
  for (const s of sessions) if (s.dateKey === dateKey) { removeIds.add(s.inId); removeIds.add(s.outId); }
  for (const u of unmatched) if (u.dateKey === dateKey) removeIds.add(u.id);

  const t = now();
  transaction(db, () => {
    const del = db.prepare("UPDATE punches SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL");
    for (const id of removeIds) del.run(t, actorId, id);
    const ins = db.prepare("INSERT INTO punches(id, company_id, employee_id, type, ts, actual_ts, source, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const s of built) {
      ins.run(uid(), company.id, employee.id, "in", s.inTs, null, "admin", actorId, t);
      ins.run(uid(), company.id, employee.id, "out", s.outTs, null, "admin", actorId, t);
    }
    audit(db, company.id, actorId, "attendance.replace_day", `${employee.id}/${dateKey}`, { removed: removeIds.size, sessions: built.map((s) => [s.inTs, s.outTs]) });
  });
  return { removed: removeIds.size, added: built.length * 2 };
}

// ---------- 薪資 ----------
export function getProfile(db, employeeId) {
  const row = db.prepare("SELECT data FROM salary_profiles WHERE employee_id = ?").get(employeeId);
  return normalizeProfile(parseJson(row?.data, {}));
}

export function saveProfile(db, companyId, actorId, employeeId, data) {
  const profile = normalizeProfile(data);
  db.prepare("INSERT INTO salary_profiles(employee_id, data, updated_at) VALUES (?,?,?) ON CONFLICT(employee_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .run(employeeId, JSON.stringify(profile), now());
  audit(db, companyId, actorId, "salary.profile", employeeId, null);
  return profile;
}

export function getMonthRecord(db, employeeId, ym) {
  const row = db.prepare("SELECT data, published, updated_at FROM salary_months WHERE employee_id = ? AND ym = ?").get(employeeId, ym);
  return row ? { data: parseJson(row.data, {}), published: row.published === 1, updatedAt: row.updated_at } : { data: {}, published: false, updatedAt: null };
}

export function saveMonthRecord(db, companyId, actorId, employeeId, ym, data, published) {
  if (!parseYm(ym)) throw bad("invalid_ym", "月份格式不正確");
  const current = getMonthRecord(db, employeeId, ym);
  const nextData = data === undefined ? current.data : sanitizeMonthRecord(data);
  const nextPub = published === undefined ? current.published : Boolean(published);
  db.prepare("INSERT INTO salary_months(employee_id, ym, data, published, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(employee_id, ym) DO UPDATE SET data = excluded.data, published = excluded.published, updated_at = excluded.updated_at")
    .run(employeeId, ym, JSON.stringify(nextData), nextPub ? 1 : 0, now());
  audit(db, companyId, actorId, "salary.month", `${employeeId}/${ym}`, { published: nextPub });
  return { data: nextData, published: nextPub };
}

function sanitizeMonthRecord(input) {
  const out = {};
  const m = input || {};
  const numOrSkip = (k) => { if (m[k] !== undefined && m[k] !== null && m[k] !== "") { const n = Number(m[k]); if (Number.isFinite(n)) out[k] = n; } };
  ["hourlyRate", "monthlySalary", "roundNetUpTo"].forEach(numOrSkip);
  if (m.otRate === null) out.otRate = null; else numOrSkip("otRate");
  if (m.payType === "hourly" || m.payType === "monthly") out.payType = m.payType;
  if (typeof m.monthlyOtPaid === "boolean") out.monthlyOtPaid = m.monthlyOtPaid;
  for (const k of ["earnings", "deductions", "extraEarnings", "extraDeductions"]) if (Array.isArray(m[k])) out[k] = m[k].slice(0, 20);
  if (typeof m.note === "string") out.note = m.note.slice(0, 200);
  return out;
}

export function employeePay(db, employee, company, ym) {
  const month = employeeMonth(db, employee, company, ym);
  const profile = getProfile(db, employee.id);
  const rec = getMonthRecord(db, employee.id, ym);
  const effective = effectiveRecord(profile, rec.data);
  return { employee: publicUser(employee), ym, profile, monthRecord: rec.data, published: rec.published, effective, totals: month.totals, unmatched: month.unmatched.length, pay: computePay(effective, month.totals) };
}

// ---------- 備份／匯入 ----------
export function exportBackup(db, company) {
  const employees = db.prepare("SELECT * FROM users WHERE company_id = ? AND role = 'employee' ORDER BY sort_order").all(company.id);
  const punches = db.prepare("SELECT * FROM punches WHERE company_id = ? AND deleted_at IS NULL ORDER BY ts").all(company.id);
  const profiles = db.prepare("SELECT p.* FROM salary_profiles p JOIN users u ON u.id = p.employee_id WHERE u.company_id = ?").all(company.id);
  const months = db.prepare("SELECT m.* FROM salary_months m JOIN users u ON u.id = m.employee_id WHERE u.company_id = ?").all(company.id);
  return {
    format: "timeclock-v2", exportedAt: new Date().toISOString(),
    company: { code: company.code, name: company.name, settings: parseJson(company.settings, {}), location: parseJson(company.location, null) },
    employees: employees.map((u) => ({ id: u.id, name: u.name, login: u.login, status: u.status, sortOrder: u.sort_order, legacyId: u.legacy_id })),
    punches: punches.map((p) => ({ id: p.id, employeeId: p.employee_id, type: p.type, ts: p.ts, actualTs: p.actual_ts, lat: p.lat, lng: p.lng, source: p.source })),
    holidays: holidayOverrides(db, company.id),
    salaryProfiles: Object.fromEntries(profiles.map((p) => [p.employee_id, parseJson(p.data, {})])),
    salaryMonths: months.map((m) => ({ employeeId: m.employee_id, ym: m.ym, data: parseJson(m.data, {}), published: m.published === 1 })),
  };
}

// 匯入舊版（TimeClockWeb）備份：{ employees, punches, holidays, otMultiplier }
// 員工帳號 = 手機、初始密碼 = 手機（與舊版相同），請提醒員工登入後更改。
export function importLegacy(db, company, actorId, data, hashPassword) {
  if (!data || !Array.isArray(data.employees) || !Array.isArray(data.punches)) throw bad("invalid_backup", "備份檔格式不正確（需要 employees 與 punches）");
  const t = now();
  const report = { employeesAdded: 0, employeesMatched: 0, punchesAdded: 0, punchesSkipped: 0, holidays: 0 };
  transaction(db, () => {
    const idMap = new Map();
    let order = nextSortOrder(db, company.id);
    for (const e of data.employees) {
      if (!e || typeof e.id !== "string" || typeof e.name !== "string") continue;
      const existing = db.prepare("SELECT id FROM users WHERE company_id = ? AND legacy_id = ?").get(company.id, e.id)
        || (e.phone ? db.prepare("SELECT id FROM users WHERE company_id = ? AND login = ?").get(company.id, String(e.phone).replace(/[\s-]/g, "").toLowerCase()) : null);
      if (existing) { idMap.set(e.id, existing.id); report.employeesMatched++; continue; }
      const phone = String(e.phone || "").replace(/[\s-]/g, "").toLowerCase();
      const login = phone.length >= 3 ? phone : `legacy-${e.id.slice(0, 8)}`;
      const status = e.status === "pending" ? "pending" : e.status === "archived" ? "archived" : "active";
      const id = uid();
      db.prepare("INSERT INTO users(id, company_id, role, name, login, password_hash, status, sort_order, legacy_id, created_at, archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, company.id, "employee", e.name.trim().slice(0, 30) || "未命名", login, hashPassword(phone.length >= 6 ? phone : login), status, order++, e.id, t, status === "archived" ? t : null);
      idMap.set(e.id, id);
      report.employeesAdded++;
    }
    const ins = db.prepare("INSERT OR IGNORE INTO punches(id, company_id, employee_id, type, ts, actual_ts, source, client_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
    for (const p of data.punches) {
      const empId = p && idMap.get(p.employeeId);
      const ts = Number(p?.ts);
      if (!empId || (p.type !== "in" && p.type !== "out") || !Number.isFinite(ts) || typeof p.id !== "string") { report.punchesSkipped++; continue; }
      const r = ins.run(uid(), company.id, empId, p.type, ts, Number.isFinite(Number(p.actualTs)) ? Number(p.actualTs) : null, "legacy", `legacy:${p.id}`, actorId, t);
      if (r.changes) report.punchesAdded++; else report.punchesSkipped++;
    }
    if (data.holidays && typeof data.holidays === "object") {
      for (const [date, v] of Object.entries(data.holidays)) {
        const kind = normalizeOverrideKind(v);
        if (!kind || !parseDateKey(date)) continue;
        db.prepare("INSERT INTO holiday_overrides(company_id, date, kind) VALUES (?,?,?) ON CONFLICT(company_id, date) DO UPDATE SET kind = excluded.kind").run(company.id, date, kind);
        report.holidays++;
      }
    }
    if (typeof data.otMultiplier === "number" && data.otMultiplier > 0) {
      const s = parseJson(company.settings, {});
      s.rules = normalizeRules({ ...(s.rules || {}), otMode: "simple", otMultiplier: data.otMultiplier });
      db.prepare("UPDATE companies SET settings = ? WHERE id = ?").run(JSON.stringify(s), company.id);
    }
    audit(db, company.id, actorId, "import.legacy", null, report);
  });
  return report;
}
