import { unauthorized, forbidden } from "../http.js";
import { employeeState, selfPunch, employeeMonth, employeePay, companySettings, getCompany } from "../services.js";
import { parseYm, prevYm, ymOf, localParts } from "../../shared/time.js";

function requireEmployee(ctx) {
  if (!ctx.user) throw unauthorized();
  if (ctx.user.role !== "employee") throw forbidden("not_employee", "此功能供員工使用");
  if (ctx.user.status === "pending") throw forbidden("pending", "帳號尚待管理員審核");
  if (ctx.user.status === "archived") throw forbidden("archived", "此帳號已停用");
  return getCompany(ctx.db, ctx.user.company_id);
}

export function registerEmployeeRoutes(router) {
  router.get("/api/me/today", (ctx) => {
    const company = requireEmployee(ctx);
    return employeeState(ctx.db, ctx.user, company);
  });

  router.post("/api/me/punch", (ctx) => {
    const company = requireEmployee(ctx);
    return selfPunch(ctx.db, ctx.user, company, ctx.body);
  });

  router.get("/api/me/months/:ym", (ctx) => {
    const company = requireEmployee(ctx);
    return employeeMonth(ctx.db, ctx.user, company, ctx.params.ym, { withPunches: true });
  });

  // 員工只看得到「已發佈」且公司開放查看的月份
  router.get("/api/me/salary/:ym", (ctx) => {
    const company = requireEmployee(ctx);
    if (!companySettings(company).salaryVisible) throw forbidden("salary_hidden", "管理員尚未開放查看薪資");
    if (!parseYm(ctx.params.ym)) throw forbidden("invalid_ym");
    const result = employeePay(ctx.db, ctx.user, company, ctx.params.ym);
    if (!result.published) throw forbidden("not_published", "此月份薪資尚未發佈");
    return { ym: result.ym, pay: result.pay, totals: result.totals };
  });

  router.get("/api/me/salary", (ctx) => {
    const company = requireEmployee(ctx);
    const tz = companySettings(company).rules.timezone;
    const p = localParts(Date.now(), tz);
    const prev = prevYm(p.year, p.month);
    const months = ctx.db.prepare("SELECT ym FROM salary_months WHERE employee_id = ? AND published = 1 ORDER BY ym DESC LIMIT 12").all(ctx.user.id).map((r) => r.ym);
    return { salaryVisible: companySettings(company).salaryVisible, defaultYm: ymOf(prev.year, prev.month), publishedMonths: months };
  });
}
