import React, { useEffect, useState } from "react";
import { api } from "../../api.js";
import MonthNav from "../MonthNav.jsx";
import MonthTable from "../MonthTable.jsx";
import DayEditor from "./DayEditor.jsx";
import { currentYm, hours } from "../../util.js";

export default function Attendance({ me, employees, flash }) {
  const tz = me.company.rules.timezone;
  const active = employees.filter((e) => e.status === "active");
  const [ym, setYm] = useState(() => currentYm(tz));
  const [empId, setEmpId] = useState("all");
  const [summary, setSummary] = useState(null);
  const [month, setMonth] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      if (empId === "all") { setSummary(null); setSummary(await api.get(`/api/admin/attendance/${ym}`)); }
      else { setMonth(null); setMonth(await api.get(`/api/admin/attendance/${ym}/${empId}`)); }
    } catch (e) { flash(e.message, "error"); }
  };
  useEffect(() => { load(); }, [ym, empId]);

  const emp = employees.find((e) => e.id === empId);

  return (
    <div>
      <div className="row between" style={{ marginBottom: 10 }}>
        <select className="input sm" value={empId} onChange={(e) => setEmpId(e.target.value)}>
          <option value="all">全部員工（總表）</option>
          {active.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          {employees.filter((e) => e.status === "archived").length > 0 && <optgroup label="已封存">{employees.filter((e) => e.status === "archived").map((e) => <option key={e.id} value={e.id}>{e.name}（封存）</option>)}</optgroup>}
        </select>
        <a className="btn sm" href={`/api/admin/attendance-export/${ym}`} download>下載 CSV</a>
      </div>
      <MonthNav ym={ym} onChange={setYm} />

      {empId === "all" && (
        <div className="card tight">
          {!summary ? <div className="empty">載入中…</div> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>員工</th><th className="num">工作日</th><th className="num">總工時</th><th className="num">加班</th><th className="num">假日</th><th>狀態</th></tr></thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.employee.id} className="clickable" onClick={() => setEmpId(r.employee.id)}>
                    <td>{r.employee.name}</td>
                    <td className="num">{r.totals.workDays}</td>
                    <td className="num">{hours(r.totals.totalMin)}</td>
                    <td className="num">{r.totals.otMin ? hours(r.totals.otMin) : ""}</td>
                    <td className="num">{r.totals.holidayMin ? hours(r.totals.holidayMin) : ""}</td>
                    <td>{r.unmatched > 0 && <span className="tag red">{r.unmatched} 筆漏打卡</span>}</td>
                  </tr>
                ))}
                {!summary.rows.length && <tr><td colSpan={6} className="empty">尚無員工</td></tr>}
              </tbody>
            </table></div>
          )}
          <p className="help">點員工姓名可查看並補登每日紀錄。</p>
        </div>
      )}

      {empId !== "all" && (
        <div className="card tight">
          {!month ? <div className="empty">載入中…</div> : <MonthTable month={month} tz={tz} showActual onDayClick={(d) => setEditing(d)} />}
          <p className="help">點任一天可補登或修改時段、設定假日。括號內為員工實際按下打卡的時間。</p>
        </div>
      )}

      {editing && month && (
        <DayEditor
          day={editing} employee={emp} tz={tz} rules={me.company.rules} month={month}
          onClose={() => setEditing(null)}
          onSaved={(m) => { setMonth(m); setEditing(null); }}
          onHolidayChanged={load}
          flash={flash}
        />
      )}
    </div>
  );
}
