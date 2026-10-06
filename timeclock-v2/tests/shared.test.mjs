import { test } from "node:test";
import assert from "node:assert/strict";
import { localParts, zonedToTs, dateKeyOf, addDays, dayRange, parseHM } from "../shared/time.js";
import { resolveHoliday } from "../shared/holidays.js";
import { pairSessions, splitOvertime, monthAttendance, normalizeRules } from "../shared/attendance.js";
import { computePay, effectiveRecord } from "../shared/salary.js";

const TZ = "Asia/Taipei";
const at = (y, m, d, h, mi) => zonedToTs(y, m, d, h, mi, TZ);
let seq = 0;
const punch = (type, ts) => ({ id: `p${++seq}`, type, ts });

test("時區：台北日期與時間戳互換", () => {
  const ts = at(2026, 3, 1, 0, 30);
  assert.equal(dateKeyOf(ts, TZ), "2026-03-01");
  assert.equal(dateKeyOf(ts - 60 * 60000, TZ), "2026-02-28"); // 台北 23:30 前一天
  const p = localParts(ts, TZ);
  assert.deepEqual([p.hour, p.minute, p.weekday], [0, 30, 0]);
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  const r = dayRange("2026-03-01", TZ);
  assert.equal(r.end - r.start, 24 * 3600 * 1000);
  assert.equal(parseHM("09:30"), 570);
  assert.equal(parseHM("24:00"), null);
});

test("假日：公告日期、固定日期、覆寫", () => {
  assert.equal(resolveHoliday("2026-02-17", {}).isHoliday, true);
  assert.equal(resolveHoliday("2026-03-03", {}).isHoliday, false);
  assert.equal(resolveHoliday("2030-10-10", {}).isHoliday, true); // 沒有公告資料的年份用固定日期
  assert.equal(resolveHoliday("2026-02-17", { "2026-02-17": "workday" }).isHoliday, false);
  assert.deepEqual(resolveHoliday("2026-03-03", { "2026-03-03": true }), { isHoliday: true, source: "override" }); // 舊版 boolean
});

test("配對：兩段上下班、漏打卡、跨午夜歸屬上班日", () => {
  const ps = [
    punch("in", at(2026, 3, 2, 9, 0)), punch("out", at(2026, 3, 2, 12, 0)),
    punch("in", at(2026, 3, 2, 13, 0)), punch("out", at(2026, 3, 2, 18, 30)),
    punch("in", at(2026, 3, 3, 22, 0)), punch("out", at(2026, 3, 4, 2, 0)), // 晚班跨日
    punch("in", at(2026, 3, 5, 9, 0)),                                       // 忘了打下班
    punch("out", at(2026, 3, 6, 18, 0)),                                     // 忘了打上班
  ];
  const { sessions, unmatched } = pairSessions(ps, {});
  assert.equal(sessions.length, 3);
  assert.deepEqual(sessions.map((s) => [s.dateKey, s.minutes]), [["2026-03-02", 180], ["2026-03-02", 330], ["2026-03-03", 240]]);
  assert.deepEqual(unmatched.map((u) => [u.dateKey, u.reason]), [["2026-03-05", "missing_out"], ["2026-03-06", "missing_in"]]);
});

test("配對：超過最長班距不自動配對", () => {
  const ps = [punch("in", at(2026, 3, 2, 9, 0)), punch("out", at(2026, 3, 3, 9, 30))];
  const { sessions, unmatched } = pairSessions(ps, { maxShiftMinutes: 16 * 60 });
  assert.equal(sessions.length, 0);
  assert.equal(unmatched.length, 2);
});

test("加班：分段倍率與單一倍率", () => {
  const tiers = splitOvertime(480 + 200, {});
  assert.equal(tiers.baseMin, 480);
  assert.equal(tiers.otMin, 200);
  assert.deepEqual(tiers.segments, [{ minutes: 120, rate: 1.34 }, { minutes: 80, rate: 1.67 }]);
  const long = splitOvertime(480 + 300, {});
  assert.deepEqual(long.segments, [{ minutes: 120, rate: 1.34 }, { minutes: 120, rate: 1.67 }, { minutes: 60, rate: 2 }]);
  const simple = splitOvertime(600, { otMode: "simple", otMultiplier: 2 });
  assert.deepEqual(simple.segments, [{ minutes: 120, rate: 2 }]);
  assert.equal(simple.weightedMin, 480 + 240);
  assert.equal(splitOvertime(300, {}).otMin, 0);
});

