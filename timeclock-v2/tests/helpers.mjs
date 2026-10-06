import { openDb } from "../server/db.js";
import { createApp } from "../server/app.js";

// 啟動一個用記憶體資料庫的伺服器，回傳帶 cookie 的 client
export async function startTestServer() {
  const db = openDb(":memory:");
  const { server } = createApp({ db, staticDir: null, logger: { error: () => {} } });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  function client() {
    let cookie = "";
    async function call(method, path, body, headers = {}) {
      const res = await fetch(base + path, {
        method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data, headers: res.headers };
    }
    return {
      get: (p) => call("GET", p), post: (p, b = {}) => call("POST", p, b), put: (p, b = {}) => call("PUT", p, b), patch: (p, b = {}) => call("PATCH", p, b),
      raw: call,
    };
  }

  return { db, base, client, close: () => new Promise((r) => server.close(() => { db.close(); r(); })) };
}

export async function setupCompany(c, overrides = {}) {
  const res = await c.post("/api/setup", { companyName: "測試店", companyCode: "shop", adminName: "老闆", adminLogin: "0911000000", adminPassword: "admin123", ...overrides });
  if (res.status !== 200) throw new Error("setup failed: " + JSON.stringify(res.data));
  return res.data;
}

export async function registerAndApprove(admin, make, { name = "小明", login = "0922111222", password = "pass1234" } = {}) {
  const emp = make();
  const reg = await emp.post("/api/auth/register", { companyCode: "shop", name, login, password });
  if (reg.status !== 200) throw new Error("register failed: " + JSON.stringify(reg.data));
  const id = reg.data.user.id;
  const rev = await admin.post(`/api/admin/employees/${id}/review`, { decision: "approve" });
  if (rev.status !== 200) throw new Error("approve failed: " + JSON.stringify(rev.data));
  return { emp, id };
}
