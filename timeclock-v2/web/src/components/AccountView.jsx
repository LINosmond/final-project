import React, { useState } from "react";
import { api } from "../api.js";
import Field from "./Field.jsx";

export default function AccountView({ me, logout, flash }) {
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api.post("/api/me/password", { oldPassword, newPassword }); setOld(""); setNew(""); flash("密碼已更新", "success"); }
    catch (err) { flash(err.message, "error"); }
    setBusy(false);
  };
  return (
    <div>
      <div className="card"><h2>帳號</h2><div className="kv"><span>姓名</span><span className="v">{me.user.name}</span><span>公司</span><span className="v">{me.company.name}</span><span>公司代碼</span><span className="v">{me.company.code}</span></div></div>
      <form className="card" onSubmit={submit}>
        <h2>更改密碼</h2>
        <Field label="目前密碼"><input className="input" type="password" value={oldPassword} onChange={(e) => setOld(e.target.value)} required autoComplete="current-password" /></Field>
        <Field label="新密碼" help="至少 6 碼"><input className="input" type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} minLength={6} required autoComplete="new-password" /></Field>
        <button className="btn block" disabled={busy}>更新密碼</button>
      </form>
      <button className="btn danger block" onClick={logout}>登出</button>
    </div>
  );
}
