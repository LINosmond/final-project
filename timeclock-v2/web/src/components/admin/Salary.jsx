import React, { useEffect, useState } from "react";
import { api } from "../../api.js";
import MonthNav from "../MonthNav.jsx";
import PaySlip from "../PaySlip.jsx";
import SalaryEditor from "./SalaryEditor.jsx";
import { currentYm, shiftYm, money, hours } from "../../util.js";

export function slipHtml(companyName, ym, rows) {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const line = (l, v, cls = "") => `<tr class="${cls}"><td>${esc(l)}</td><td class="v">${esc(v)}</td></tr>`;
  const slips = rows.map(({ employee, pay }) => {
    const items = [];
    if (pay.payType === "monthly") items.push(line("月薪", money(pay.monthlySalary)));
    else items.push(line(`正常工時 ${pay.workHours} 小時 × ${money(pay.hourlyRate)}`, money(pay.basePay)));
    if (pay.holidayPay > 0) items.push(line(`假日工時 ${pay.holidayHours} 小時`, money(pay.holidayPay)));
    for (const o of pay.otBreakdown) items.push(line(`加班 ${o.hours} 小時${o.rate ? ` ×${o.rate}` : ""}（${money(o.unit)}/時）`, money(o.pay)));
    for (const x of pay.earnings) items.push(line(x.label, money(x.amount)));
    items.push(line("應發合計", money(pay.gross), "total"));
    for (const x of pay.deductions) items.push(line(`扣：${x.label}`, `-${money(x.amount)}`));
    items.push(line("實發", money(pay.netRounded), "total net"));
    return `<section class="slip"><header><strong>${esc(companyName)}</strong> 薪資明細 <span class="ym">${esc(ym)}</span></header><div class="name">${esc(employee.name)}</div><table>${items.join("")}</table>${pay.note ? `<p class="note">備註：${esc(pay.note)}</p>` : ""}<p class="sign">簽收：________________</p></section>`;
  }).join("");
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>薪資明細 ${esc(ym)}</title><style>
  body{font-family:-apple-system,"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;font-size:13px;color:#000;margin:0;padding:12mm}
  .slip{border:1px solid #333;border-radius:6px;padding:10px 12px;margin-bottom:10mm;break-inside:avoid;page-break-inside:avoid}
  header{display:flex;justify-content:space-between;border-bottom:1px solid #999;padding-bottom:6px;margin-bottom:6px}.ym{font-family:monospace}
  .name{font-weight:700;font-size:15px;margin-bottom:6px}table{width:100%;border-collapse:collapse}td{padding:3px 0}.v{text-align:right;font-family:monospace}
  .total td{border-top:1px solid #999;font-weight:700}.net td{font-size:15px}.note{color:#444;margin:6px 0 0}.sign{margin:14px 0 0;color:#444}
  @media print{.noprint{display:none}}</style></head><body><button class="noprint" onclick="print()">列印</button>${slips}</body></html>`;
}

export default function Salary({ me, employees, flash }) {
  const tz = me.company.rules.timezone;
  const [ym, setYm] = useState(() => shiftYm(currentYm(tz), -1));
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);

  const load = async () => {
    try { setData(await api.get(`/api/admin/salary/${ym}${includeArchived ? "?includeArchived=1" : ""}`)); }
    catch (e) { flash(e.message, "error"); }
  };
  useEffect(() => { setData(null); load(); }, [ym, includeArchived]);

  const publishAll = async (published) => {
    setBusy(true);
    try { const r = await api.post(`/api/admin/salary/${ym}/publish`, { published }); flash(`${published ? "已發佈" : "已取消發佈"} ${r.count} 位員工`, "success"); await load(); }
    catch (e) { flash(e.message, "error"); }
    setBusy(false);
  };
  const print = (rows) => {
    const w = window.open("", "_blank");
    if (!w) return flash("瀏覽器阻擋了新視窗，請允許彈出視窗", "error");
    w.document.write(slipHtml(me.company.name, ym, rows));
    w.document.close();
  };

  const rows = data?.rows || [];
  const allPublished = rows.length > 0 && rows.every((r) => r.published);

  return (
    <div>
      <MonthNav ym={ym} onChange={setYm} />
      <div className="row between" style={{ marginBottom: 10 }}>
        <label className="small muted row"><input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} /> 含已封存</label>
        <div className="row">
          <button className="btn sm" onClick={() => print(rows)} disabled={!rows.length}>列印全部薪資條</button>
          <button className={`btn sm ${allPublished ? "" : "primary"}`} disabled={busy || !rows.length} onClick={() => publishAll(!allPublished)}>{allPublished ? "取消發佈整月" : "發佈整月給員工"}</button>
        </div>
      </div>
      <div className="card tight">
        {!data ? <div className="empty">載入中…</div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>員工</th><th className="num">工時</th><th className="num">加班</th><th className="num">應發</th><th className="num">扣款</th><th className="num">實發</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee.id} className="clickable" onClick={() => setEditing(r)}>
                  <td>{r.employee.name}{r.unmatched > 0 && <span className="tag red" style={{ marginLeft: 6 }}>漏打卡</span>}</td>
                  <td className="num">{r.pay.payType === "monthly" ? "月薪" : hours(r.totals.baseMin)}</td>
                  <td className="num">{r.pay.otHours || ""}</td>
                  <td className="num">{money(r.pay.gross)}</td>
                  <td className="num red">{r.pay.deductionsTotal ? `-${money(r.pay.deductionsTotal)}` : ""}</td>
                  <td className="num brass">{money(r.pay.netRounded)}</td>
                  <td>{r.published ? <span className="tag green">已發佈</span> : <span className="tag">未發佈</span>}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="empty">沒有員工</td></tr>}
            </tbody>
          </table></div>
        )}
        <p className="help">點員工可設定時薪／月薪、固定加給扣款與當月獎金預支。工時一律由考勤自動計算；若有漏打卡請先到「考勤」補登。{!me.company.salaryVisible && " 目前「設定」中尚未開放員工查看薪資，發佈後員工仍看不到。"}</p>
      </div>
      {editing && <SalaryEditor row={editing} ym={ym} companyName={me.company.name} onClose={() => setEditing(null)} onSaved={(r) => { setData({ ...data, rows: rows.map((x) => (x.employee.id === r.employee.id ? r : x)) }); setEditing(r); }} onPrint={() => print([editing])} flash={flash} />}
    </div>
  );
}
