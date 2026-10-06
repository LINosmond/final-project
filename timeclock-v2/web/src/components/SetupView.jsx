import React, { useState } from "react";
import { api } from "../api.js";
import Field from "./Field.jsx";

export default function SetupView({ onDone, flash }) {
  const [f, setF] = useState({ companyName: "", companyCode: "", adminName: "", adminLogin: "", adminPassword: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { onDone(await api.post("/api/setup", f)); flash("初始設定完成，歡迎使用", "success"); }
    catch (err) { flash(err.message, "error"); }
    setBusy(false);
  };
  return (
    <div className="shell narrow">
      <div className="topbar"><div className="brand">TimeClock · 初始設定</div></div>
      <form className="card" onSubmit={submit}>
        <h2>建立第一家公司與管理員</h2>
        <Field label="公司／店名"><input className="input" value={f.companyName} onChange={set("companyName")} required /></Field>
        <Field label="公司代碼" help="員工登入時要輸入。3 到 31 碼小寫英數字，例如 mystore"><input className="input mono" value={f.companyCode} onChange={set("companyCode")} pattern="[a-z0-9][a-z0-9\-]{2,30}" required /></Field>
        <Field label="管理員姓名"><input className="input" value={f.adminName} onChange={set("adminName")} required /></Field>
        <Field label="管理員帳號" help="建議用手機號碼"><input className="input mono" value={f.adminLogin} onChange={set("adminLogin")} inputMode="tel" required /></Field>
        <Field label="管理員密碼" help="至少 6 碼"><input className="input" type="password" value={f.adminPassword} onChange={set("adminPassword")} minLength={6} required /></Field>
        <button className="btn primary block" disabled={busy}>{busy ? "建立中…" : "建立並登入"}</button>
      </form>
      <p className="small faint center">之後若要新增第二家公司，請在伺服器執行 npm run create-company。</p>
    </div>
  );
}