test("整月考勤：假日加倍、合計、未配對只列當月", () => {
  const ps = [
    punch("in", at(2026, 3, 2, 9, 0)), punch("out", at(2026, 3, 2, 19, 0)),   // 10 小時 → 加班 2
    punch("in", at(2026, 3, 8, 10, 0)), punch("out", at(2026, 3, 8, 14, 0)),  // 覆寫為假日 4 小時
    punch("in", at(2026, 2, 28, 22, 0)), punch("out", at(2026, 3, 1, 2, 0)),  // 前月跨日班，不算這個月
    punch("in", at(2026, 3, 31, 23, 0)), punch("out", at(2026, 4, 1, 1, 0)),  // 本月最後一天跨日，算這個月
    punch("in", at(2026, 2, 27, 9, 0)),                                        // 前月漏打，不列
  ];
  const m = monthAttendance(ps, "2026-03", { "2026-03-08": "holiday" }, { otMode: "simple", otMultiplier: 2 });
  assert.equal(m.days.length, 31);
  const d2 = m.days.find((d) => d.dateKey === "2026-03-02");
  assert.deepEqual([d2.totalMin, d2.baseMin, d2.otMin, d2.weightedMin], [600, 480, 120, 720]);
  const d8 = m.days.find((d) => d.dateKey === "2026-03-08");
  assert.deepEqual([d8.isHoliday, d8.holidayMin, d8.weightedMin, d8.otMin], [true, 240, 480, 0]);
  assert.equal(m.days.find((d) => d.dateKey === "2026-03-01").totalMin, 0);
  assert.equal(m.days.find((d) => d.dateKey === "2026-03-31").totalMin, 120);
  assert.deepEqual([m.totals.baseMin, m.totals.otMin, m.totals.holidayMin, m.totals.workDays], [600, 120, 240, 3]);
  assert.deepEqual(m.totals.segments, [{ rate: 2, minutes: 120 }]);
  assert.equal(m.unmatched.length, 0);
});

test("規則正規化：壞值回預設、分段排序補尾", () => {
  const r = normalizeRules({ slotMinutes: 7, otTiers: [{ upToMinutes: 240, rate: 1.67 }, { upToMinutes: 120, rate: 1.34 }], holidayRate: "x" });
  assert.equal(r.slotMinutes, 30);
  assert.equal(r.holidayRate, 2);
  assert.deepEqual(r.otTiers.map((t) => t.upToMinutes), [120, 240, null]);
});

test("薪資：時薪制含分段加班、假日、加給扣款與進位", () => {
  const profile = { payType: "hourly", hourlyRate: 200, earnings: [{ label: "全勤", amount: 1000 }], deductions: [{ label: "勞保", amount: 758 }, { label: "健保", amount: 470 }], roundNetUpTo: 100 };
  const totals = { baseMin: 160 * 60, otMin: 180, holidayMin: 480, segments: [{ rate: 1.34, minutes: 120 }, { rate: 1.67, minutes: 60 }], holidayRate: 2 };
  const pay = computePay(effectiveRecord(profile, { extraEarnings: [{ label: "獎金", amount: 500 }], extraDeductions: [{ label: "預支", amount: 2000 }] }), totals);
  assert.equal(pay.basePay, 32000);
  assert.equal(pay.holidayPay, 8 * 200 * 2);
  assert.deepEqual(pay.otBreakdown.map((x) => [x.hours, x.unit, x.pay]), [[2, 268, 536], [1, 334, 334]]);
  assert.equal(pay.otPay, 870);
  assert.equal(pay.earningsTotal, 1500);
  assert.equal(pay.deductionsTotal, 3228);
  assert.equal(pay.gross, 32000 + 3200 + 870 + 1500);
  assert.equal(pay.net, pay.gross - 3228);
  assert.equal(pay.netRounded, Math.ceil(pay.net / 100) * 100);
});

test("薪資：舊版固定加班時薪、月薪制不計加班、月薪可選計加班", () => {
  const totals = { baseMin: 480, otMin: 120, holidayMin: 0, segments: [{ rate: 2, minutes: 120 }], holidayRate: 2 };
  const legacy = computePay(effectiveRecord({ payType: "hourly", hourlyRate: 196, otRate: 263 }, null), totals);
  assert.equal(legacy.otPay, 526);
  const monthly = computePay(effectiveRecord({ payType: "monthly", monthlySalary: 30000 }, null), totals);
  assert.deepEqual([monthly.basePay, monthly.otPay, monthly.gross], [30000, 0, 30000]);
  const monthlyOt = computePay(effectiveRecord({ payType: "monthly", monthlySalary: 24000, monthlyOtPaid: true }, null), totals);
  assert.equal(monthlyOt.otPay, 2 * 200); // 24000/240 = 100 × 2 倍 × 2 小時
  const override = computePay(effectiveRecord({ payType: "hourly", hourlyRate: 196 }, { hourlyRate: 200 }), totals);
  assert.equal(override.basePay, 1600);
});
