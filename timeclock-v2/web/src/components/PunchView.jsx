import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, newClientId } from "../api.js";
import { localParts, pad2 } from "@shared/time.js";
import { distanceMeters } from "@shared/geo.js";
import { createPunchQueue } from "../punchQueue.js";
import { fmtHM, fmtDateLabel, hours } from "../util.js";

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("此裝置不支援定位"));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
  });
}

// 現在時間前後各一個時間格（依公司設定的單位），回傳對應的時間戳；最接近現在的排前面標記
function slotChoices(nowTs, tz, step) {
  const p = localParts(nowTs, tz);
  const mins = p.hour * 60 + p.minute;
  const base = nowTs - p.second * 1000 - (nowTs % 1000);
  const prev = Math.floor(mins / step) * step;
  const label = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
  const out = [{ label: label(prev), ts: base - (mins - prev) * 60000, diff: mins - prev }];
  const next = prev + step;
  if (next < 1440) out.push({ label: label(next), ts: base + (next - mins) * 60000, diff: next - mins });
  const nearest = out.reduce((a, b) => (b.diff < a.diff ? b : a)).label;
  return out.map((c) => ({ ...c, nearest: c.label === nearest }));
}

function elapsedLabel(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  return m < 60 ? `${m} 分` : `${Math.floor(m / 60)} 小時 ${pad2(m % 60)} 分`;
}

