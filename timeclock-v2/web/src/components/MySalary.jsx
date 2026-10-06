import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import PaySlip from "./PaySlip.jsx";
import { ymLabel } from "../util.js";

export default function MySalary({ me, flash }) {
  const [info, setInfo] = useState(null);
  const [ym, setYm] = useState("");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.get("/api/me/salary").then((i) => { setInfo(i); setYm(i.publishedMonths[0] || i.defaultYm); }).catch((e) => flash(e.message, "error")); }, []);
  useEffect(() => {
    if (!ym || !info?.salaryVisible) return;
    setData(null); setErr("");
    api.get(`/api/me/salary/${ym}`).then(setData).catch((e) => setErr(e.message));
  }, [ym, info]);
  if (!info) return <div className="empty">載入中…</div>;
  if (!info.salaryVisible) return <div className="card center"><p className="muted">管理員尚未開放查看薪資。</p></div>;
  return (
    <div>
      <div className="field"><label>月份</label>
        <select className="input" value={ym} onChange={(e) => setYm(e.target.value)}>
          {!info.publishedMonths.includes(ym) && <option value={ym}>{ymLabel(ym)}</option>}
          {info.publishedMonths.map((m) => <option key={m} value={m}>{ymLabel(m)}</option>)}
        </select>
      </div>
      {err && <div className="card center muted">{err}</div>}
      {data && <PaySlip pay={data.pay} name={me.user.name} ym={data.ym} companyName={me.company.name} />}
      <p className="small faint">薪資以管理員發佈的版本為準，有疑問請直接詢問管理員。</p>
    </div>
  );
}
