import { createAppsScriptBridge } from "./appsScriptBridge.js";

// 取代原本 window.storage 的資料層：
// - shared = true  的資料（employees / punches / holidays / companyLocation）存到 Google 試算表
// - shared = false 的資料（session，僅代表「這台裝置記得誰登入」）存在瀏覽器 localStorage，不需要跨裝置同步
const API_URL = import.meta.env.VITE_SHEETS_API_URL;
const API_KEY = import.meta.env.VITE_SHEETS_API_KEY || "";

const LOCAL_PREFIX = "tc_local_";

// 管理員登入後由後端發給的憑證；之後每個請求都帶給後端驗證（後端才是真正的權限判斷）。密碼本身不保存。
let adminToken = "";
const REQUEST_TIMEOUT_MS = 20000;
// 整批讀取包含完整打卡歷史，Apps Script 實際回應可能超過 20 秒。
const BULK_READ_TIMEOUT_MS = 60000;
let requestSequence = 0;
let bridgeTransport;

function googleBridge() {
  if (typeof document === "undefined" || !window.addEventListener ||
    new URL(API_URL).hostname !== "script.google.com") return null;
  if (!bridgeTransport) bridgeTransport = createAppsScriptBridge({ apiUrl: API_URL, window, document });
  return bridgeTransport;
}

function requestUrl() {
  const url = new URL(API_URL);
  // ContentService 會轉到一次性回應網址；每次呼叫（含重試）都重新取得轉址。
  if (url.hostname === "script.google.com" && /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)) {
    url.searchParams.set("_tc", `${Date.now().toString(36)}-${++requestSequence}`);
  }
  return url.href;
}

function isGoogleResponse(res) {
  if (!res.redirected) return false;
  try {
    return new URL(API_URL).hostname === "script.google.com" &&
      new URL(res.url).hostname === "script.googleusercontent.com";
  } catch { return false; }
}

function apiError(message, code, retryable = false) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 單次呼叫 Apps Script（不含重試）
async function callApiOnce(action, extra = {}) {
  if (!API_URL) {
    throw apiError("尚未設定 VITE_SHEETS_API_URL，請參考 README 設定 Apps Script 網址", "CONFIG_ERROR");
  }
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(apiError("連線逾時，請確認網路後再試。", "TIMEOUT", true));
      controller.abort();
    }, action === "getAll" ? BULK_READ_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
  });
  try {
    const request = (async () => {
      const payload = { action, apiKey: API_KEY, ...(adminToken ? { adminToken } : {}), ...extra };
      const bridge = googleBridge();
      let data;
      if (bridge) {
        data = await bridge.request(payload, controller.signal);
      } else {
      const res = await fetch(requestUrl(), {
        method: "POST",
        cache: "no-store",
        // 用 text/plain 避免瀏覽器對 Apps Script 發出 CORS 預檢請求（preflight）
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        if (res.status === 404 && isGoogleResponse(res)) {
          throw apiError("Google 資料回應暫時無法取得，請稍後重新整理。", "GOOGLE_RESPONSE_ERROR", true);
        }
        const retryable = res.status === 408 || res.status === 429 || (res.status >= 500 && res.status <= 599);
        throw apiError(`API 回應異常（HTTP ${res.status}）`, "HTTP_ERROR", retryable);
      }
      data = await res.json();
      // Google 偶爾將回應轉回 /exec，POST 會變成 GET，只得到健康檢查而非資料。
      if (isGoogleResponse(res) && data?.ok === true &&
        data.message === "TimeClock API is running. 請用 POST 呼叫。") {
        throw apiError("Google 資料回應暫時無法取得，請稍後重新整理。", "GOOGLE_RESPONSE_ERROR", true);
      }
      }
      if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.ok !== "boolean") {
        throw apiError("伺服器回傳的資料格式不正確，請稍後重新整理。", "INVALID_RESPONSE");
      }
      if (!data.ok) {
        const message = typeof data.error === "string" ? data.error : "API 回傳失敗";
        const unsupported = /^unknown action(?:\s*:|$)/i.test(message.trim());
        const lockTimeout = /lock timeout|timeout exceeded waiting for (?:the )?lock/i.test(message);
        throw apiError(message, unsupported ? "UNSUPPORTED_ACTION" : "API_ERROR", lockTimeout);
      }
      return data;
    })();
    // race 同時限制 fetch 與回應本文讀取；即使傳輸沒有及時響應 abort 也能結束等待。
    return await Promise.race([request, timeout]);
  } catch (error) {
    if (error.code) throw error;
    if (error.name === "TypeError" || error.name === "NetworkError") {
      throw apiError("網路連線失敗，請確認網路後再試。", "NETWORK_ERROR", true);
    }
    throw apiError("伺服器回傳的資料格式不正確，請稍後重新整理。", "INVALID_RESPONSE");
  } finally {
    clearTimeout(timer);
  }
}

