import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import MonthNav from "./MonthNav.jsx";
import MonthTable from "./MonthTable.jsx";
import { currentYm } from "../util.js";

export default function MyRecords({ me, flash }) {
  const tz = me.company.rules.timezone;
  const [ym, setYm] = useState(() => currentYm(tz));
  const [month, setMonth] = useState(null);
  useEffect(() => {
    let alive = true;
    setMonth(null);
    api.get(`/api/me/months/${ym}`).then((m) => alive && setMonth(m)).catch((e) => flash(e.message, "error"));
    return () => { alive = false; };
  }, [ym]);
  return (
    <div>
      <MonthNav ym={ym} onChange={setYm} max={currentYm(tz)} />
      <div className="card tight">
        {month ? <MonthTable month={month} tz={tz} hideEmpty /> : <div className="empty">載入中…</div>}
      </div>
      <p className="small faint">只顯示有打卡的日子。若有「未打上班／下班」請告知管理員補登。</p>
    </div>
  );
}
