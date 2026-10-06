import React, { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import Toast from "./components/Toast.jsx";
import SetupView from "./components/SetupView.jsx";
import LoginView from "./components/LoginView.jsx";
import PendingView from "./components/PendingView.jsx";
import EmployeeShell from "./components/EmployeeShell.jsx";
import AdminShell from "./components/admin/AdminShell.jsx";

export default function App() {
  const [phase, setPhase] = useState("loading"); // loading | setup | login | app | error
  const [me, setMe] = useState(null);
  const [toast, setToast] = useState(null);

  const flash = useCallback((msg, tone = "info") => { setToast({ msg, tone, at: Date.now() }); }, []);

  const boot = useCallback(async () => {
    try {
      const s = await api.get("/api/setup/status");
      if (s.needsSetup) { setPhase("setup"); return; }
      try { setMe(await api.get("/api/me")); setPhase("app"); }
      catch (e) { if (e.status === 401) setPhase("login"); else throw e; }
    } catch (e) {
      setPhase("error");
      flash(e.message, "error");
    }
  }, [flash]);

  useEffect(() => { boot(); }, [boot]);

  const refreshMe = useCallback(async () => {
    try { const m = await api.get("/api/me"); setMe(m); return m; }
    catch (e) { if (e.status === 401) { setMe(null); setPhase("login"); } throw e; }
  }, []);

  const onLogin = (m) => { setMe(m); setPhase("app"); };
  const logout = async () => {
    try { await api.post("/api/auth/logout"); } catch {}
    setMe(null); setPhase("login");
  };

  let view = null;
  if (phase === "loading") view = <div className="shell narrow"><div className="empty">載入中…</div></div>;
  else if (phase === "error") view = <div className="shell narrow"><div className="card center"><p>無法連線到伺服器</p><button className="btn" onClick={boot}>重試</button></div></div>;
  else if (phase === "setup") view = <SetupView onDone={onLogin} flash={flash} />;
  else if (phase === "login") view = <LoginView onLogin={onLogin} flash={flash} />;
  else if (me?.user.role === "admin") view = <AdminShell me={me} refreshMe={refreshMe} logout={logout} flash={flash} />;
  else if (me?.user.status === "pending") view = <PendingView me={me} refreshMe={refreshMe} logout={logout} />;
  else view = <EmployeeShell me={me} refreshMe={refreshMe} logout={logout} flash={flash} />;

  return <>{view}<Toast toast={toast} /></>;
}
