import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, setupCompany, registerAndApprove } from "./helpers.mjs";
import { zonedToTs, dateKeyOf } from "../shared/time.js";

const TZ = "Asia/Taipei";
let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

test("初始設定只能做一次，之後登入走正常流程", async () => {
  const c = srv.client();
  assert.deepEqual((await c.get("/api/setup/status")).data, { needsSetup: true });
  const me = await setupCompany(c);
  assert.equal(me.user.role, "admin");
  assert.deepEqual((await c.get("/api/setup/status")).data, { needsSetup: false });
  assert.equal((await srv.client().post("/api/setup", { companyName: "x", companyCode: "other", adminLogin: "0900", adminPassword: "123456" })).status, 403);

  const fresh = srv.client();
  assert.equal((await fresh.get("/api/me")).status, 401);
  assert.equal((await fresh.post("/api/auth/login", { companyCode: "shop", login: "0911000000", password: "wrong" })).status, 401);
  const ok = await fresh.post("/api/auth/login", { companyCode: "shop", login: "0911-000-000", password: "admin123" });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.company.code, "shop");
  assert.equal((await fresh.post("/api/auth/logout")).status, 200);
  assert.equal((await fresh.get("/api/me")).status, 401);
});

test("員工申請後待審核，審核通過才能打卡；員工碰不到管理員 API", async () => {
  const admin = srv.client();
  await admin.post("/api/auth/login", { companyCode: "shop", login: "0911000000", password: "admin123" });
  const emp = srv.client();
  const reg = await emp.post("/api/auth/register", { companyCode: "shop", name: "小華", login: "0933000111", password: "secret1" });
  assert.equal(reg.status, 200);
  assert.equal(reg.data.user.status, "pending");
  assert.equal((await emp.get("/api/me/today")).status, 403);
  assert.equal((await emp.get("/api/admin/employees")).status, 403);

  // 同帳號不能重複申請
  assert.equal((await srv.client().post("/api/auth/register", { companyCode: "shop", name: "冒用", login: "0933000111", password: "secret1" })).status, 409);

  const list = await admin.get("/api/admin/employees");
  assert.equal(list.data.employees.find((e) => e.id === reg.data.user.id).status, "pending");
  await admin.post(`/api/admin/employees/${reg.data.user.id}/review`, { decision: "approve" });
  const today = await emp.get("/api/me/today");
  assert.equal(today.status, 200);
  assert.equal(today.data.nextType, "in");
});

test("打卡：順序、時間窗、冪等、跨日配對", async () => {
  const admin = srv.client();
  await admin.post("/api/auth/login", { companyCode: "shop", login: "0911000000", password: "admin123" });
  const { emp, id } = await registerAndApprove(admin, () => srv.client(), { name: "阿強", login: "0955000222" });

  const now = Date.now();
  const slot = Math.floor(now / 1800000) * 1800000; // 前一個半點
  // 不能先打下班
  assert.equal((await emp.post("/api/me/punch", { type: "out", ts: slot, clientId: "c-out-0000" })).status, 409);
  // 時間差太大
  assert.equal((await emp.post("/api/me/punch", { type: "in", ts: now - 3 * 3600 * 1000, clientId: "c-far-0000" })).data.error, "ts_out_of_window");
  const r1 = await emp.post("/api/me/punch", { type: "in", ts: slot, clientId: "c-in-00001" });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.state.nextType, "out");
  // 重送同一筆 → 冪等，不重複寫入
  const r1b = await emp.post("/api/me/punch", { type: "in", ts: slot, clientId: "c-in-00001" });
  assert.equal(r1b.data.duplicate, true);
  assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM punches WHERE employee_id = ?").get(id).n, 1);
  // 連續打上班被擋
  assert.equal((await emp.post("/api/me/punch", { type: "in", ts: slot, clientId: "c-in-00002" })).data.error, "wrong_order");
  // 下班不能早於上班
  assert.equal((await emp.post("/api/me/punch", { type: "out", ts: slot - 1800000, clientId: "c-out-0001" })).status, 400);
  const r2 = await emp.post("/api/me/punch", { type: "out", ts: slot + 1800000, clientId: "c-out-0002" });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.state.nextType, "in");
  assert.equal(r2.data.state.todayMinutes, 30);

  const ym = dateKeyOf(now, TZ).slice(0, 7);
  const month = await emp.get(`/api/me/months/${ym}`);
  assert.equal(month.status, 200);
  assert.equal(month.data.totals.totalMin, 30);
  assert.equal(month.data.days.length >= 28, true);
});

