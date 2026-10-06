import React from "react";
import { fmtHM, hours, dateKeyParts, WEEKDAY } from "../util.js";

// 一個月每天一列。month 來自 /months/:ym 或 /admin/attendance/:ym/:id（含 in/out 打卡物件）
export default function MonthTable({ month, tz, onDayClick, showActual = false, hideEmpty = false }) {
  const unmatchedByDay = new Map();
  for (const u of month.unmatched || []) unmatchedByDay.set(u.dateKey, [...(unmatchedByDay.get(u.dateKey) || []), u]);
  const t = month.totals;
  const rows = hideEmpty ? month.days.filter((d) => d.totalMin || unmatchedByDay.has(d.dateKey)) : month.days;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>日期</th><th>時段</th><th className="num">工時</th><th className="num">加班</th><th>備註</th></tr></thead>
        <tbody>
          {rows.map((d) => {
            const { d: day, weekday } = dateKeyParts(d.dateKey);
            const um = unmatchedByDay.get(d.dateKey) || [];
            const cls = [d.isHoliday ? "holiday" : "", weekday === 0 || weekday === 6 ? "weekend" : "", onDayClick ? "clickable" : ""].join(" ");
            return (
              <tr key={d.dateKey} className={cls} onClick={onDayClick ? () => onDayClick(d) : undefined}>
                <td className="mono">{day} <span className="faint">{WEEKDAY[weekday]}</span></td>
                <td>
                  {d.sessions.map((s) => (
                    <div key={s.inId} className="mono small">
                      {fmtHM(s.inTs, tz)}–{fmtHM(s.outTs, tz)}{s.outTs - s.inTs > 0 && fmtHM(s.outTs, tz) <= fmtHM(s.inTs, tz) ? <span className="faint">（隔日）</span> : null}
                      {showActual && (s.in?.actualTs || s.out?.actualTs) && (
                        <span className="faint"> （實際 {s.in?.actualTs ? fmtHM(s.in.actualTs, tz) : "–"} / {s.out?.actualTs ? fmtHM(s.out.actualTs, tz) : "–"}）</span>
                      )}
                      {showActual && (s.in?.source === "admin" || s.out?.source === "admin") && <span className="tag" style={{ marginLeft: 6 }}>補登</span>}
                    </div>
                  ))}
                  {um.map((u) => <div key={u.id} className="small red">{u.type === "in" ? "上班" : "下班"} {fmtHM(u.ts, tz)} · {u.reason === "missing_out" ? "未打下班" : "未打上班"}</div>)}
                </td>
                <td className="num">{hours(d.totalMin)}</td>
                <td className="num">{d.otMin ? hours(d.otMin) : ""}</td>
                <td>{d.isHoliday && <span className="tag brass">假日 ×{month.rules?.holidayRate ?? 2}</span>}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th>合計</th>
            <th className="small muted">{t.workDays} 個工作日</th>
            <th className="num">{hours(t.totalMin)}</th>
            <th className="num">{t.otMin ? hours(t.otMin) : ""}</th>
            <th className="small muted">{t.holidayMin ? `假日 ${hours(t.holidayMin)} 小時` : ""}{t.segments?.length ? ` · 加班 ${t.segments.map((s) => `${hours(s.minutes)}h×${s.rate}`).join("、")}` : ""}</th>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
