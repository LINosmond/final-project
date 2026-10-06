import React, { useState } from "react";

export default function PendingView({ me, refreshMe, logout }) {
  const [busy, setBusy] = useState(false);
  const check = async () => { setBusy(true); try { await refreshMe(); } catch {} setBusy(false); };
  return (
    <div className="shell narrow">
      <div className="topbar"><div className="brand">{me.company.name}</div><button className="btn ghost sm" onClick={logout}>登出</button></div>
      <div className="card center">
        <h2>等待管理員審核</h2>
        <p>{me.user.name}，你的帳號已送出申請。管理員通過後就可以開始打卡。</p>
        <button className="btn" onClick={check} disabled={busy}>{busy ? "檢查中…" : "重新檢查"}</button>
      </div>
    </div>
  );
}