test("定位限制：未開啟時不需座標，開啟後距離外被擋", async () => {
  const admin = srv.client();
  await admin.post("/api/auth/login", { companyCode: "shop", login: "0911000000", password: "admin123" });
  const { emp } = await registerAndApprove(admin, () => srv.client(), { name: "阿美", login: "0966000333" });
  const s = await admin.put("/api/admin/settings", { location: { lat: 25.0330, lng: 121.5654, radius: 100, address: "台北 101" } });
  assert.equal(s.status, 200);
  assert.equal(s.data.location.radius, 100);
  const slot = Math.floor(Date.now() / 1800000) * 1800000;
  assert.equal((await emp.post("/api/me/punch", { type: "in", ts: slot, clientId: "geo-000001" })).data.error, "location_required");
  assert.equal((await emp.post("/api/me/punch", { type: "in", ts: slot, clientId: "geo-000002", lat: 25.05, lng: 121.5654 })).data.error, "out_of_range");
  const ok = await emp.post("/api/me/punch", { type: "in", ts: slot, clientId: "geo-000003", lat: 25.0331, lng: 121.5655 });
  assert.equal(ok.status, 200);
  await admin.put("/api/admin/settings", { location: null });
  assert.equal((await admin.get("/api/admin/settings")).data.location, null);
});

