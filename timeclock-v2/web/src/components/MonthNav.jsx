import React from "react";
import { shiftYm, ymLabel } from "../util.js";
export default function MonthNav({ ym, onChange, max }) {
  const canNext = !max || ym < max;
  return (
    <div className="month-nav">
      <button className="btn sm" onClick={() => onChange(shiftYm(ym, -1))}>‹</button>
      <div className="ym">{ymLabel(ym)}</div>
      <button className="btn sm" onClick={() => onChange(shiftYm(ym, 1))} disabled={!canNext}>›</button>
    </div>
  );
}
