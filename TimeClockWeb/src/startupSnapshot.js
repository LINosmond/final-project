// Attendance-only preview, scoped to the existing admin session and this tab.
// Never store passwords, tokens, phones, salaries, declarations or location here.
export const SNAPSHOT_KEY = "timeclock:attendance-preview:v1";
export const SNAPSHOT_TTL_MS = 5 * 60 * 1000;

async function owner(crypto, token) {
  if (!crypto?.subtle || !token) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function attendance(data) {
  if (!data || !Array.isArray(data.employees) || !Array.isArray(data.punches)) return null;
  if (data.employees.some(e => !e || typeof e.id !== "string" || typeof e.name !== "string")) return null;
  if (data.punches.some(p => !p || typeof p.id !== "string" || typeof p.employeeId !== "string" ||
    !["in", "out"].includes(p.type) || !Number.isFinite(p.ts))) return null;
  if (!data.holidays || typeof data.holidays !== "object" || Array.isArray(data.holidays) ||
    Object.values(data.holidays).some(v => typeof v !== "boolean")) return null;
  if (!Number.isFinite(data.otMultiplier) || data.otMultiplier < 0) return null;
  return {
    employees: data.employees.map(({ id, name, status }) => ({ id, name, status })),
    punches: data.punches.map(({ id, employeeId, employeeName, type, ts, actualTs }) =>
      ({ id, employeeId, employeeName, type, ts, ...(Number.isFinite(actualTs) ? { actualTs } : {}) })),
    holidays: data.holidays,
    otMultiplier: data.otMultiplier,
  };
}

export async function readAdminSnapshot(storage, crypto, token, now = Date.now()) {
  try {
    const raw = storage?.getItem(SNAPSHOT_KEY);
    if (!raw || raw.length > 2 * 1024 * 1024) return null;
    const saved = JSON.parse(raw);
    const fingerprint = await owner(crypto, token);
    if (saved.version !== 1 || !Number.isFinite(saved.at) || saved.at > now ||
      now - saved.at > SNAPSHOT_TTL_MS || !fingerprint || saved.owner !== fingerprint) return null;
    const data = attendance(saved.data);
    return data ? { at: saved.at, data } : null;
  } catch { return null; }
}

export async function writeAdminSnapshot(storage, crypto, token, data, stillCurrent = () => true) {
  try {
    const preview = attendance(data);
    const fingerprint = await owner(crypto, token);
    if (!preview || !fingerprint || !stillCurrent()) return;
    const raw = JSON.stringify({ version: 1, owner: fingerprint, at: Date.now(), data: preview });
    if (raw.length <= 2 * 1024 * 1024) storage?.setItem(SNAPSHOT_KEY, raw);
  } catch { /* A storage quota/private browsing restriction must not block loading. */ }
}

export function clearAdminSnapshot(storage) {
  try { storage?.removeItem(SNAPSHOT_KEY); } catch { /* Optional preview only. */ }
}
