import React, { useState } from "react";
import { api } from "../../api.js";
import Field from "../Field.jsx";

export default function Staff({ employees, setEmployees, flash }) {
  const pending = employees.filter((e) => e.status === "pending");
  const active = employees.filter((e) => e.status === "active");
  const archived = employees.filter((e) => e.status === "archived");
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", login: "", password: "" });
  const [pwFor, setPwFor] = useState(null);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState(null);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); if (r?.employees) setEmployees(r.employees); if (okMsg) flash(okMsg, "success"); }
    catch (e) { flash(e.message, "error"); }
    setBusy(false);
  };
  const review = (id, decision) => run(() => api.post(`/api/admin/employees/${id}/review`, { decision }), decision === "approve" ? "已通過" : "已拒絕");
  const archive = (id, archived) => run(() => api.post(`/api/admin/employees/${id}/archive`, { archived }), archived ? "已封存" : "已還原");
  const move = (id, dir) => {
    const ids = active.map((e) => e.id);
    const i = ids.indexOf(id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(() => api.put("/api/admin/employees/order", { ids: [...ids, ...archived.map((e) => e.id)] }));
  };
  const add = (e) => { e.preventDefault(); run(() => api.post("/api/admin/employees", form).then((r) => { setAdding(false); setForm({ name: "", login: "", password: "" }); return r; }), "已新增員工"); };
  const resetPw = (e) => { e.preventDefault(); run(() => api.patch(`/api/admin/employees/${pwFor.id}`, { password: pw }).then(() => { setPwFor(null); setPw(""); return null; }), "密碼已重設，該員工需重新登入"); };

  return (
    <div>
      {pending.length > 0 && (
        <div className="card">
          <h2>待審核（{pending.length}）</h2>
          <div className="list">
            {pending.map((e) => (
              <div className="item" key={e.id}>
                <div><div>{e.name}</div><div className="small faint mono">{e.login}</div></div>
                <div className="row"><button className="btn sm primary" disabled={busy} onClick={() => review(e.id, "approve")}>通過</button><button className="btn sm danger" disabled={busy} onClick={() => review(e.id, "reject")}>拒絕</button></div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}><h2 style={{ margin: 0 }}>員工（{active.length}）</h2><button className="btn sm" onClick={() => setAdding(!adding)}>{adding ? "取消" : "＋ 新增員工"}</button></div>
        {adding && (
          <form onSubmit={add} className="card tight" style={{ background: "var(--panel-2)" }}>
            <div className="grid-2">
              <Field label="姓名"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
              <Field label="帳號（手機）"><input className="input mono" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required /></Field>
            </div>
            <Field label="初始密碼" help="至少 6 碼，請告知員工登入後自行更改"><input className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={6} required /></Field>
            <button className="btn primary" disabled={busy}>建立</button>
          </form>
        )}
        <div className="list">
          {active.map((e, i) => (
            <div className="item" key={e.id}>
              <div><div>{e.name}</div><div className="small faint mono">{e.login}</div></div>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <button className="btn ghost sm" disabled={busy || i === 0} onClick={() => move(e.id, -1)} aria-label="上移">↑</button>
                <button className="btn ghost sm" disabled={busy || i === active.length - 1} onClick={() => move(e.id, 1)} aria-label="下移">↓</button>
                <button className="btn sm" disabled={busy} onClick={() => { setPwFor(e); setPw(""); }}>重設密碼</button>
                <button className="btn sm danger" disabled={busy} onClick={() => setConfirm(e)}>封存</button>
              </div>
            </div>
          ))}
          {!active.length && <div className="empty">還沒有員工。可以讓員工用公司代碼自行申請，或在這裡新增。</div>}
        </div>
        <p className="help">順序會套用到考勤總表與薪資表。封存後員工無法登入，歷史紀錄保留，可隨時還原。</p>
      </div>

      {archived.length > 0 && (
        <div className="card">
          <button className="btn ghost sm" onClick={() => setShowArchived(!showArchived)}>{showArchived ? "隱藏" : "顯示"}已封存（{archived.length}）</button>
          {showArchived && <div className="list" style={{ marginTop: 8 }}>{archived.map((e) => (
            <div className="item" key={e.id}><div><div className="muted">{e.name}</div><div className="small faint mono">{e.login}</div></div><button className="btn sm" disabled={busy} onClick={() => archive(e.id, false)}>還原</button></div>
          ))}</div>}
        </div>
      )}

      {pwFor && (
        <div className="modal-bg" onClick={() => setPwFor(null)}><form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={resetPw}>
          <h2>重設 {pwFor.name} 的密碼</h2>
          <Field label="新密碼" help="至少 6 碼。重設後該員工所有裝置都需重新登入。"><input className="input" value={pw} onChange={(e) => setPw(e.target.value)} minLength={6} required autoFocus /></Field>
          <div className="row"><button className="btn primary" disabled={busy}>確定重設</button><button type="button" className="btn ghost" onClick={() => setPwFor(null)}>取消</button></div>
        </form></div>
      )}
      {confirm && (
        <div className="modal-bg" onClick={() => setConfirm(null)}><div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>封存 {confirm.name}？</h2>
          <p className="muted">封存後無法登入與打卡，但所有歷史紀錄與薪資資料保留，隨時可以還原。</p>
          <div className="row"><button className="btn danger" disabled={busy} onClick={() => { archive(confirm.id, true); setConfirm(null); }}>封存</button><button className="btn ghost" onClick={() => setConfirm(null)}>取消</button></div>
        </div></div>
      )}
    </div>
  );
}
