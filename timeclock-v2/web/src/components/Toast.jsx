import React, { useEffect, useState } from "react";

export default function Toast({ toast }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), toast.tone === "error" ? 4500 : 2800);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || !visible) return null;
  return <div className={`toast ${toast.tone}`} role="status">{toast.msg}</div>;
}
