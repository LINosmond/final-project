// 極簡 HTTP 路由與工具，不依賴外部套件。
import { StringDecoder } from "node:string_decoder";

export class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}
export const bad = (code, message) => new HttpError(400, code, message);
export const unauthorized = (code = "unauthorized", message = "請先登入") => new HttpError(401, code, message);
export const forbidden = (code = "forbidden", message = "沒有權限") => new HttpError(403, code, message);
export const notFound = (code = "not_found", message = "找不到資料") => new HttpError(404, code, message);
export const conflict = (code, message) => new HttpError(409, code, message);

const MAX_BODY = 5 * 1024 * 1024;

export function readJson(req) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder("utf8");
    let text = "", size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new HttpError(413, "too_large", "資料過大")); req.destroy(); return; }
      text += decoder.write(chunk);
    });
    req.on("end", () => {
      text += decoder.end();
      if (!text.trim()) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(bad("invalid_json", "JSON 格式錯誤")); }
    });
    req.on("error", reject);
  });
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function compile(pattern) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return "/([^/]+)"; }) + "/?$");
  return { re, keys };
}

export function createRouter() {
  const routes = [];
  const add = (method, pattern, handler) => routes.push({ method, ...compile(pattern), handler });
  return {
    get: (p, h) => add("GET", p, h),
    post: (p, h) => add("POST", p, h),
    put: (p, h) => add("PUT", p, h),
    patch: (p, h) => add("PATCH", p, h),
    delete: (p, h) => add("DELETE", p, h),
    match(method, pathname) {
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { handler: r.handler, params };
      }
      return pathMatched ? { methodNotAllowed: true } : null;
    },
  };
}

export function sendJson(res, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders });
  res.end(text);
}