test("管理員單日補登只動該日，不影響其他天與其他人；稽核有紀錄", async () => {
  const admin = srv.client();
  await admin.post("/api/auth/login", { companyCode: "shop", login: "0911000000", password: "admin123" });
  const a = await registerAndApprove(admin, () => srv.client(), { name: "甲", login: "0977000444" });
  const b = await registerAndApprove(admin, () => srv.client(), { name: "乙", login: "0977000555" });

  // 直接寫入歷史打卡（模擬過去資料）
  const ins = srv.db.prepare("INSERT INTO punches(id, company_id, employee_id, type, ts, source, created_at) VALUES (?,?,?,?,?,?,?)");
  const company = srv.db.prepare("SELECT id FROM companies").get().id;
  const put = (emp, type, y, m, d, h, mi) => ins.run(crypto.randomUUID(), company, emp, type, zonedToTs(y, m, d, h, mi, TZ), "self", Date.now());
  put(a.id, "in", 2026, 1, 5, 9, 0); put(a.id, "out", 2026, 1, 5, 18, 0);
  put(a.id, "in", 2026, 1, 6, 9, 0); put(a.id, "out", 2026, 1, 6, 17, 0);
  put(a.id, "in", 2026, 1, 7, 22, 0); put(a.id, "out", 2026, 1, 8, 2, 0);  // 跨日班歸 1/7
  put(b.id, "in", 2026, 1, 5, 10, 0); put(b.id, "out", 2026, 1, 5, 15, 0);

  const before = await admin.get(`/api/admin/attendance/2026-01/${a.id}`);
  assert.equal(before.data.days.find((d) => d.dateKey === "2026-01-05").totalMin, 540);
  assert.equal(before.data.days.find((d) => d.dateKey === "2026-01-07").totalMin, 240);

  // 把 1/5 改成兩段，1/7 的跨日班改成 23:00–03:00
  const r = await admin.put(`/api/admin/attendance/${a.id}/days/2026-01-05`, { sessions: [{ in: "09:00", out: "12:00" }, { in: "13:00", out: "19:30" }] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.removed, r.data.added], [2, 4]);
  const r2 = await admin.put(`/api/admin/attendance/${a.id}/days/2026-01-07`, { sessions: [{ in: "23:00", out: "03:00" }] });
  assert.deepEqual([r2.data.removed, r2.data.added], [2, 2]);

  const after = await admin.get(`/api/admin/attendance/2026-01/${a.id}`);
  const d5 = after.data.days.find((d) => d.dateKey === "2026-01-05");
  assert.deepEqual([d5.totalMin, d5.baseMin, d5.otMin], [570, 480, 90]);
  assert.equal(after.data.days.find((d) => d.dateKey === "2026-01-06").totalMin, 480);   // 沒被動到
  assert.equal(after.data.days.find((d) => d.dateKey === "2026-01-07").totalMin, 240);
  assert.equal(after.data.days.find((d) => d.dateKey === "2026-01-08").totalMin, 0);
  const bMonth = await admin.get(`/api/admin/attendance/2026-01/${b.id}`);
  assert.equal(bMonth.data.totals.totalMin, 300);                                           // 乙完全沒被影響

  // 重疊、不完整、清空
  assert.equal((await admin.put(`/api/admin/attendance/${a.id}/days/2026-01-06`, { sessions: [{ in: "09:00", out: "12:00" }, { in: "11:00", out: "13:00" }] })).data.error, "sessions_overlap");
  assert.equal((await admin.put(`/api/admin/attendance/${a.id}/days/2026-01-06`, { sessions: [{ in: "09:00" }] })).data.error, "incomplete_session");
  const cleared = await admin.put(`/api/admin/attendance/${a.id}/days/2026-01-06`, { sessions: [] });
  assert.equal(cleared.data.month.days.find((d) => d.dateKey === "2026-01-06").totalMin, 0);
  // 舊的打卡是軟刪除，仍在資料庫可追查
  assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM punches WHERE employee_id = ? AND deleted_at IS NOT NULL").get(a.id).n, 6);

  const audit = await admin.get("/api/admin/audit?limit=5");
  assert.equal(audit.data.entries[0].action, "attendance.replace_day");

  const summary = await admin.get("/api/admin/attendance/2026-01");
  assert.equal(summary.data.rows.find((r) => r.employee.id === a.id).totals.totalMin, 570 + 240);

  const csv = await admin.raw("GET", "/api/admin/attendance-export/2026-01");
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.match(csv.data, /甲,2026-01-05,09:00-12:00 \/ 13:00-19:30/);
});

test("假日覆寫影響考勤；設定更新與規則正規化", async () => {
  const admin = srv.client();
  await admin.post("/api/auth/login", { companyCode: "shop", login: "0911000000", password: "admin123" });
  const h = await admin.get("/api/admin/holidays/2026");
  assert.equal(h.data.exact, true);
  assert.equal(h.data.auto.includes("2026-02-17"), true);
  await admin.put("/api/admin/holidays/2026-03-03", { kind: "holiday" });
  await admin.put("/api/admin/holidays/2026-02-17", { kind: "workday" });
  const h2 = await admin.get("/api/admin/holidays/2026");
  assert.deepEqual(h2.data.overrides, { "2026-03-03": "holiday", "2026-02-17": "workday" });
  await admin.put("/api/admin/holidays/2026-02-17", { kind: null });
  assert.deepEqual((await admin.get("/api/admin/holidays/2026")).data.overrides, { "2026-03-03": "holiday" });

  const s = await admin.put("/api/admin/settings", { rules: { otMode: "simple", otMultiplier: 1.5, slotMinutes: 15 }, salaryVisible: true, name: "新店名" });
  assert.equal(s.data.rules.otMultiplier, 1.5);
  assert.equal(s.data.rules.slotMinutes, 15);
  assert.equal(s.data.salaryVisible, true);
  assert.equal(s.data.name, "新店名");
  assert.equal((await admin.put("/api/admin/settings", { location: { lat: 999, lng: 0, radius: 100 } })).status, 400);
  await admin.put("/api/admin/settings", { rules: { otMode: "tiers", slotMinutes: 30 } });
});