export default function PunchView({ me, today, error, reload, setToday, flash }) {
  const rules = me.company.rules;
  const tz = rules.timezone;
  const step = rules.slotMinutes || 30;
  const exact = rules.punchMode === "exact";
  const loc = me.company.location;

  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [geo, setGeo] = useState({ status: loc ? "locating" : "off" });
  const [pending, setPending] = useState(null);
  const [done, setDone] = useState(null); // 剛打完卡的成功提示
  const queue = useMemo(() => createPunchQueue({ storage: window.localStorage, post: (b) => api.post("/api/me/punch", b) }), []);
  const flushing = useRef(false);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const choices = useMemo(() => slotChoices(now, tz, step), [Math.floor(now / 60000), tz, step]);
  useEffect(() => {
    if (!choices.some((c) => c.label === selected)) setSelected(choices.find((c) => c.nearest)?.label || choices[0].label);
  }, [choices]);

  // ---- 定位 ----
  const locate = useCallback(async () => {
    if (!loc) return null;
    setGeo((g) => ({ ...g, status: "locating" }));
    try {
      const pos = await getPosition();
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      const distance = distanceMeters(lat, lng, loc.lat, loc.lng);
      const g = { status: "ok", lat, lng, distance, accuracy: pos.coords.accuracy, inRange: distance <= loc.radius, at: Date.now() };
      setGeo(g);
      return g;
    } catch (e) {
      setGeo({ status: e.code === 1 ? "denied" : "error" });
      return null;
    }
  }, [loc?.lat, loc?.lng, loc?.radius]);
  useEffect(() => { locate(); }, [locate]);

  // ---- 待送出佇列 ----
  const tryFlush = useCallback(async (silent = false) => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const r = await queue.flush(me.user.id);
      if (!r) { setPending(null); return; }
      if (r.ok) {
        setPending(null);
        setToday(r.result.state);
        const t = r.entry.body.type;
        setDone({ type: t, label: fmtHM(r.entry.body.ts, tz), at: Date.now() });
        if (navigator.vibrate) navigator.vibrate(40);
        if (!silent) flash(`${t === "in" ? "上班" : "下班"}打卡成功 · 記錄為 ${fmtHM(r.entry.body.ts, tz)}`, "success");
      } else if (r.retry) {
        setPending(r.entry);
        if (!silent) flash("目前連不上伺服器，打卡已先存在手機，連線後會自動送出", "error");
      } else {
        setPending(null);
        flash(r.error.message, "error");
        reload();
      }
    } finally { flushing.current = false; }
  }, [queue, me.user.id, tz, setToday, flash, reload]);

  useEffect(() => {
    setPending(queue.load(me.user.id));
    tryFlush(true);
    const onBack = () => { if (document.visibilityState === "visible") { tryFlush(true); locate(); } };
    window.addEventListener("online", onBack);
    document.addEventListener("visibilitychange", onBack);
    return () => { window.removeEventListener("online", onBack); document.removeEventListener("visibilitychange", onBack); };
  }, [tryFlush, locate]);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => tryFlush(true), 15000);
    return () => clearInterval(t);
  }, [pending, tryFlush]);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(null), 5000); return () => clearTimeout(t); }, [done]);

  // ---- 打卡 ----
  const nextType = today?.nextType || "in";
  const isOut = nextType === "out";
  const punch = async () => {
    if (pending) return flash("上一筆打卡還沒送出，請等它完成", "error");
    const choice = exact ? { label: fmtHM(now, tz), ts: Math.floor(now / 1000) * 1000 } : choices.find((c) => c.label === selected);
    if (!choice) return;
    setBusy(true);
    const body = { type: nextType, ts: choice.ts, clientId: newClientId() };
    if (loc) {
      const g = geo.status === "ok" && Date.now() - geo.at < 60000 ? geo : await locate();
      if (!g) { setBusy(false); return flash(geo.status === "denied" ? "你拒絕了定位權限，請到瀏覽器設定允許後再試" : "無法取得目前位置，請稍後再試", "error"); }
      if (!g.inRange) { setBusy(false); return flash(`你目前不在打卡範圍內（距離約 ${Math.round(g.distance)} 公尺，允許 ${loc.radius} 公尺）`, "error"); }
      body.lat = g.lat; body.lng = g.lng;
    }
    queue.save(me.user.id, body);
    setPending(queue.load(me.user.id));
    await tryFlush();
    setBusy(false);
  };

  // ---- 畫面 ----
  const p = localParts(now, tz);
  const openSince = today?.openSince;
  const openIsYesterday = openSince && localParts(openSince, tz).dateKey !== today.dateKey;
  const canPunch = today && !pending && !busy && (!loc || geo.status !== "locating");

  return (
    <div>
      <div className="card">
        <div className="clock">{pad2(p.hour)}:{pad2(p.minute)}<small>:{pad2(p.second)}</small></div>
        <div className="center small faint" style={{ marginTop: 6 }}>{fmtDateLabel(now, tz)}{!exact && ` · 以 ${step} 分鐘為單位`}</div>
      </div>

      {pending && (
        <div className="banner warn">
          <div><b>有一筆{pending.body.type === "in" ? "上班" : "下班"}打卡（{fmtHM(pending.body.ts, tz)}）還沒送出</b><div className="small">已先存在手機，連上網路會自動送出。</div></div>
          <button className="btn sm" onClick={() => tryFlush(false)} disabled={busy}>立即重試</button>
        </div>
      )}

      {done && !pending && (
        <div className={`banner done ${done.type}`}>
          <span className="check">✓</span>
          <div><b>{done.type === "in" ? "上班" : "下班"}打卡成功</b><div className="small">記錄為 {done.label}</div></div>
        </div>
      )}

      <div className={`status ${isOut ? "on" : ""}`} style={{ marginBottom: 12 }}>
        <div>
          <div className="small muted">目前狀態</div>
          {!today && <div style={{ fontWeight: 600 }}>{error || "讀取中…"}</div>}
          {today && isOut && <div style={{ fontWeight: 600 }} className="green">上班中 · {openIsYesterday ? "昨天 " : ""}{fmtHM(openSince, tz)} 起 · 已 {elapsedLabel(now - openSince)}</div>}
          {today && !isOut && <div style={{ fontWeight: 600 }}>{today.todaySessions.length ? "休息中，可再打上班卡" : "尚未上班"}</div>}
        </div>
        {today && <div className="small faint">今日 {hours(today.todayMinutes)} 小時</div>}
      </div>

      {loc && (
        <div className={`geo ${geo.status === "ok" ? (geo.inRange ? "ok" : "bad") : ""}`}>
          <span>📍</span>
          {geo.status === "locating" && <span>定位中…</span>}
          {geo.status === "ok" && geo.inRange && <span>距離公司約 {Math.round(geo.distance)} 公尺，可以打卡</span>}
          {geo.status === "ok" && !geo.inRange && <span>不在打卡範圍（距離約 {Math.round(geo.distance)} 公尺，允許 {loc.radius} 公尺）</span>}
          {geo.status === "denied" && <span>未允許定位，無法打卡。請到瀏覽器設定開啟定位權限</span>}
          {geo.status === "error" && <span>無法取得位置</span>}
          <button className="btn ghost sm" onClick={locate} disabled={geo.status === "locating"}>重新定位</button>
        </div>
      )}

      {error && !today && <div className="card center"><button className="btn" onClick={reload}>重試</button></div>}

      {today && (
        <>
          {!exact && (
            <>
              <div className="small muted" style={{ margin: "14px 0 8px", letterSpacing: 1 }}>{isOut ? "下班" : "上班"}時間（已幫你選最接近的）</div>
              <div className="slots">
                {choices.map((c) => (
                  <button key={c.label} className={`slot ${selected === c.label ? `sel ${nextType}` : ""}`} onClick={() => setSelected(c.label)} disabled={busy}>
                    {c.label}{c.nearest && <span className="slot-hint">最接近</span>}
                  </button>
                ))}
              </div>
            </>
          )}
          <button className={`punch-btn ${nextType}`} onClick={punch} disabled={!canPunch}>
            {busy ? "送出中…" : pending ? "等待上一筆送出" : exact ? `${isOut ? "下班" : "上班"}打卡 · 現在 ${pad2(p.hour)}:${pad2(p.minute)}` : `${isOut ? "下班" : "上班"}打卡 ${selected || ""}`}
          </button>
        </>
      )}

      {today && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>今日時段</h2>
          {!today.todaySessions.length && !isOut && <div className="empty">今天還沒有打卡</div>}
          <div className="list">
            {today.todaySessions.map((s) => (
              <div className="item" key={s.inId}>
                <span className="mono">{fmtHM(s.inTs, tz)} – {fmtHM(s.outTs, tz)}</span>
                <span className="muted">{hours(s.minutes)} 小時</span>
              </div>
            ))}
            {isOut && (
              <div className="item">
                <span className="mono green">{fmtHM(openSince, tz)} – 進行中</span>
                <span className="green">{elapsedLabel(now - openSince)}</span>
              </div>
            )}
          </div>
          {today.todayPunches.some((x) => x.actualTs && Math.abs(x.actualTs - x.ts) >= 60000) && (
            <p className="help">括號為實際按下的時間，管理員看得到：{today.todayPunches.filter((x) => x.actualTs).map((x) => `${x.type === "in" ? "上" : "下"} ${fmtHM(x.ts, tz)}（${fmtHM(x.actualTs, tz)}）`).join("、")}</p>
          )}
        </div>
      )}
    </div>
  );
}
