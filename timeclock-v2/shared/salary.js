// 薪資計算。工時一律由考勤推導；金額設定來自員工薪資設定（預設）與該月覆寫。
import { minutesToHours } from "./attendance.js";

export const DEFAULT_PROFILE = {
  payType: "hourly",        // "hourly" 時薪制 / "monthly" 月薪制
  hourlyRate: 0,
  monthlySalary: 0,
  otRate: null,             // 指定時固定加班時薪（舊版相容）；null 則依分段倍率 × 時薪
  monthlyOtPaid: false,     // 月薪制是否另計加班費（時薪 = 月薪 / 240）
  earnings: [],             // [{ label, amount }] 固定加給，例如全勤、職務加給
  deductions: [],           // [{ label, amount }] 固定扣款，例如勞保、健保
  roundNetUpTo: 1,          // 實發金額無條件進位到此單位（舊版為 100）
};

const num = (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb);

export function normalizeItems(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => ({ label: String(x?.label ?? "").trim().slice(0, 40), amount: num(x?.amount) }))
    .filter((x) => x.label);
}

export function normalizeProfile(input) {
  const p = { ...DEFAULT_PROFILE, ...(input || {}) };
  p.payType = p.payType === "monthly" ? "monthly" : "hourly";
  p.hourlyRate = num(p.hourlyRate);
  p.monthlySalary = num(p.monthlySalary);
  p.otRate = p.otRate == null || p.otRate === "" ? null : num(p.otRate);
  p.monthlyOtPaid = Boolean(p.monthlyOtPaid);
  p.earnings = normalizeItems(p.earnings);
  p.deductions = normalizeItems(p.deductions);
  p.roundNetUpTo = [1, 10, 100].includes(Number(p.roundNetUpTo)) ? Number(p.roundNetUpTo) : 1;
  return p;
}

// 該月紀錄可覆寫任何欄位；陣列欄位整個取代；另有一次性的 extraEarnings / extraDeductions（獎金、預支）
export function effectiveRecord(profile, monthRecord) {
  const base = normalizeProfile(profile);
  const m = monthRecord || {};
  const rec = { ...base };
  for (const k of ["payType", "hourlyRate", "monthlySalary", "otRate", "monthlyOtPaid", "roundNetUpTo"]) {
    if (m[k] !== undefined && m[k] !== null && m[k] !== "") rec[k] = m[k];
  }
  if (m.otRate === null) rec.otRate = null;
  if (Array.isArray(m.earnings)) rec.earnings = m.earnings;
  if (Array.isArray(m.deductions)) rec.deductions = m.deductions;
  rec.extraEarnings = normalizeItems(m.extraEarnings);
  rec.extraDeductions = normalizeItems(m.extraDeductions);
  const note = typeof m.note === "string" ? m.note.slice(0, 200) : "";
  return { ...normalizeProfile(rec), extraEarnings: rec.extraEarnings, extraDeductions: rec.extraDeductions, note };
}

const round2 = (n) => Math.round(n * 100) / 100;

// totals 來自 monthAttendance().totals
export function computePay(record, totals) {
  const rec = { ...normalizeProfile(record), extraEarnings: normalizeItems(record?.extraEarnings), extraDeductions: normalizeItems(record?.extraDeductions) };
  const t = totals || { baseMin: 0, otMin: 0, holidayMin: 0, segments: [] };
  const holidayRate = Number.isFinite(t.holidayRate) ? t.holidayRate : 2;

  const workHours = minutesToHours(t.baseMin);
  const holidayHours = minutesToHours(t.holidayMin);
  const otHours = minutesToHours(t.otMin);

  let hourly = rec.hourlyRate;
  let basePay;
  if (rec.payType === "monthly") {
    basePay = rec.monthlySalary;
    hourly = rec.monthlyOtPaid ? round2(rec.monthlySalary / 240) : 0;
  } else {
    basePay = round2(workHours * rec.hourlyRate);
  }
  const holidayPay = rec.payType === "monthly" ? 0 : round2(holidayHours * rec.hourlyRate * holidayRate);

  let otBreakdown = [];
  let otPay = 0;
  if (hourly > 0 && otHours > 0) {
    if (rec.otRate != null && rec.payType === "hourly") {
      otPay = round2(otHours * rec.otRate);
      otBreakdown = [{ hours: otHours, rate: null, unit: rec.otRate, pay: otPay }];
    } else {
      for (const seg of t.segments || []) {
        const hours = minutesToHours(seg.minutes);
        const unit = round2(hourly * seg.rate);
        const pay = round2(hours * unit);
        otBreakdown.push({ hours, rate: seg.rate, unit, pay });
        otPay += pay;
      }
      otPay = round2(otPay);
    }
  }

  const earnings = [...rec.earnings, ...rec.extraEarnings];
  const deductions = [...rec.deductions, ...rec.extraDeductions];
  const earningsTotal = round2(earnings.reduce((s, x) => s + x.amount, 0));
  const deductionsTotal = round2(deductions.reduce((s, x) => s + x.amount, 0));
  const gross = round2(basePay + holidayPay + otPay + earningsTotal);
  const net = round2(gross - deductionsTotal);
  const unit = rec.roundNetUpTo || 1;
  const netRounded = Math.ceil(net / unit) * unit;
  return {
    payType: rec.payType, workHours, holidayHours, otHours,
    hourlyRate: rec.hourlyRate, monthlySalary: rec.monthlySalary,
    basePay, holidayPay, otPay, otBreakdown, earnings, deductions, earningsTotal, deductionsTotal,
    gross, net, netRounded, note: typeof record?.note === "string" ? record.note : "",
  };
}
