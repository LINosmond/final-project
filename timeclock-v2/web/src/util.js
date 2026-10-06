import { localParts, pad2, parseYm, ymOf } from "@shared/time.js";
import { minutesToHours } from "@shared/attendance.js";

export const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

export function fmtHM(ts, tz) { const p = localParts(ts, tz); return `${pad2(p.hour)}:${pad2(p.minute)}`; }
export function fmtDateTime(ts, tz) { const p = localParts(ts, tz); return `${p.month}/${p.day} ${pad2(p.hour)}:${pad2(p.minute)}`; }
export function fmtDateLabel(ts, tz) { const p = localParts(ts, tz); return `${p.month}/${p.day} 週${WEEKDAY[p.weekday]}`; }
export function hours(min) { if (!min) return "–"; const h = minutesToHours(min); return Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""); }
export function money(n) { return Number(n || 0).toLocaleString("zh-Hant-TW", { maximumFractionDigits: 2 }); }
export function currentYm(tz) { const p = localParts(Date.now(), tz); return ymOf(p.year, p.month); }
export function shiftYm(ym, delta) { const { year, month } = parseYm(ym); const d = new Date(Date.UTC(year, month - 1 + delta, 1)); return ymOf(d.getUTCFullYear(), d.getUTCMonth() + 1); }
export function ymLabel(ym) { const { year, month } = parseYm(ym); return `${year} 年 ${month} 月`; }
export function dateKeyParts(key) { const [y, m, d] = key.split("-").map(Number); return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; }
export const HALF_HOUR_SLOTS = Array.from({ length: 48 }, (_, i) => `${pad2(Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`);
export function slotOptions(step) {
  const out = [];
  for (let m = 0; m < 1440; m += step) out.push(`${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`);
  return out;
}
