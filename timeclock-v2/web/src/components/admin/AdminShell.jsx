import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../api.js";
import Attendance from "./Attendance.jsx";
import Staff from "./Staff.jsx";
import Salary from "./Salary.jsx";
import Settings from "./Settings.jsx";

const TABS = [["attendance", "考勤"], ["staff", "員工"], ["salary", "薪資"], ["settings", "設定"]];

export default function AdminShell({ me, refreshMe, logout, flash }) {
  const [tab, setTab] = useState("attendance");
  const [employees, setEmployees] = useState(null);

  const loadEmployees = useCallback(async () => {
    try { const r = await api.get("/api/admin/employees"); setEmployees(r.employees); return r.employees; }
    catch (e) { if (e.status === 401) await refreshMe().catch(() => {}); else flash(e.message, "error"); }
  }, [flash, refreshMe]);
  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  const pendingCount = employees?.filter((e) => e.status === "pending").length || 0;
  const common = { me, employees: employees || [], setEmployees, reloadEmployees: loadEmployees, flash, refreshMe };

  return (
    <div className="shell">
      <div className="topbar">
        <div><div className="brand">{me.company.name}</div><div className="small faint">管理員 · {me.user.name}</div></div>
        <button className="btn ghost sm" onClick={logout}>登出</button>
      </div>
      <div className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{label}{k === "staff" && pendingCount > 0 ? ` (${pendingCount})` : ""}</button>
        ))}
      </div>
      {employees === null ? <div className="empty">載入中…</div> : (
        <>
          {tab === "attendance" && <Attendance {...common} />}
          {tab === "staff" && <Staff {...common} />}
          {tab === "salary" && <Salary {...common} />}
          {tab === "settings" && <Settings {...common} />}
        </>
      )}
    </div>
  );
}
