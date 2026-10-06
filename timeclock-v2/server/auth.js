import { scryptSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { now } from "./db.js";

const SCRYPT_N = 16384;

export function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(String(password), salt, 32, { N: SCRYPT_N }).toString("base64url");
  return `scrypt$${SCRYPT_N}$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const expected = Buffer.from(parts[3], "base64url");
  const actual = scryptSync(String(password), parts[2], expected.length, { N: n });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function validPassword(pw) {
  return typeof pw === "string" && pw.length >= 6 && pw.length <= 72;
}

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const hashToken = (t) => createHash("sha256").update(t).digest("hex");

export function createSession(db, userId) {
  const token = randomBytes(32).toString("base64url");
  const t = now();
  db.prepare("INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)").run(hashToken(token), userId, t, t + SESSION_TTL_MS);
  return token;
}

export function findSession(db, token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.token_hash, s.expires_at, u.*, c.code AS company_code, c.name AS company_name, c.settings AS company_settings, c.location AS company_location
    FROM sessions s JOIN users u ON u.id = s.user_id JOIN companies c ON c.id = u.company_id
    WHERE s.token_hash = ?`).get(hashToken(token));
  if (!row) return null;
  if (row.expires_at <= now()) { db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(row.token_hash); return null; }
  return row;
}

export function deleteSession(db, token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function deleteUserSessions(db, userId) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function purgeExpiredSessions(db) {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
}

// 登入失敗節流：同一把 key 在 10 分鐘內失敗 10 次就暫時拒絕
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 10;

export function throttleBlocked(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (a.resetAt <= now()) { attempts.delete(key); return false; }
  return a.count >= MAX_FAILS;
}
export function throttleFail(key) {
  const a = attempts.get(key);
  if (!a || a.resetAt <= now()) attempts.set(key, { count: 1, resetAt: now() + WINDOW_MS });
  else a.count += 1;
  if (attempts.size > 10000) for (const [k, v] of attempts) if (v.resetAt <= now()) attempts.delete(k);
}
export function throttleReset(key) { attempts.delete(key); }
