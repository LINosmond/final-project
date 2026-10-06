import React from "react";
export default function Field({ label, children, help }) {
  return <div className="field"><label>{label}</label>{children}{help && <div className="help">{help}</div>}</div>;
}
