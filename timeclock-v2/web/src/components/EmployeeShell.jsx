import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import PunchView from "./PunchView.jsx";
import MyRecords from "./MyRecords.jsx";
import MySalary from "./MySalary.jsx";
import AccountView from "./AccountView.jsx";

const TABS = [["punch", "打卡", "⏱"], ["records", "紀錄", "📋"], ["salary", "薪資", "💰"], ["account", "帳號", "👤"]];

export default function EmployeeShell({ me, refreshMe, logout, flash }) {
  const [tab, setTab] = useState("punch");
  const [today, setToday] = useState(null);
  const [error, setError] = useState("");

  const loadToday = useCallback(async () => {
    try { setToday(await api.get("/api/me/today")); setError(""); }
    catch (e) {
      if (e.status === 401) { await refreshMe().catch(() => {}); return; }
      if (e.status === 403) { await refreshMe().catch(() => {}); }
      setError(e.message);
    }
  }, [refreshMe]);

  useEffect(() => {
    loadToday();
    const onVis = () => { if (document.visibilityState === "visible") loadToday(); };
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(loadToday, 60000);
    return () => { document.removeEventListener("visibilitychange", onVis); clearInterval(t); };
  }, [loadToday]);

  return (
    <div className="shell narrow">
      <div className="topbar">
        <div className="brand">{me.company.name}</div>
        <div className="who">{me.user.name}</div>
      </div>
      {tab === "punch" && <PunchView me={me} today={today} error={error} reload={loadToday} setToday={setToday} flash={flash} />}
      {tab === "records" && <MyRecords me={me} flash={flash} />}
      {tab === "salary" && <MySalary me={me} flash={flash} />}
      {tab === "account" && <AccountView me={me} logout={logout} flash={flash} />}
      <nav className="bottomnav">
        {TABS.map(([k, label, ico]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}><span className="ico">{ico}</span>{label}</button>
        ))}
      </nav>
    </div>
  );
}
