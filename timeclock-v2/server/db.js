import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  location TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  role TEXT NOT NULL CHECK (role IN ('admin','employee')),
  name TEXT NOT NULL,
  login TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','active','archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  legacy_id TEXT,
  created_at INTEGER NOT NULL,
  archived_at INTEGER,
  UNIQUE (company_id, login)
);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id, status, sort_order);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS punches (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  employee_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('in','out')),
  ts INTEGER NOT NULL,
  actual_ts INTEGER,
  lat REAL,
  lng REAL,
  source TEXT NOT NULL DEFAULT 'self',
  client_id TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT,
  UNIQUE (company_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_punches_emp_ts ON punches(employee_id, ts);
CREATE INDEX IF NOT EXISTS idx_punches_company_ts ON punches(company_id, ts);

CREATE TABLE IF NOT EXISTS holiday_overrides (
  company_id TEXT NOT NULL REFERENCES companies(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('holiday','workday')),
  PRIMARY KEY (company_id, date)
);

CREATE TABLE IF NOT EXISTS salary_profiles (
  employee_id TEXT PRIMARY KEY REFERENCES users(id),
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS salary_months (
  employee_id TEXT NOT NULL REFERENCES users(id),
  ym TEXT NOT NULL,
  data TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (employee_id, ym)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_log(company_id, at);
`;

export function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  db.prepare("INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1')").run();
  return db;
}

export const uid = () => randomUUID();
export const now = () => Date.now();

export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function parseJson(text, fallback) {
  if (text == null || text === "") return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

export function audit(db, companyId, actorId, action, target, detail) {
  db.prepare("INSERT INTO audit_log(company_id, actor_id, action, target, detail, at) VALUES (?,?,?,?,?,?)")
    .run(companyId, actorId || null, action, target || null, detail == null ? null : JSON.stringify(detail), now());
}
