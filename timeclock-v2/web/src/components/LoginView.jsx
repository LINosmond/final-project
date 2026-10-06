import React, { useState } from "react";
import { api } from "../api.js";
import Field from "./Field.jsx";

const KEY = "tc2:companyCode";

export default function LoginView({ onLogin, flash }) {
  const [mode, setMode] = useState("login");
  const [companyCode, setCompanyCode] = useState(() => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } });
  const [login, setLogin] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { companyCode: companyCode.trim(), login: login.trim(), password };
      const me = mode === "login" ? await api.post("/api/auth/login", body) : await api.post("/api/auth/register", { ...body, name: name.trim() });
      try { localStorage.setItem(KEY, companyCode.trim()); } catch {}
      onLogin(me);
      if (mode === "register") flash("申請已送出，請等管理員審核", "success");
    } catch (err) { flash(err.message, "error"); }
    setBusy(false);
  };

  return (
    <div className="shell narrow">
      <div className="topbar"><div className="brand">TimeClock</div></div>
      <div className="tabs">
        <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>登入</button>
        <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>申請帳號</button>
      </div>
      <form className="card" onSubmit={submit}>
        <Field label="公司代碼"><input className="input mono" value={companyCode} onChange={(e) => setCompanyCode(e.target.value)} autoCapitalize="none" required /></Field>
        {mode === "register" && <Field label="姓名"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>}
        <Field label="帳號（手機號碼）"><input className="input mono" value={login} onChange={(e) => setLogin(e.target.value)} inputMode="tel" autoComplete="username" required /></Field>
        <Field label="密碼" help={mode === "register" ? "自己設定，至少 6 碼" : undefined}>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input className="input" type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={6} required />
            <button type="button" className="btn ghost sm" onClick={() => setShowPw(!showPw)} aria-label={showPw ? "隱藏密碼" : "顯示密碼"}>{showPw ? "隱藏" : "顯示"}</button>
          </div>
        </Field>
        <button className="btn primary block" disabled={busy}>{busy ? "請稍候…" : mode === "login" ? "登入" : "送出申請"}</button>
      </form>
      <p className="small faint center">忘記密碼請聯絡管理員重設。</p>
    </div>
  );
}