test("薪資：設定、月覆寫、發佈後員工才看得到自己的", async () => {
  const admin = srv.client();
  await admin.post("/api/auth/login", { companyCode: "shop", login: "0911000000", password: "admin123" });
  const { emp, id } = await registerAndApprove(admin, () => srv.client(), { name: "丙", login: "0988000666" });
  const other = await registerAndApprove(admin, () => srv.client(), { name: "丁", login: "0988000777" });
  const ins = srv.db.prepare("INSERT INTO punches(id, company_id, employee_id, type, ts, source, created_at) VALUES (?,?,?,?,?,?,?)");
  const company = srv.db.prepare("SELECT id FROM companies").get().id;
  for (let d = 1; d <= 10; d++) {
    ins.run(crypto.randomUUID(), company, id, "in", zonedToTs(2025, 11, d, 9, 0, TZ), "self", Date.now());
    ins.run(crypto.randomUUID(), company, id, "out", zonedToTs(2025, 11, d, 19, 0, TZ), "self", Date.now()); // 10 小時 × 10 天
  }
  const prof = await admin.put(`/api/admin/salary/${id}/profile`, { payType: "hourly", hourlyRate: 200, deductions: [{ label: "勞保", amount: 758 }], roundNetUpTo: 100 });
  assert.equal(prof.status, 200);
  const rows = await admin.get("/api/admin/salary/2025-11");
  const mine = rows.data.rows.find((r) => r.employee.id === id);
  assert.equal(mine.pay.workHours, 80);
  assert.equal(mine.pay.otHours, 20);
  assert.equal(mine.pay.basePay, 16000);
  assert.deepEqual(mine.pay.otBreakdown.map((x) => x.rate), [1.34]); // 每天加班 2 小時都在第一段
  assert.equal(mine.pay.otPay, 20 * 268);
  assert.equal(mine.published, false);

  // 員工：公司已開放，但尚未發佈
  assert.equal((await emp.get("/api/me/salary/2025-11")).data.error, "not_published");
  const saved = await admin.put(`/api/admin/salary/${id}/months/2025-11`, { data: { extraEarnings: [{ label: "獎金", amount: 1000 }], note: "試用期結束" }, published: true });
  assert.equal(saved.data.pay.earningsTotal, 1000);
  const view = await emp.get("/api/me/salary/2025-11");
  assert.equal(view.status, 200);
  assert.equal(view.data.pay.netRounded, Math.ceil((16000 + 5360 + 1000 - 758) / 100) * 100);
  // 另一位員工看不到別人的，也看不到自己未發佈的
  assert.equal((await other.emp.get("/api/me/salary/2025-11")).data.error, "not_published");
  const list = await emp.get("/api/me/salary");
  assert.deepEqual(list.data.publishedMonths, ["2025-11"]);
  // 整月取消發佈
  await admin.post("/api/admin/salary/2025-11/publish", { published: false });
  assert.equal((await emp.get("/api/me/salary/2025-11")).status, 403);
});

