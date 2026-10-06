import React, { useState } from "react";
import { api } from "../../api.js";
import { fmtHM, slotOptions, dateKeyParts, WEEKDAY } from "../../util.js";

function Sel({ value, onChange, options }) {
  return (
    <select className="input sm mono" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export default function DayEditor({ day, employee, tz, rules, month, onClose, onSaved, onHolidayChanged, flash }) {
  const options = slotOptions(rules.slotMinutes || 30);
  const initial = day.sessions.map((s) => ({ in: fmtHM(s.inTs, tz), out: fmtHM(s.outTs, tz) }));
  while (initial.length < 2) initial.push({ in: "", out: "" });
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState(false);
  const { m, d, weekday } = dateKeyParts(day.dateKey);
  const holidayKind = day.holidaySource === "override" ? (day.isHoliday ? "holiday" : "workday") : "auto";

  const setRow = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put(`/api/admin/attendance/${employee.id}/days/${day.dateKey}`, { sessions: rows.filter((x) => x.in || x.out) });
      flash("已更新該日紀錄", "success");
      onSaved(r.month);
    } catch (e) { flash(e.message, "error"); }
    setBusy(false);
  };
  const setHoliday = async (kind) => {
    setBusy(true);
    try { await api.put(`/api/admin/holidays/${day.dateKey}`, { kind: kind === "auto" ? null : kind }); flash("假日設定已更新", "success"); onHolidayChanged(); onClose(); }
    catch (e) { flash(e.message, "error"); }
    setBusy(false);
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{employee?.name} · {m}/{d} 週{WEEKDAY[weekday]}</h2>
          <button className="btn ghost sm" onClick={onClose}>關閉</button>
        </div>
        <div className="stack">
          {rows.map((r, i) => (
            <div className="row" key={i}>
              <span className="small muted" style={{ width: 48 }}>時段 {i + 1}</span>
              <Sel value={r.in} onChange={(v) => setRow(i, "in", v)} options={options} />
              <span className="faint">到</span>
              <Sel value={r.out} onChange={(v) => setRow(i, "out", v)} options={options} />
            </div>
          ))}
          {rows.length < 4 && <button className="btn ghost sm" onClick={() => setRows([...rows, { in: "", out: "" }])}>＋ 再加一段</button>}
        </div>
        <p className="help">下班時間早於上班時間代表跨到隔天（例如 22:00 到 02:00）。清空所有時段即刪除該日紀錄。</p>
        <button className="btn primary block" onClick={save} disabled={busy}>儲存時段</button>

        <div style={{ marginTop: 18 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>這一天的假日設定（影響全公司）</div>
          <div className="pill-row">
            {[["auto", "依國定假日表"], ["holiday", "設為假日"], ["workday", "設為工作日"]].map(([k, label]) => (
              <button key={k} className={`btn sm ${holidayKind === k ? "primary" : ""}`} onClick={() => setHoliday(k)} disabled={busy || holidayKind === k}>{label}</button>
            ))}
          </div>
          <div className="help">目前：{day.isHoliday ? `假日（×${month.rules.holidayRate}）` : "工作日"}{day.holidaySource === "auto" ? "，來自國定假日表" : day.holidaySource === "override" ? "，手動設定" : ""}</div>
        </div>
      </div>
    </div>
  );
}
