import { uid, now, audit } from "../db.js";
import { bad, unauthorized, forbidden, conflict, HttpError } from "../http.js";
import { hashPassword, verifyPassword, validPassword, createSession, deleteSession, throttleBlocked, throttleFail, throttleReset } from "../auth.js";
import { createCompany, companySettings, companyLocation, normalizeLogin, normalizeName, nextSortOrder, publicUser } from "../services.js";

function meResponse(ctx) {
  const u = ctx.user;
  const settings = companySettings(u);
  const loc = companyLocation(u);
  return {
    user: publicUser(u),
    company: {
      name: u.company_name, code: u.company_code,
      rules: settings.rules,
      salaryVisible: settings.salaryVisible,
      allowSelfRegister: settings.allowSelfRegister,
      location: loc ? { radius: loc.radius, address: loc.address, lat: loc.lat, lng: loc.lng } : null,
    },
  };
}

export function registerAuthRoutes(router) {
  // 首次安裝：資料庫裡還沒有任何公司時，開放建立第一家公司與管理員
  router.get("/api/setup/status", (ctx) => ({ needsSetup: ctx.db.prepare("SELECT COUNT(*) AS n FROM companies").get().n === 0 }));
  router.post("/api/setup", async (ctx) => {
    if (ctx.db.prepare("SELECT COUNT(*) AS n FROM companies").get().n > 0) throw forbidden("already_setup", "系統已完成初始設定");
    const b = ctx.body;
    if (!validPassword(b.adminPassword)) throw bad("weak_password", "管理員密碼至少 6 碼");
    const { adminId } = createCompany(ctx.db, { name: b.companyName, code: b.companyCode, adminName: b.adminName, adminLogin: b.adminLogin, adminPasswordHash: hashPassword(b.adminPassword) });
    const token = createSession(ctx.db, adminId);
    ctx.setSession(token);
    ctx.user = ctx.loadUser(token);
    return meResponse(ctx);
  });

  router.post("/api/auth/login", (ctx) => {
    const b = ctx.body;
    const code = String(b.companyCode || "").trim().toLowerCase();
    let login;
    try { login = normalizeLogin(b.login); } catch { throw unauthorized("bad_credentials", "帳號或密碼錯誤"); }
    const key = `login:${code}:${login}`;
    if (throttleBlocked(key) || throttleBlocked(`ip:${ctx.ip}`)) throw new HttpError(429, "too_many_attempts", "嘗試次數過多，請 10 分鐘後再試");
    const row = ctx.db.prepare("SELECT u.* FROM users u JOIN companies c ON c.id = u.company_id WHERE c.code = ? AND u.login = ?").get(code, login);
    if (!row || !verifyPassword(String(b.password ?? ""), row.password_hash)) {
      throttleFail(key); throttleFail(`ip:${ctx.ip}`);
      throw unauthorized("bad_credentials", "帳號或密碼錯誤");
    }
    if (row.status === "archived") throw forbidden("archived", "此帳號已停用，請聯絡管理員");
    throttleReset(key);
    const token = createSession(ctx.db, row.id);
    ctx.setSession(token);
    ctx.user = ctx.loadUser(token);
    audit(ctx.db, row.company_id, row.id, "auth.login", row.id, null);
    return meResponse(ctx);
  });

  // 員工自行申請帳號：建立後為「待審核」，管理員通過才能打卡
  router.post("/api/auth/register", (ctx) => {
    const b = ctx.body;
    const code = String(b.companyCode || "").trim().toLowerCase();
    const company = ctx.db.prepare("SELECT * FROM companies WHERE code = ?").get(code);
    if (!company) throw bad("company_not_found", "公司代碼不正確");
    if (!companySettings(company).allowSelfRegister) throw forbidden("register_disabled", "此公司不開放自行申請，請聯絡管理員");
    if (throttleBlocked(`register:${ctx.ip}`)) throw new HttpError(429, "too_many_attempts", "嘗試次數過多，請稍後再試");
    const name = normalizeName(b.name), login = normalizeLogin(b.login);
    if (!validPassword(b.password)) throw bad("weak_password", "密碼至少 6 碼");
    if (ctx.db.prepare("SELECT 1 FROM users WHERE company_id = ? AND login = ?").get(company.id, login)) { throttleFail(`register:${ctx.ip}`); throw conflict("login_taken", "這個帳號已經有人使用，若是你本人請直接登入"); }
    const id = uid();
    ctx.db.prepare("INSERT INTO users(id, company_id, role, name, login, password_hash, status, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, company.id, "employee", name, login, hashPassword(b.password), "pending", nextSortOrder(ctx.db, company.id), now());
    audit(ctx.db, company.id, id, "auth.register", id, null);
    const token = createSession(ctx.db, id);
    ctx.setSession(token);
    ctx.user = ctx.loadUser(token);
    return meResponse(ctx);
  });

  router.post("/api/auth/logout", (ctx) => {
    deleteSession(ctx.db, ctx.sessionToken);
    ctx.clearSession();
    return { ok: true };
  });

  router.get("/api/me", (ctx) => {
    if (!ctx.user) throw unauthorized();
    return meResponse(ctx);
  });

  router.post("/api/me/password", (ctx) => {
    if (!ctx.user) throw unauthorized();
    const b = ctx.body;
    if (!verifyPassword(String(b.oldPassword ?? ""), ctx.user.password_hash)) throw bad("wrong_password", "目前密碼不正確");
    if (!validPassword(b.newPassword)) throw bad("weak_password", "新密碼至少 6 碼");
    ctx.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(b.newPassword), ctx.user.id);
    audit(ctx.db, ctx.user.company_id, ctx.user.id, "auth.password", ctx.user.id, null);
    return { ok: true };
  });
}

export { meResponse };
