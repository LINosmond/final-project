// 考勤計算：把打卡配對成時段、歸到日期、計算工時與加班。純函式，前後端共用。
import { localParts, monthDateKeys, addDays, parseYm } from "./time.js";
import { resolveHoliday } from "./holidays.js";

export const DEFAULT_RULES = {
  timezone: "Asia/Taipei",
  slotMinutes: 30,              // 打卡時間以幾分鐘為單位（整點／半點 = 30）
  standardDailyMinutes: 480,    // 一天正常工時，超過算加班
  maxShiftMinutes: 16 * 60,     // 上班後超過這麼久沒下班，視為漏打卡，不自動配對
  otMode: "tiers",              // "tiers"：依勞基法分段倍率；"simple"：單一倍率（舊版相容）
  otMultiplier: 2,              // simple 模式的倍率
  otTiers: [                    // tiers 模式：加班前 2 小時 1.34、再 2 小時 1.67、其後 2
    { upToMinutes: 120, rate: 1.34 },
    { upToMinutes: 240, rate: 1.67 },
    { upToMinutes: null, rate: 2 },
  ],
  holidayRate: 2,               // 國定假日全部工時倍率
};

export function normalizeRules(input) {
  const r = { ...DEFAULT_RULES, ...(input || {}) };
  const num = (v, fb, min = 0) => (Number.isFinite(Number(v)) && Number(v) >= min ? Number(v) : fb);
  r.slotMinutes = [5, 10, 15, 30, 60].includes(Number(r.slotMinutes)) ? Number(r.slotMinutes) : 30;
  r.standardDailyMinutes = num(r.standardDailyMinutes, 480, 0);
  r.maxShiftMinutes = num(r.maxShiftMinutes, 16 * 60, 60);
  r.otMode = r.otMode === "simple" ? "simple" : "tiers";
  r.otMultiplier = num(r.otMultiplier, 2, 0);
  r.holidayRate = num(r.holidayRate, 2, 0);
  if (!Array.isArray(r.otTiers) || !r.otTiers.length) r.otTiers = DEFAULT_RULES.otTiers;
  r.otTiers = r.otTiers
    .map((t) => ({ upToMinutes: t.upToMinutes == null ? null : num(t.upToMinutes, null, 1), rate: num(t.rate, 1, 0) }))
    .filter((t) => t.upToMinutes === null || t.upToMinutes > 0)
    .sort((a, b) => (a.upToMinutes === null ? 1 : b.upToMinutes === null ? -1 : a.upToMinutes - b.upToMinutes));
  if (r.otTiers[r.otTiers.length - 1].upToMinutes !== null) r.otTiers.push({ upToMinutes: null, rate: r.otTiers[r.otTiers.length - 1].rate });
  if (typeof r.timezone !== "string" || !r.timezone) r.timezone = "Asia/Taipei";
  return r;
}

// 把同一位員工的打卡（任意順序）配成「上班→下班」時段。
// 時段歸屬於「上班打卡」那一天，所以跨午夜的班會整段算在上班日。
export function pairSessions(punches, rules) {
  const r = normalizeRules(rules);
  const sorted = [...punches].filter((p) => p && (p.type === "in" || p.type === "out")).sort((a, b) => a.ts - b.ts || (a.type === "in" ? -1 : 1));
  const sessions = [];
  const unmatched = [];
  let open = null;
  const flag = (p, reason) => unmatched.push({ id: p.id, type: p.type, ts: p.ts, dateKey: localParts(p.ts, r.timezone).dateKey, reason });
  for (const p of sorted) {
    if (p.type === "in") {
      if (open) flag(open, "missing_out");
      open = p;
      continue;
    }
    if (!open) { flag(p, "missing_in"); continue; }
    const minutes = (p.ts - open.ts) / 60000;
    if (minutes <= 0 || minutes > r.maxShiftMinutes) {
      flag(open, "missing_out");
      flag(p, "missing_in");
      open = null;
      continue;
    }
    sessions.push({ inId: open.id, outId: p.id, inTs: open.ts, outTs: p.ts, minutes, dateKey: localParts(open.ts, r.timezone).dateKey });
    open = null;
  }
  if (open) flag(open, "missing_out");
  return { sessions, unmatched };
}

