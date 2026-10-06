import React from "react";
import { money, hours } from "../util.js";

export default function PaySlip({ pay, name, ym, companyName }) {
  return (
    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>{companyName} · 薪資明細</h2><span className="mono muted">{ym}</span></div>
      <div style={{ fontWeight: 600, margin: "6px 0 12px" }}>{name}</div>
      <div className="kv">
        {pay.payType === "monthly"
          ? <><span>月薪</span><span className="v">{money(pay.monthlySalary)}</span></>
          : <><span>正常工時 {pay.workHours} 小時 × {money(pay.hourlyRate)}</span><span className="v">{money(pay.basePay)}</span></>}
        {pay.holidayPay > 0 && <><span>假日工時 {pay.holidayHours} 小時</span><span className="v">{money(pay.holidayPay)}</span></>}
        {pay.otBreakdown.map((o, i) => (
          <React.Fragment key={i}><span>加班 {o.hours} 小時{o.rate ? ` ×${o.rate}` : ""}（{money(o.unit)}/時）</span><span className="v">{money(o.pay)}</span></React.Fragment>
        ))}
        {pay.earnings.map((x, i) => <React.Fragment key={`e${i}`}><span>{x.label}</span><span className="v">{money(x.amount)}</span></React.Fragment>)}
        <span className="total">應發合計</span><span className="v total">{money(pay.gross)}</span>
        {pay.deductions.map((x, i) => <React.Fragment key={`d${i}`}><span className="muted">扣：{x.label}</span><span className="v red">-{money(x.amount)}</span></React.Fragment>)}
        <span className="total">實發</span><span className="v total brass">{money(pay.netRounded)}</span>
        {pay.netRounded !== pay.net && <><span className="small faint">進位前</span><span className="v small faint">{money(pay.net)}</span></>}
      </div>
      {pay.note && <p className="small muted" style={{ marginTop: 10 }}>備註：{pay.note}</p>}
    </div>
  );
}