test("帳號管理：改密碼使舊登入失效、封存後不能登入、排序", async () => {
  const admin = srv.client();
  await admin.post("/api/auth/login", { companyCode: "shop", login: "0911000000", password: "admin123" });
  const { emp, id } = await registerAndApprove(admin, () => srv.client(), { name: "戊", login: "0999000888" });
  assert.equal((await emp.get("/api/me")).status, 200);
  await admin.patch(`/api/admin/employees/${id}`, { password: "newpass1" });
  assert.equal((await emp.get("/api/me")).status, 401);
  const again = srv.client();
  assert.equal((await again.post("/api/auth/login", { companyCode: "shop", login: "0999000888", password: "newpass1" })).status, 200);
  assert.equal((await again.post("/api/me/password", { oldPassword: "wrong", newPassword: "abcdef" })).status, 400);
  assert.equal((await again.post("/api/me/password", { oldPassword: "newpass1", newPassword: "abcdef" })).status, 200);

  await admin.post(`/api/admin/employees/${id}/archive`, { archived: true });
  assert.equal((await again.get("/api/me/today")).status, 401);
  assert.equal((await srv.client().post("/api/auth/login", { companyCode: "shop", login: "0999000888", password: "abcdef" })).status, 403);
  const list = await admin.get("/api/admin/employees");
  assert.equal(list.data.employees.find((e) => e.id === id).status, "archived");
  assert.equal((await admin.get("/api/admin/attendance/2026-01")).data.rows.some((r) => r.employee.id === id), false);
  await admin.post(`/api/admin/employees/${id}/archive`, { archived: false });

  const ids = list.data.employees.map((e) => e.id).reverse();
  const ordered = await admin.put("/api/admin/employees/order", { ids });
  assert.deepEqual(ordered.data.employees.map((e) => e.id), ids);
});

test("匯入舊版備份：員工、打卡、假日、倍率；重複匯入不重複", async () => {
  const admin = srv.client();
  await admin.post("/api/auth/login", { companyCode: "shop", login: "0911000000", password: "admin123" });
  const legacy = {
    exportedAt: "2026-01-01T00:00:00Z",
    employees: [
      { id: "L1", name: "舊員工甲", phone: "0912345678", status: "active" },
      { id: "L2", name: "舊員工乙", phone: "0923456789", status: "pending" },
    ],
    punches: [
      { id: "p1", employeeId: "L1", employeeName: "舊員工甲", type: "in", ts: zonedToTs(2025, 12, 1, 9, 0, TZ), actualTs: 1 },
      { id: "p2", employeeId: "L1", employeeName: "舊員工甲", type: "out", ts: zonedToTs(2025, 12, 1, 18, 0, TZ) },
      { id: "p3", employeeId: "LX", type: "in", ts: 1 },
    ],
    holidays: { "2025-12-24": true, "2025-12-25": false },
    otMultiplier: 2,
  };
  const r = await admin.post("/api/admin/import-legacy", legacy);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { employeesAdded: 2, employeesMatched: 0, punchesAdded: 2, punchesSkipped: 1, holidays: 2 });
  const r2 = await admin.post("/api/admin/import-legacy", legacy);
  assert.deepEqual([r2.data.employeesAdded, r2.data.employeesMatched, r2.data.punchesAdded, r2.data.punchesSkipped], [0, 2, 0, 3]);

  // 舊員工用手機當帳號密碼登入
  const old = srv.client();
  const login = await old.post("/api/auth/login", { companyCode: "shop", login: "0912345678", password: "0912345678" });
  assert.equal(login.status, 200);
  const m = await old.get("/api/me/months/2025-12");
  assert.equal(m.data.days.find((d) => d.dateKey === "2025-12-01").totalMin, 540);
  assert.equal(m.data.days.find((d) => d.dateKey === "2025-12-24").isHoliday, true);
  assert.equal(m.data.days.find((d) => d.dateKey === "2025-12-25").isHoliday, false);
  assert.equal(m.data.rules.otMode, "simple");

  const backup = await admin.get("/api/admin/backup");
  assert.equal(backup.data.format, "timeclock-v2");
  assert.equal(backup.data.employees.some((e) => e.legacyId === "L1"), true);
});

test("跨站請求：帶了不同 Origin 的寫入被擋", async () => {
  const c = srv.client();
  const res = await c.raw("POST", "/api/auth/login", { companyCode: "shop", login: "0911000000", password: "admin123" }, { Origin: "https://evil.example" });
  assert.equal(res.status, 403);
});
