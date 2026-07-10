// 取代原本 window.storage 的資料層：
// - shared = true  的資料（employees / punches / holidays / companyLocation）存到 Google 試算表
// - shared = false 的資料（session，僅代表「這台裝置記得誰登入」）存在瀏覽器 localStorage，不需要跨裝置同步
const API_URL = import.meta.env.VITE_SHEETS_API_URL;
const API_KEY = import.meta.env.VITE_SHEETS_API_KEY || "";

const LOCAL_PREFIX = "tc_local_";

async function callApi(action, extra = {}) {
  if (!API_URL) {
    throw new Error("尚未設定 VITE_SHEETS_API_URL，請參考 README 設定 Apps Script 網址");
  }
  const res = await fetch(API_URL, {
    method: "POST",
    // 用 text/plain 避免瀏覽器對 Apps Script 發出 CORS 預檢請求（preflight）
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, apiKey: API_KEY, ...extra }),
  });
  if (!res.ok) throw new Error(`API 回應異常（HTTP ${res.status}）`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "API 回傳失敗");
  return data;
}

const storage = {
  async get(key, shared) {
    if (!shared) {
      const v = window.localStorage.getItem(LOCAL_PREFIX + key);
      return v == null ? null : { value: v };
    }
    const data = await callApi("get", { key });
    return data.value == null ? null : { value: data.value };
  },

  // 一次讀取多個共用資料，把原本的 N 次 Apps Script 往返縮成一次，大幅加快進站載入。
  // 回傳格式為 { key: 原始字串或 null }。
  async getAll(keys) {
    const data = await callApi("getAll", { keys });
    return data.values || {};
  },

  async set(key, value, shared) {
    if (!shared) {
      window.localStorage.setItem(LOCAL_PREFIX + key, value);
      return;
    }
    await callApi("set", { key, value });
  },

  async delete(key, shared) {
    if (!shared) {
      window.localStorage.removeItem(LOCAL_PREFIX + key);
      return;
    }
    await callApi("delete", { key });
  },

  // 登入／建立帳號用的原子操作：查詢與新增都在伺服器同一個鎖內完成，
  // 避免兩個裝置幾乎同時用同一個姓名登入時，其中一邊的帳號被覆蓋掉
  async findOrCreateEmployee(name, phone) {
    const data = await callApi("findOrCreateEmployee", { name, phone });
    return { employee: data.employee, created: data.created, employees: data.employees };
  },

  // 打卡用的原子操作：在伺服器端把新的打卡紀錄附加到既有清單，
  // 避免兩筆幾乎同時送出的打卡互相覆蓋掉對方
  async appendPunch(entry) {
    const data = await callApi("appendPunch", { entry });
    return data.punches;
  },

  // 管理員審核用的原子操作：decision 為 "approve"（通過）或 "reject"（拒絕移除）。
  // 在伺服器端讀取整包員工清單再修改寫回，避免與其他人同時申請時互相覆蓋。
  async reviewEmployee(id, decision) {
    const data = await callApi("reviewEmployee", { id, decision });
    return data.employees;
  },
};

window.storage = storage;

export default storage;
