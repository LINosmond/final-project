import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRouter, HttpError, readJson, parseCookies, sendJson } from "./http.js";
import { findSession, purgeExpiredSessions } from "./auth.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerEmployeeRoutes } from "./routes/me.js";
import { registerAdminRoutes } from "./routes/admin.js";

const COOKIE = "tc_session";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };

export function createApp({ db, staticDir = null, trustProxy = false, logger = console }) {
  const router = createRouter();
  registerAuthRoutes(router);
  registerEmployeeRoutes(router);
  registerAdminRoutes(router);
  purgeExpiredSessions(db);
  setInterval(() => { try { purgeExpiredSessions(db); } catch {} }, 6 * 3600 * 1000).unref();

  function clientIp(req) {
    if (trustProxy) { const xf = req.headers["x-forwarded-for"]; if (xf) return String(xf).split(",")[0].trim(); }
    return req.socket.remoteAddress || "";
  }
  function isSecure(req) {
    if (trustProxy && req.headers["x-forwarded-proto"]) return String(req.headers["x-forwarded-proto"]).split(",")[0].trim() === "https";
    return Boolean(req.socket.encrypted);
  }

  function serveStatic(req, res, pathname) {
    if (!staticDir) { sendJson(res, 404, { error: "not_found", message: "找不到頁面" }); return; }
    let rel = decodeURIComponent(pathname);
    if (rel.includes("\0") || rel.includes("..")) { res.writeHead(400); res.end(); return; }
    let file = path.join(staticDir, rel);
    if (!file.startsWith(staticDir)) { res.writeHead(403); res.end(); return; }
    let stat = fs.existsSync(file) ? fs.statSync(file) : null;
    if (!stat || stat.isDirectory()) { file = path.join(staticDir, "index.html"); stat = fs.existsSync(file) ? fs.statSync(file) : null; }
    if (!stat) { res.writeHead(404); res.end("not found"); return; }
    const ext = path.extname(file);
    const immutable = /\/assets\//.test(file);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Content-Length": stat.size, "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
    if (req.method === "HEAD") { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
      return serveStatic(req, res, url.pathname);
    }
    const matched = router.match(req.method, url.pathname);
    if (!matched) return sendJson(res, 404, { error: "not_found", message: "找不到這個 API" });
    if (matched.methodNotAllowed) return sendJson(res, 405, { error: "method_not_allowed" });

    // 同站 cookie 之外再擋一次跨站寫入：有 Origin 的非 GET 請求必須與 Host 同源
    if (req.method !== "GET" && req.headers.origin) {
      const host = (trustProxy && req.headers["x-forwarded-host"]) || req.headers.host;
      let originHost = null;
      try { originHost = new URL(req.headers.origin).host; } catch {}
      if (!host || originHost !== host) return sendJson(res, 403, { error: "bad_origin", message: "來源不被允許" });
    }

    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies[COOKIE] || null;
    const secure = isSecure(req);
    const ctx = {
      db, req, res, params: matched.params, query: url.searchParams, body: {},
      ip: clientIp(req), sessionToken,
      user: findSession(db, sessionToken),
      loadUser: (token) => findSession(db, token),
      setSession(token) { res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure ? "; Secure" : ""}`); },
      clearSession() { res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`); },
    };
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        ctx.body = await readJson(req);
        if (!ctx.body || typeof ctx.body !== "object" || Array.isArray(ctx.body)) ctx.body = {};
      }
      const out = await matched.handler(ctx);
      if (out && out.__raw) { res.writeHead(out.status || 200, { "Cache-Control": "no-store", ...out.headers }); res.end(out.body); return; }
      sendJson(res, 200, out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.code, message: e.message });
      logger.error("[api]", req.method, url.pathname, e);
      sendJson(res, 500, { error: "internal", message: "伺服器發生錯誤，請稍後再試" });
    }
  }

  const server = http.createServer((req, res) => { handle(req, res).catch((e) => { logger.error(e); try { sendJson(res, 500, { error: "internal" }); } catch {} }); });
  return { server, router };
}
