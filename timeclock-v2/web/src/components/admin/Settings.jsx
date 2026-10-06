import React, { useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import Field from "../Field.jsx";
import { fmtDateTime, dateKeyParts, WEEKDAY } from "../../util.js";

export default function Settings({ me, refreshMe, reloadEmployees, flash }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [hol, setHol] = useState(null);
  const [newHol, setNewHol] = useState({ date: "", kind: "holiday" });
  const [audit, setAudit] = useState(null);
  const fileRef = useRef();

  const load = async () => { try { setS(await api.get("/api/admin/settings")); } catch (e) { flash(e.message, "error"); } };
  useEffect(() => { load(); }, []);
  useEffect(() => { api.get(`/api/admin/holidays/${year}`).then(setHol).catch((e) => flash(e.message, "error")); }, [year]);

  const save = async (patch, msg = "已儲存") => {
    setBusy(true);
    try { setS(await api.put("/api/admin/settings", patch)); await refreshMe(); flash(msg, "success"); }
    catch (e) { flash(e.message, "error"); }
    setBusy(false);
  };
  const setRule = (k, v) => setS({ ...s, rules: { ...s.rules, [k]: v } });
  const useMyPosition = () => {
    if (!navigator.geolocation) return flash("此裝置不支援定位", "error");
    navigator.geolocation.getCurrentPosition(
      (p) => setS({ ...s, location: { ...(s.location || { radius: 200, address: "" }), lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) } }),
      () => flash("無法取得位置，請允許定位權限", "error"), { enableHighAccuracy: true, timeout: 10000 });
  };
  const setHoliday = async (date, kind) => {
    try { const r = await api.put(`/api/admin/holidays/${date}`, { kind }); setHol({ ...hol, overrides: r.overrides }); }
    catch (e) { flash(e.message, "error"); }
  };
  const download = async () => {
    try {
      const data = await api.get("/api/admin/backup");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `timeclock-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { flash(e.message, "error"); }
  };
  const importLegacy = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const data = JSON.parse(await file.text());
      const r = await api.post("/api/admin/import-legacy", data);
      flash(`匯入完成：新增 ${r.employeesAdded} 位員工、${r.punchesAdded} 筆打卡、${r.holidays} 個假日設定`, "success");
      await reloadEmployees(); await load(); await refreshMe();
    } catch (e) { flash(e.message || "檔案格式不正確", "error"); }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  const loadAudit = async () => { try { setAudit((await api.get("/api/admin/audit?limit=50")).entries); } catch (e) { flash(e.message, "error"); } };

  if (!s) return <div className="empty">載入中…</div>;
  const r = s.rules;
  const tz = r.timezone;

  return (
    <div>
      <div className="card">
        <h2>公司</h2>
        <Field label="名稱"><input className="input" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></Field>
        <div className="kv"><span>公司代碼（員工登入用）</span><span className="v">{s.code}</span></div>
        <label className="row small" style={{ margin: "12px 0" }}><input type="checkbox" checked={s.allowSelfRegister} onChange={(e) => setS({ ...s, allowSelfRegister: e.target.checked })} /> 允許員工用公司代碼自行申請帳號（需審核）</label>
        <label className="row small" style={{ marginBottom: 12 }}><input type="checkbox" checked={s.salaryVisible} onChange={(e) => setS({ ...s, salaryVisible: e.target.checked })} /> 開放員工查看自己已發佈的薪資</label>
        <button className="btn" disabled={busy} onClick={() => save({ name: s.name, allowSelfRegister: s.allowSelfRegister, salaryVisible: s.salaryVisible })}>儲存</button>
      </div>

      <div className="card">
        <h2>工時與加班規則</h2>
        <div className="grid-2">
          <Field label="打卡方式" help={r.punchMode === "exact" ? "一顆按鈕，直接記錄按下的時間" : "員工從前後兩個時間格選一個，同時記錄實際按下時間供管理員比對"}>
            <select className="input" value={r.punchMode} onChange={(e) => setRule("punchMode", e.target.value)}><option value="slot">選整點／半點（預設）</option><option value="exact">記錄實際時間</option></select>
          </Field>
          {r.punchMode !== "exact" && <Field label="打卡時間單位（分）"><select className="input" value={r.slotMinutes} onChange={(e) => setRule("slotMinutes", Number(e.target.value))}>{[5, 10, 15, 30, 60].map((v) => <option key={v} value={v}>{v}</option>)}</select></Field>}
          <Field label="每日正常工時（分）" help="超過即為加班，480 = 8 小時"><input className="input mono" inputMode="numeric" value={r.standardDailyMinutes} onChange={(e) => setRule("standardDailyMinutes", Number(e.target.value))} /></Field>
          <Field label="加班計算方式">
            <select className="input" value={r.otMode} onChange={(e) => setRule("otMode", e.target.value)}><option value="tiers">分段倍率（前 2 小時 1.34、再 2 小時 1.67、其後 2）</option><option value="simple">單一倍率</option></select>
          </Field>
          {r.otMode === "simple" && <Field label="加班倍率"><input className="input mono" inputMode="decimal" value={r.otMultiplier} onChange={(e) => setRule("otMultiplier", Number(e.target.value))} /></Field>}
          <Field label="國定假日工時倍率"><input className="input mono" inputMode="decimal" value={r.holidayRate} onChange={(e) => setRule("holidayRate", Number(e.target.value))} /></Field>
          <Field label="單一班最長（分）" help="上班後超過此時間沒打下班，視為漏打卡"><input className="input mono" inputMode="numeric" value={r.maxShiftMinutes} onChange={(e) => setRule("maxShiftMinutes", Number(e.target.value))} /></Field>
        </div>
        <p className="help">分段倍率為台灣勞基法對平日延長工時的規定；休息日、例假日另有規定，請依貴公司實際制度與員工約定調整，本系統不構成法律意見。</p>
        <button className="btn" disabled={busy} onClick={() => save({ rules: r })}>儲存規則</button>
      </div>

      <div className="card">
        <h2>打卡地點限制</h2>
        {!s.location ? (
          <div className="row"><span className="muted">未啟用，任何地點都可打卡。</span><button className="btn sm" onClick={() => setS({ ...s, location: { lat: "", lng: "", radius: 200, address: "" } })}>啟用</button></div>
        ) : (
          <>
            <Field label="地址／說明"><input className="input" value={s.location.address} onChange={(e) => setS({ ...s, location: { ...s.location, address: e.target.value } })} /></Field>
            <div className="grid-2">
              <Field label="緯度"><input className="input mono" inputMode="decimal" value={s.location.lat} onChange={(e) => setS({ ...s, location: { ...s.location, lat: e.target.value } })} /></Field>
              <Field label="經度"><input className="input mono" inputMode="decimal" value={s.location.lng} onChange={(e) => setS({ ...s, location: { ...s.location, lng: e.target.value } })} /></Field>
            </div>
            <Field label="允許範圍（公尺）" help="20 到 5000。手機定位誤差常有 30 到 100 公尺，建議不要設太小。"><input className="input mono" inputMode="numeric" value={s.location.radius} onChange={(e) => setS({ ...s, location: { ...s.location, radius: e.target.value } })} /></Field>
            <div className="row">
              <button className="btn sm" onClick={useMyPosition}>📍 用我目前的位置</button>
              <button className="btn primary" disabled={busy} onClick={() => save({ location: { lat: Number(s.location.lat), lng: Number(s.location.lng), radius: Number(s.location.radius), address: s.location.address } })}>儲存</button>
              <button className="btn danger" disabled={busy} onClick={() => save({ location: null }, "已停用地點限制")}>停用</button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="row between"><h2 style={{ margin: 0 }}>國定假日</h2><div className="row"><button className="btn sm" onClick={() => setYear(year - 1)}>‹</button><span className="mono">{year}</span><button className="btn sm" onClick={() => setYear(year + 1)}>›</button></div></div>
        {hol && (
          <>
            <p className="help" style={{ marginBottom: 10 }}>{hol.exact ? "此年度使用行政院公告的國定假日（含補假）。" : "此年度尚無公告資料，只有固定國曆日期的假日；農曆節日請手動新增。"}</p>
            <div className="pill-row">
              {[...new Set([...hol.auto, ...Object.keys(hol.overrides)])].sort().map((d) => {
                const ov = hol.overrides[d];
                const { m, d: dd, weekday } = dateKeyParts(d);
                return <span key={d} className={`tag ${ov === "workday" ? "" : "brass"}`} style={ov === "workday" ? { textDecoration: "line-through" } : {}}>{m}/{dd} 週{WEEKDAY[weekday]}{ov ? " ✎" : ""}<button className="btn ghost sm" style={{ padding: "0 4px", marginLeft: 2 }} onClick={() => setHoliday(d, ov ? null : "workday")} title={ov ? "恢復預設" : "改為工作日"}>{ov ? "↺" : "✕"}</button></span>;
              })}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <input className="input sm" type="date" value={newHol.date} onChange={(e) => setNewHol({ ...newHol, date: e.target.value })} />
              <select className="input sm" value={newHol.kind} onChange={(e) => setNewHol({ ...newHol, kind: e.target.value })}><option value="holiday">設為假日</option><option value="workday">設為工作日</option></select>
              <button className="btn sm" disabled={!newHol.date} onClick={() => { setHoliday(newHol.date, newHol.kind); setNewHol({ ...newHol, date: "" }); }}>新增</button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h2>備份與匯入</h2>
        <div className="row">
          <button className="btn" onClick={download}>下載完整備份（JSON）</button>
          <label className="btn">匯入舊版備份檔<input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => importLegacy(e.target.files[0])} disabled={busy} /></label>
        </div>
        <p className="help">舊版（Google 試算表版）的備份檔可直接匯入：員工帳號＝手機、初始密碼＝手機號碼，請提醒員工登入後更改。重複匯入不會產生重複資料。</p>
      </div>

      <div className="card">
        <div className="row between"><h2 style={{ margin: 0 }}>操作紀錄</h2><button className="btn sm" onClick={loadAudit}>載入最近 50 筆</button></div>
        {audit && <div className="list" style={{ marginTop: 8 }}>{audit.map((a) => (
          <div className="item small" key={a.id}><span className="mono faint">{fmtDateTime(a.at, tz)}</span><span>{a.actor || "系統"} · {a.action}</span><span className="faint mono">{a.target ? a.target.slice(0, 8) : ""}</span></div>
        ))}</div>}
      </div>
    </div>
  );
}