// 把一天的總工時拆成正常工時與加班（含分段倍率）
export function splitOvertime(totalMin, rules) {
  const r = normalizeRules(rules);
  const baseMin = Math.min(totalMin, r.standardDailyMinutes);
  const otMin = Math.max(totalMin - r.standardDailyMinutes, 0);
  const segments = [];
  if (otMin > 0) {
    if (r.otMode === "simple") {
      segments.push({ minutes: otMin, rate: r.otMultiplier });
    } else {
      let used = 0;
      for (const tier of r.otTiers) {
        const cap = tier.upToMinutes === null ? Infinity : tier.upToMinutes;
        const take = Math.min(otMin, cap) - used;
        if (take > 0) { segments.push({ minutes: take, rate: tier.rate }); used += take; }
        if (used >= otMin) break;
      }
    }
  }
  const weightedMin = baseMin + segments.reduce((s, seg) => s + seg.minutes * seg.rate, 0);
  return { baseMin, otMin, segments, weightedMin };
}

export function dayStats(dateKey, sessions, holiday, rules) {
  const r = normalizeRules(rules);
  const totalMin = sessions.reduce((s, x) => s + x.minutes, 0);
  if (holiday.isHoliday) {
    return {
      dateKey, sessions, totalMin, baseMin: 0, otMin: 0, holidayMin: totalMin, segments: [],
      weightedMin: totalMin * r.holidayRate, isHoliday: true, holidaySource: holiday.source,
    };
  }
  const split = splitOvertime(totalMin, r);
  return { dateKey, sessions, totalMin, ...split, holidayMin: 0, isHoliday: false, holidaySource: holiday.source };
}

function mergeSegments(days) {
  const byRate = new Map();
  for (const d of days) for (const seg of d.segments) byRate.set(seg.rate, (byRate.get(seg.rate) || 0) + seg.minutes);
  return [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, minutes]) => ({ rate, minutes }));
}

// 整月考勤。punches 應包含該月前後各一天的打卡，才能正確處理跨日班。
export function monthAttendance(punches, ym, holidayOverrides, rules) {
  const r = normalizeRules(rules);
  const { year, month } = parseYm(ym);
  const keys = monthDateKeys(year, month);
  const inMonth = new Set(keys);
  const { sessions, unmatched } = pairSessions(punches, r);
  const byDay = new Map(keys.map((k) => [k, []]));
  for (const s of sessions) if (inMonth.has(s.dateKey)) byDay.get(s.dateKey).push(s);
  const days = keys.map((k) => dayStats(k, byDay.get(k), resolveHoliday(k, holidayOverrides), r));
  const totals = {
    totalMin: days.reduce((s, d) => s + d.totalMin, 0),
    baseMin: days.reduce((s, d) => s + d.baseMin, 0),
    otMin: days.reduce((s, d) => s + d.otMin, 0),
    holidayMin: days.reduce((s, d) => s + d.holidayMin, 0),
    weightedMin: days.reduce((s, d) => s + d.weightedMin, 0),
    segments: mergeSegments(days),
    workDays: days.filter((d) => d.totalMin > 0).length,
    holidayRate: r.holidayRate,
  };
  return { ym, days, totals, unmatched: unmatched.filter((u) => inMonth.has(u.dateKey)), rules: r };
}

// 查詢某月需要抓多大範圍的打卡（前後各一天，涵蓋跨日）
export function monthFetchKeys(ym) {
  const { year, month } = parseYm(ym);
  const keys = monthDateKeys(year, month);
  return { from: addDays(keys[0], -1), to: addDays(keys[keys.length - 1], 1) };
}

export function minutesToHours(min, digits = 2) {
  return Math.round((min / 60) * 10 ** digits) / 10 ** digits;
}
