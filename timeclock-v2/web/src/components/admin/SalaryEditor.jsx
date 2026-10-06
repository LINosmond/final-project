import React, { useState } from "react";
import { api } from "../../api.js";
import PaySlip from "../PaySlip.jsx";
import Field from "../Field.jsx";

function ItemsEditor({ items, onChange, placeholder }) {
  const set = (i, k, v) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div className="stack">
      {items.map((x, i) => (
        <div className="row" key={i} style={{ flexWrap: "nowrap" }}>
          <input className="input sm" style={{ flex: 1 }} placeholder={placeholder} value={x.label} onChange={(e) => set(i, "label", e.target.value)} />
          <input className="input sm mono" style={{ width: 110, textAlign: "right" }} inputMode="decimal" value={x.amount} onChange={(e) => set(i, "amount", e.target.value)} />
          <button type="button" className="btn ghost sm" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="移除">✕</button>
        </div>
      ))}
      <button type="button" className="btn ghost sm" onClick={() => onChange([...items, { label: "", amount: "" }])}>＋ 新增一項</button>
    </div>
  );
}

export default function SalaryEditor({ row, ym, companyName, onClose, onSaved, onPrint, flash }) {
  const [profile, setProfile] = useState({ ...row.profile, otRate: row.profile.otRate ?? "" });
  const [monthRec, setMonthRec] = useState({ extraEarnings: [], extraDeductions: [], note: "", ...row.monthRecord });
  const [busy, setBusy] = useState(false);
  const setP = (k) => (e) => setProfile({ ...profile, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const saveProfile = async () => {
    setBusy(true);
    try {
      await api.put(`/api/admin/salary/${row.employee.id}/profile`, { ...profile, otRate: profile.otRate === "" ? null : profile.otRate });
      const r = await api.put(`/api/admin/salary/${row.employee.id}/months/${ym}`, {}); // 重新計算
      onSaved(r); flash("薪資設定已儲存", "success");
    } catch (e) { flash(e.message, "error"); }
    setBusy(false);
  };
  const saveMonth = async (published) => {
    setBusy(true);
    try {
      const r = await api.put(`/api/admin/salary/${row.employee.id}/months/${ym}`, { data: monthRec, ...(published === undefined ? {} : { published }) });
      onSaved(r); flash(published === undefined ? "本月資料已儲存" : published ? "已發佈給員工" : "已取消發佈", "success");
    } catch (e) { flash(e.message, "error"); }
    setBusy(false);
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
        <div className="row between" style={{ marginBottom: 10 }}><h2 style={{ margin: 0 }}>{row.employee.name} · {ym}</h2><div className="row"><button className="btn sm" onClick={onPrint}>列印</button><button className="btn ghost sm" onClick={onClose}>關閉</button></div></div>

        <PaySlip pay={row.pay} name={row.employee.name} ym={ym} companyName={companyName} />

        <div className="card">
          <h2>固定薪資設定（每月沿用）</h2>
          <div className="grid-2">
            <Field label="薪資類型"><select className="input" value={profile.payType} onChange={setP("payType")}><option value="hourly">時薪制</option><option value="monthly">月薪制</option></select></Field>
            {profile.payType === "hourly"
              ? <Field label="時薪"><input className="input mono" inputMode="decimal" value={profile.hourlyRate} onChange={setP("hourlyRate")} /></Field>
              : <Field label="月薪"><input className="input mono" inputMode="decimal" value={profile.monthlySalary} onChange={setP("monthlySalary")} /></Field>}
          </div>
          {profile.payType === "hourly" && <Field label="固定加班時薪（選填）" help="留空則依公司加班倍率 × 時薪分段計算"><input className="input mono" inputMode="decimal" value={profile.otRate} onChange={setP("otRate")} placeholder="依倍率計算" /></Field>}
          {profile.payType === "monthly" && <label className="row small muted" style={{ marginBottom: 12 }}><input type="checkbox" checked={profile.monthlyOtPaid} onChange={setP("monthlyOtPaid")} /> 月薪制另計加班費（時薪 = 月薪 ÷ 240）</label>}
          <Field label="固定加給"><ItemsEditor items={profile.earnings} onChange={(v) => setProfile({ ...profile, earnings: v })} placeholder="例如：全勤、職務加給" /></Field>
          <Field label="固定扣款"><ItemsEditor items={profile.deductions} onChange={(v) => setProfile({ ...profile, deductions: v })} placeholder="例如：勞保、健保" /></Field>
          <Field label="實發進位"><select className="input" value={profile.roundNetUpTo} onChange={setP("roundNetUpTo")}><option value={1}>不進位</option><option value={10}>進位到 10 元</option><option value={100}>進位到 100 元</option></select></Field>
          <button className="btn block" onClick={saveProfile} disabled={busy}>儲存固定設定</button>
        </div>

        <div className="card">
          <h2>本月專用</h2>
          <Field label="本月額外加給（獎金等）"><ItemsEditor items={monthRec.extraEarnings} onChange={(v) => setMonthRec({ ...monthRec, extraEarnings: v })} placeholder="例如：績效獎金" /></Field>
          <Field label="本月額外扣款（預支等）"><ItemsEditor items={monthRec.extraDeductions} onChange={(v) => setMonthRec({ ...monthRec, extraDeductions: v })} placeholder="例如：預支" /></Field>
          <Field label="備註（員工看得到）"><input className="input" value={monthRec.note} onChange={(e) => setMonthRec({ ...monthRec, note: e.target.value })} /></Field>
          <div className="row">
            <button className="btn" onClick={() => saveMonth()} disabled={busy}>儲存本月</button>
            {row.published
              ? <button className="btn danger" onClick={() => saveMonth(false)} disabled={busy}>取消發佈</button>
              : <button className="btn primary" onClick={() => saveMonth(true)} disabled={busy}>儲存並發佈給員工</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