// 只為讀取與後端已去重的操作重試。Google 一次性回應網址失效最多重試兩次，其他暫時錯誤一次。
// 整包覆寫、刪除、審核不自動重送，
// 避免「伺服器已完成但回覆遺失」時再次覆蓋期間其他人的修改。
async function callApi(action, extra = {}) {
  const readOnly = action === "get" || action === "getAll" || action === "adminLogin" || action === "getMySalary";
  const idempotent = (action === "appendPunch" && Boolean(extra.entry?.id)) ||
    (action === "findOrCreateEmployee" && Boolean(extra.name && extra.phone));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await callApiOnce(action, extra);
    } catch (error) {
      const retries = error.code === "GOOGLE_RESPONSE_ERROR" ? 2 : 1;
      if (attempt < retries && error.retryable && (readOnly || idempotent)) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      if (!readOnly && ["TIMEOUT", "NETWORK_ERROR", "HTTP_ERROR", "GOOGLE_RESPONSE_ERROR", "INVALID_RESPONSE"].includes(error.code)) {
        error.message += " 操作結果尚未確認，請先重新整理核對，避免重複操作。";
        error.resultUnknown = true;
      }
      throw error;
    }
  }
}

const storage = {
  async get(key, shared) {
    if (!shared) {
      const v = window.localStorage.getItem(LOCAL_PREFIX + key);
      return v == null ? null : { value: v };
    }
    const data = await callApi("get", { key });
    if (!Object.prototype.hasOwnProperty.call(data, "value") || (data.value !== null && typeof data.value !== "string")) {
      throw apiError("伺服器回傳的資料不完整，請稍後重新整理。", "INVALID_RESPONSE");
    }
    return data.value == null ? null : { value: data.value };
  },

  // 一次讀取多個共用資料，把原本的 N 次 Apps Script 往返縮成一次，大幅加快進站載入。
  // 回傳格式為 { key: 原始字串或 null }。
  async getAll(keys) {
    const data = await callApi("getAll", { keys });
    const values = data.values;
    if (!values || typeof values !== "object" || Array.isArray(values) || keys.some((key) =>
      !Object.prototype.hasOwnProperty.call(values, key) || (values[key] !== null && typeof values[key] !== "string")
    )) {
      throw apiError("伺服器回傳的資料不完整，請稍後重新整理。", "INVALID_RESPONSE");
    }
    return values;
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

  setAdminToken(t) { adminToken = t || ""; },

  // 管理員登入：由後端比對密碼，成功回傳憑證字串，失敗回傳 ""；後端沒設定 ADMIN_PASSWORD 時丟出錯誤。
  async adminLogin(pw) {
    adminToken = "";
    const data = await callApi("adminLogin", { adminPassword: pw });
    adminToken = data.admin && typeof data.token === "string" ? data.token : "";
    return adminToken;
  },

  async adminLogout() {
    const t = adminToken;
    adminToken = "";
    if (t) { try { await callApiOnce("adminLogout", { adminToken: t }); } catch (e) { /* 忽略 */ } }
  },

  // 員工查看自己上個月薪資：以姓名＋手機號碼由後端驗證身分（不傳員工 ID）。
  async getMySalary(name, phone) {
    return await callApi("getMySalary", { name, phone });
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
