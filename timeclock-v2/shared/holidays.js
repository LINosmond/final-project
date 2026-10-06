// 台灣國定假日。2025、2026 為行政院人事行政總處公告日期（含補假）；其他年份只用固定國曆日期保守判斷。
// 管理員可用覆寫（holiday / workday）修正任何一天。
export const TAIWAN_HOLIDAYS_BY_YEAR = {
  2025: [
    "2025-01-01", "2025-01-27", "2025-01-28", "2025-01-29", "2025-01-30", "2025-01-31",
    "2025-02-28", "2025-04-03", "2025-04-04", "2025-05-01", "2025-05-30", "2025-05-31",
    "2025-09-28", "2025-09-29", "2025-10-06", "2025-10-10", "2025-10-24", "2025-10-25", "2025-12-25",
  ],
  2026: [
    "2026-01-01", "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20",
    "2026-02-27", "2026-02-28", "2026-04-03", "2026-04-04", "2026-04-05", "2026-04-06", "2026-05-01",
    "2026-06-19", "2026-09-25", "2026-09-28", "2026-10-09", "2026-10-10", "2026-10-25", "2026-10-26", "2026-12-25",
  ],
};

export const FIXED_MD_HOLIDAYS = ["01-01", "02-28", "04-04", "05-01", "09-28", "10-10", "10-25", "12-25"];

export function isAutoHoliday(dateKey) {
  const list = TAIWAN_HOLIDAYS_BY_YEAR[Number(dateKey.slice(0, 4))];
  if (list) return list.includes(dateKey);
  return FIXED_MD_HOLIDAYS.includes(dateKey.slice(5));
}

export function hasExactHolidayData(year) { return Boolean(TAIWAN_HOLIDAYS_BY_YEAR[year]); }

// overrides: { "YYYY-MM-DD": "holiday" | "workday" }，也接受舊版的 true / false
export function normalizeOverrideKind(v) {
  if (v === true || v === "holiday") return "holiday";
  if (v === false || v === "workday") return "workday";
  return null;
}

export function resolveHoliday(dateKey, overrides) {
  const kind = overrides ? normalizeOverrideKind(overrides[dateKey]) : null;
  if (kind) return { isHoliday: kind === "holiday", source: "override" };
  const auto = isAutoHoliday(dateKey);
  return { isHoliday: auto, source: auto ? "auto" : null };
}
