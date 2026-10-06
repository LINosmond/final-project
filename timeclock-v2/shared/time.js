// 時區相關的純函式。伺服器可能跑在 UTC，所有「哪一天」的判斷都必須用公司設定的時區計算。

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map();

function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function pad2(n) { return String(n).padStart(2, "0"); }

// 把時間戳拆成某時區的年月日時分秒
export function localParts(ts, tz) {
  const parts = {};
  for (const p of formatter(tz).formatToParts(new Date(ts))) parts[p.type] = p.value;
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  return {
    year, month, day,
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday],
    dateKey: `${year}-${pad2(month)}-${pad2(day)}`,
  };
}

export function dateKeyOf(ts, tz) { return localParts(ts, tz).dateKey; }

export function fmtHM(ts, tz) {
  const p = localParts(ts, tz);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

// 某時區的「年月日時分」換成時間戳（處理時區位移；台灣沒有日光節約時間，兩次修正即可收斂）
export function zonedToTs(year, month, day, hour = 0, minute = 0, tz) {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let ts = wanted;
  for (let i = 0; i < 3; i++) {
    const p = localParts(ts, tz);
    const got = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    if (got === wanted) break;
    ts += wanted - got;
  }
  return ts;
}

export function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { year: y, month: mo, day: d };
}

export function parseYm(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function ymOf(year, month) { return `${year}-${pad2(month)}`; }

export function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

export function addDays(dateKey, n) {
  const p = parseDateKey(dateKey);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function monthDateKeys(year, month) {
  const out = [];
  for (let d = 1; d <= daysInMonth(year, month); d++) out.push(`${year}-${pad2(month)}-${pad2(d)}`);
  return out;
}

// 某日在該時區的起訖時間戳 [start, end)
export function dayRange(dateKey, tz) {
  const p = parseDateKey(dateKey);
  const next = parseDateKey(addDays(dateKey, 1));
  return { start: zonedToTs(p.year, p.month, p.day, 0, 0, tz), end: zonedToTs(next.year, next.month, next.day, 0, 0, tz) };
}

export function monthRange(year, month, tz) {
  const start = zonedToTs(year, month, 1, 0, 0, tz);
  const ny = month === 12 ? year + 1 : year, nm = month === 12 ? 1 : month + 1;
  return { start, end: zonedToTs(ny, nm, 1, 0, 0, tz) };
}

export function prevYm(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function parseHM(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || "").trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}
