import React, { useEffect, useMemo, useState } from "react";
import { api, newClientId } from "../api.js";
import { localParts, pad2 } from "@shared/time.js";
import { fmtHM, fmtDateLabel, hours } from "../util.js";

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("此裝置不支援定位"));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });
}

// 現在時間前後各一個整點／半點（依公司設定的單位），回傳對應的時間戳
function slotChoices(nowTs, tz, step) {
  const p = localParts(nowTs, tz);
  const mins = p.hour * 60 + p.minute;
  const base = nowTs - (p.second * 1000) - (nowTs % 1000);
  const prev = Math.floor(mins / step) * step;
  const out = [{ label: `${pad2(Math.floor(prev / 60))}:${pad2(prev % 60)}`, ts: base - (mins - prev) * 60000 }];
  const next = prev + step;
  if (next < 1440) out.push({ label: `${pad2(Math.floor(next / 60))}:${pad2(next % 60)}`, ts: base + (next - mins) * 60000 });
  return out;
}

export default function PunchView({ me, today, error, reload, setToday, flash }) {
  const tz = me.company.rules.timezone;
  const step = me.company.rules.slotMinutes || 30;
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const choices = useMemo(() => slotChoices(now, tz, step), [Math.floor(now / 60000), tz, step]);
  const p = localParts(now, tz);
  const nextType = today?.nextType || "in";
  const isOut = nextType === "out";

  const punch = async () => {
    const choice = choices.find((c) => c.label === selected) || null;
    if (!choice) return flash("請先選擇打卡時間", "error");
    setBusy(true);
    const body = { type: nextType, ts: choice.ts, clientId: newClientId() };
    try {
      if (me.company.location) {
        try { const pos = await getPosition(); body.lat = pos.coords.latitude; body.lng = pos.coords.longitude; }
        catch { setBusy(false); return flash("無法取得目前位置，請開啟定位權限後再試", "error"); }
      }
      const r = await api.post("/api/me/punch", body);
      setToday(r.state);
      setSelected(null);
      flash(`${isOut ? "下班" : "上班"}打卡成功 · 記錄為 ${choice.label}`, "success");
    } catch (e) {
      flash(e.message, "error");
      if (e.status === 409) reload();
    }
    setBusy(false);
  };

  let statusText = "未上班";
  if (today?.nextType === "out") statusText = `上班中（${fmtHM(today.openSince, tz)} 起）`;
  else if (today?.todaySessions?.length) statusText = "休息中，可再打上班卡";

  return (
    <div>
      <div className="card">
        <div className="clock">{pad2(p.hour)}:{pad2(p.minute)}<small>:{pad2(p.second)}</small></div>
        <div className="center small faint" style={{ marginTop: 6 }}>
          {fmtDateLabel(now, tz)} · 打卡以 {step} 分鐘為單位
          {me.company.location && <div className="brass">📍 需在公司 {me.company.location.radius} 公尺內並允許定位</div>}
        </div>
      </div>

      <div className={`status ${isOut ? "on" : ""}`} style={{ marginBottom: 14 }}>
        <div><div className="small muted">目前狀態</div><div style={{ fontWeight: 600 }} className={isOut ? "green" : ""}>{today ? statusText : (error || "讀取中…")}</div></div>
        {today && <div className="small faint">今日 {hours(today.todayMinutes)} 小時</div>}
      </div>

      {error && !today && <div className="card center"><button className="btn" onClick={reload}>重試</button></div>}

      {today && (
        <>
          <div className="small muted" style={{ marginBottom: 8, letterSpacing: 1 }}>選擇{isOut ? "下班" : "上班"}時間</div>
          <div className="slots">
            {choices.map((c) => (
              <button key={c.label} className={`slot ${selected === c.label ? `sel ${nextType}` : ""}`} onClick={() => setSelected(c.label)} disabled={busy}>{c.label}</button>
            ))}
          </div>
          <button className={`punch-btn ${nextType}`} onClick={punch} disabled={busy || !selected}>{busy ? "處理中…" : isOut ? "下班打卡" : "上班打卡"}</button>
        </>
      )}

      {today && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>今日紀錄</h2>
          {!today.todayPunches.length && <div className="empty">今天還沒有打卡</div>}
          <div className="list">
            {today.todayPunches.map((x) => (
              <div className="item" key={x.id}>
                <span className={x.type === "in" ? "brass" : "red"}>{x.type === "in" ? "上班" : "下班"}</span>
                <span className="mono">{fmtHM(x.ts, tz)}</span>
                <span className="small faint">{x.actualTs ? `實際 ${fmtHM(x.actualTs, tz)}` : x.source === "admin" ? "管理員補登" : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
