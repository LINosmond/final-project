import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";

const FONT_IMPORT = "https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap";

const COLORS = {
  bg: "#1B1A17",
  panel: "#242220",
  panelRaised: "#2E2B27",
  border: "#3A362F",
  borderSoft: "#302D28",
  brass: "#C99A3B",
  brassDim: "#8A6B2C",
  brassSoft: "#3A331F",
  green: "#5B9279",
  greenSoft: "#233129",
  red: "#B05B4E",
  redSoft: "#332420",
  text: "#F1ECE1",
  textMuted: "#9C9689",
  textFaint: "#6E6A60",
  cardPaper: "#FBFAF4",
  cardBlue: "#2C5F94",
  cardBlueSoft: "#DCE7F0",
  cardLine: "#B9CBDD",
  cardRedBg: "#F7DEDC",
  cardRedText: "#B23B2E",
  cardAmberBg: "#F5E7C6",
  cardAmberText: "#8A5F12",
};

function pad2(n) { return String(n).padStart(2, "0"); }

function fmtHM(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtDateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function fmtDateLabel(d) {
  const wd = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()} ${wd}`;
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 打卡採整點／半點制：算出當下時間「前一個」與「後一個」半點，讓員工自己選
function halfHourOptions(date) {
  const mins = date.getHours() * 60 + date.getMinutes();
  const prev = Math.floor(mins / 30) * 30;
  const next = Math.min(prev + 30, 24 * 60 - 30);
  const toObj = (m) => ({ minutes: m, h: Math.floor(m / 60), m: m % 60 });
  return prev === next ? [toObj(prev)] : [toObj(prev), toObj(next)];
}

// 管理員補登／修改時間：全天所有半點時刻（00:00, 00:30, ... 23:30）
const HALF_HOUR_SLOTS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

function normalizePhone(v) {
  return String(v || "").replace(/\s|-/g, "");
}

// 計算兩個經緯度之間的距離（公尺）
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 取得目前裝置定位（Promise 包裝）
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("此裝置或瀏覽器不支援定位功能"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });
}

const ADMIN_ACCOUNT = { name: "上盛", password: "451689" };

// 台灣國定假日自動偵測
// 2025、2026 為行政院人事行政總處公告之精確日期（含補假、小年夜等）
// 其餘年份則以固定國曆日期的假日做保守偵測（無法涵蓋農曆節日與補假調整）
const TAIWAN_HOLIDAYS_BY_YEAR = {
  2025: [
    "2025-01-01", // 元旦
    "2025-01-27", // 小年夜（除夕前一日）
    "2025-01-28", // 除夕
    "2025-01-29", // 春節初一
    "2025-01-30", // 春節初二
    "2025-01-31", // 春節初三
    "2025-02-28", // 和平紀念日
    "2025-04-03", // 兒童節及民族掃墓節同一日，前一日補假
    "2025-04-04", // 兒童節／民族掃墓節
    "2025-05-01", // 勞動節
    "2025-05-30", // 端午節補假
    "2025-05-31", // 端午節
    "2025-09-28", // 教師節（逢週日）
    "2025-09-29", // 教師節補假
    "2025-10-06", // 中秋節
    "2025-10-10", // 國慶日
    "2025-10-24", // 台灣光復節補假
    "2025-10-25", // 台灣光復節
    "2025-12-25", // 行憲紀念日
  ],
  2026: [
    "2026-01-01", // 元旦
    "2026-02-15", // 小年夜
    "2026-02-16", // 除夕
    "2026-02-17", // 春節初一
    "2026-02-18", // 春節初二
    "2026-02-19", // 春節初三
    "2026-02-20", // 小年夜補假
    "2026-02-27", // 和平紀念日補假
    "2026-02-28", // 和平紀念日
    "2026-04-03", // 兒童節補假
    "2026-04-04", // 兒童節
    "2026-04-05", // 清明節
    "2026-04-06", // 清明節補假
    "2026-05-01", // 勞動節
    "2026-06-19", // 端午節
    "2026-09-25", // 中秋節
    "2026-09-28", // 教師節
    "2026-10-09", // 國慶日補假
    "2026-10-10", // 國慶日
    "2026-10-25", // 台灣光復節
    "2026-10-26", // 台灣光復節補假
    "2026-12-25", // 行憲紀念日
  ],
};

// 沒有精確資料的年份，退而求其次偵測固定國曆日期的假日（無法涵蓋農曆節日、補假調整）
const FIXED_MD_HOLIDAYS = new Set(["01-01", "02-28", "04-04", "05-01", "09-28", "10-10", "10-25", "12-25"]);

function isAutoHoliday(dateKey) {
  const year = dateKey.slice(0, 4);
  const list = TAIWAN_HOLIDAYS_BY_YEAR[year];
  if (list) return list.includes(dateKey);
  return FIXED_MD_HOLIDAYS.has(dateKey.slice(5));
}

function FlapDigit({ value }) {
  return (
    <span
      key={value}
      style={{
        display: "inline-block",
        fontFamily: "'Space Mono', monospace",
        fontWeight: 700,
        fontSize: 40,
        color: COLORS.text,
        background: COLORS.panelRaised,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 6,
        padding: "4px 6px",
        minWidth: 30,
        textAlign: "center",
        animation: "flapIn 0.25s ease-out",
      }}
    >
      {value}
    </span>
  );
}

function SplitFlapClock({ now }) {
  const h = pad2(now.getHours()).split("");
  const m = pad2(now.getMinutes()).split("");
  const s = pad2(now.getSeconds()).split("");
  const Sep = () => (
    <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 32, color: COLORS.brass, padding: "0 2px", alignSelf: "center" }}>:</span>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
      {h.map((d, i) => <FlapDigit key={"h" + i} value={d} />)}
      <Sep />
      {m.map((d, i) => <FlapDigit key={"m" + i} value={d} />)}
      <Sep />
      {s.map((d, i) => <FlapDigit key={"s" + i} value={d} />)}
    </div>
  );
}

function LedgerCard({ children }) {
  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 10,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 4,
        backgroundImage: `repeating-linear-gradient(90deg, ${COLORS.bg} 0 6px, transparent 6px 12px)`,
      }} />
      <div style={{ paddingTop: 10 }}>{children}</div>
    </div>
  );
}

function Toast({ msg, tone }) {
  if (!msg) return null;
  const isErr = tone === "error";
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 20,
      background: isErr ? COLORS.redSoft : COLORS.brassSoft,
      border: `1px solid ${isErr ? "#A9584B" : COLORS.brassDim}`,
      color: isErr ? COLORS.red : COLORS.brass,
      borderRadius: 8, padding: "8px 12px",
      fontSize: 13, fontFamily: "'IBM Plex Sans', sans-serif", textAlign: "center",
      marginBottom: 12,
    }}>
      {msg}
    </div>
  );
}

function TextField({ label, ...props }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>{label}</label>
      <input
        {...props}
        style={{
          width: "100%", padding: "11px 12px", borderRadius: 8,
          background: COLORS.panelRaised, border: `1px solid ${COLORS.border}`,
          color: COLORS.text, fontSize: 15, outline: "none",
        }}
      />
    </div>
  );
}

// 密碼顯示切換用的眼睛圖示：off=false 是睜眼（目前隱藏，可點開）、off=true 是劃掉的眼睛（目前顯示，可點關）
function EyeIcon({ off }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {off ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

function LoginView({ employees, onLogin, flash }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const n = name.trim();
    const p = normalizePhone(phone);
    if (!n) return flash("請輸入姓名（帳號）", "error");
    const isAdminAttempt = n === ADMIN_ACCOUNT.name;
    if (!p || (!isAdminAttempt && p.length < 8)) return flash("請輸入正確的手機號碼（密碼）", "error");

    setBusy(true);
    const result = await onLogin(n, p);
    setBusy(false);
    if (result === "wrong") flash("姓名或手機號碼不正確", "error");
  };

  const existing = employees.find((e) => e.name === name.trim());
  const isAdminName = name.trim() === ADMIN_ACCOUNT.name;

  return (
    <div>
      <div style={{ textAlign: "center", margin: "24px 0 28px" }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: COLORS.textFaint, textTransform: "uppercase" }}>sign in</div>
        <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>員工登入</div>
        <div style={{ fontSize: 12, color: COLORS.textFaint, marginTop: 6 }}>
          帳號為姓名，密碼為手機號碼。第一次登入將自動建立帳號。
        </div>
      </div>

      <TextField
        label="姓名（帳號）"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="請輸入姓名"
      />
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: COLORS.textMuted, display: "block", marginBottom: 6 }}>手機號碼（密碼）</label>
        <div style={{ position: "relative" }}>
          <input
            type={showPw ? "text" : "password"}
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="請輸入手機號碼"
            style={{
              width: "100%", padding: "11px 44px 11px 12px", borderRadius: 8,
              background: COLORS.panelRaised, border: `1px solid ${COLORS.border}`,
              color: COLORS.text, fontSize: 15, outline: "none",
            }}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? "隱藏密碼" : "顯示密碼"}
            title={showPw ? "隱藏密碼" : "顯示密碼"}
            style={{
              position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer",
              color: showPw ? COLORS.brass : COLORS.textMuted,
              padding: 6, display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <EyeIcon off={showPw} />
          </button>
        </div>
      </div>

      <button
        onClick={submit}
        disabled={busy}
        style={{
          width: "100%", padding: "13px 0", borderRadius: 10, border: "none",
          background: COLORS.brass, color: "#1B1A17", fontWeight: 700, fontSize: 15,
          cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, marginTop: 4,
        }}
      >
        {existing || isAdminName ? "登入" : "建立帳號並登入"}
      </button>
    </div>
  );
}

// 待審核帳號登入後看到的畫面：不能打卡，等管理員通過後（靠輪詢重新載入）會自動切換成打卡畫面
function PendingView({ emp }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 20px" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🕓</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: COLORS.text, marginBottom: 10 }}>
        等待管理員審核
      </div>
      <div style={{ fontSize: 14, color: COLORS.textMuted, lineHeight: 1.7, maxWidth: 320, margin: "0 auto" }}>
        {emp?.name ? <b style={{ color: COLORS.brass }}>{emp.name}</b> : "您"} 的帳號申請已送出。<br />
        管理員審核通過後，就能開始打卡，這個畫面會自動切換，不用重新登入。
      </div>
      <div style={{
        marginTop: 20, display: "inline-block",
        background: COLORS.brassSoft, border: `1px solid ${COLORS.brassDim}`,
        color: COLORS.brass, borderRadius: 8, padding: "6px 14px", fontSize: 12,
      }}>
        狀態：待審核
      </div>
    </div>
  );
}

export default function TimeClockApp() {
  const [now, setNow] = useState(new Date());
  const [tab, setTab] = useState("punch");
  const [employees, setEmployees] = useState(null);
  const [punches, setPunches] = useState(null);
  const [holidays, setHolidays] = useState(null); // array of "YYYY-MM-DD" strings
  const [companyLocation, setCompanyLocation] = useState(null); // { lat, lng, radius } or null = 不限制
  const [otMultiplier, setOtMultiplier] = useState(null); // 平日超過 8 小時部分的工時倍率，預設 2
  const [sessionId, setSessionId] = useState("");
  const [sessionType, setSessionType] = useState(""); // "employee" | "admin"
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [toastTone, setToastTone] = useState("info");
  const toastTimer = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const flash = useCallback((msg, tone = "info") => {
    setToast(msg);
    setToastTone(tone);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  const loadAll = useCallback(async () => {
    const KEYS = ["employees", "punches", "holidays", "companyLocation", "otMultiplier"];

    // 先試著用 getAll 一次抓齊所有資料（只打一次 Apps Script，載入快很多）。
    // 若後端還是舊版（不認得 getAll）或發生網路錯誤，raw 會維持 null，改走下方逐一讀取的相容路徑。
    let raw = null;
    try {
      const values = await window.storage.getAll(KEYS);
      raw = {};
      KEYS.forEach((k) => { raw[k] = values[k] != null ? values[k] : null; });
    } catch (e) {
      raw = null;
    }

    // 相容路徑：逐一讀取。讀取失敗的 key 標記為 undefined，代表「保留現有資料、不要覆寫」，
    // 避免暫時性網路錯誤把畫面「登出」或清空。
    if (!raw) {
      raw = {};
      for (const k of KEYS) {
        try {
          const res = await window.storage.get(k, true);
          raw[k] = res ? res.value : null;
        } catch (e) {
          raw[k] = undefined;
        }
      }
    }

    // undefined＝讀取失敗保留現狀；null＝尚無資料，套用預設值；其餘＝解析 JSON
    const parse = (value, fallback) => {
      if (value === undefined) return undefined;
      if (value == null) return fallback;
      try { return JSON.parse(value); } catch (e) { return fallback; }
    };

    const emp = parse(raw.employees, []);
    if (emp !== undefined) setEmployees(emp);

    const pun = parse(raw.punches, []);
    if (pun !== undefined) setPunches(pun);

    let hol = parse(raw.holidays, {});
    if (hol !== undefined) {
      if (Array.isArray(hol)) {
        // 相容舊版資料格式（純日期陣列）：轉換成覆寫表
        const migrated = {};
        hol.forEach((d) => { migrated[d] = true; });
        hol = migrated;
      }
      setHolidays(hol);
    }

    const loc = parse(raw.companyLocation, null);
    if (loc !== undefined) setCompanyLocation(loc);

    const ot = parse(raw.otMultiplier, 2);
    if (ot !== undefined) setOtMultiplier(ot);
  }, []);

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 6000);
    return () => clearInterval(t);
  }, [loadAll]);

  const [sessionChecked, setSessionChecked] = useState(false);

  // 還原上次登入狀態：等員工資料載入完成後，看看這台裝置有沒有記住的帳號（只嘗試一次，避免每次輪詢都重讀）
  useEffect(() => {
    if (employees === null || sessionChecked) return;
    (async () => {
      try {
        const saved = await window.storage.get("session", false);
        if (saved && saved.value) {
          const parsed = JSON.parse(saved.value);
          if (parsed.type === "admin") {
            setSessionId("admin");
            setSessionType("admin");
          } else if (parsed.type === "employee" && employees.some((e) => e.id === parsed.id)) {
            setSessionId(parsed.id);
            setSessionType("employee");
          }
        }
      } catch (e) {
        // 沒有記住的登入資訊，維持在登入畫面即可
      } finally {
        setSessionChecked(true);
      }
    })();
  }, [employees, sessionChecked]);

  const saveEmployees = async (next) => {
    setEmployees(next);
    try {
      await window.storage.set("employees", JSON.stringify(next), true);
    } catch (e) {
      flash("儲存帳號資料失敗，請稍後再試", "error");
    }
  };

  const savePunches = async (next) => {
    setPunches(next);
    try {
      await window.storage.set("punches", JSON.stringify(next), true);
    } catch (e) {
      flash("打卡儲存失敗，請稍後再試", "error");
    }
  };

  const saveHolidays = async (next) => {
    setHolidays(next);
    try {
      await window.storage.set("holidays", JSON.stringify(next), true);
    } catch (e) {
      flash("國定假日設定儲存失敗，請稍後再試", "error");
    }
  };

  const toggleHoliday = async (dateKey, checked) => {
    const next = { ...(holidays || {}), [dateKey]: checked };
    await saveHolidays(next);
  };

  const saveCompanyLocation = async (loc) => {
    setCompanyLocation(loc);
    try {
      await window.storage.set("companyLocation", JSON.stringify(loc), true);
      flash("已更新打卡地點限制");
    } catch (e) {
      flash("儲存地點設定失敗，請稍後再試", "error");
    }
  };

  const clearCompanyLocation = async () => {
    setCompanyLocation(null);
    try {
      await window.storage.delete("companyLocation", true);
      flash("已停用打卡地點限制");
    } catch (e) {
      flash("停用失敗，請稍後再試", "error");
    }
  };

  const saveOtMultiplier = async (multiplier) => {
    setOtMultiplier(multiplier);
    try {
      await window.storage.set("otMultiplier", JSON.stringify(multiplier), true);
      flash("已更新超時倍率設定");
    } catch (e) {
      flash("儲存超時倍率失敗，請稍後再試", "error");
    }
  };

  const rememberSession = async (id, type) => {
    try {
      await window.storage.set("session", JSON.stringify({ id, type }), false);
    } catch (e) {
      // 記住登入狀態失敗不影響本次使用，忽略即可
    }
  };

  const handleLogin = async (name, phone) => {
    if (name === ADMIN_ACCOUNT.name && phone === ADMIN_ACCOUNT.password) {
      setSessionId("admin");
      setSessionType("admin");
      await rememberSession("admin", "admin");
      flash(`管理員登入成功`);
      return "ok";
    }
    // 用伺服器端的原子操作查詢／建立帳號，避免兩台裝置幾乎同時用同一個姓名
    // 登入時，其中一邊剛建立的帳號被另一邊覆蓋掉
    let result;
    try {
      result = await window.storage.findOrCreateEmployee(name, phone);
    } catch (e) {
      flash("登入失敗，請稍後再試", "error");
      return "wrong";
    }
    setEmployees(result.employees);
    const emp = result.employee;
    if (!result.created && emp.phone !== phone) {
      return "wrong";
    }
    setSessionId(emp.id);
    setSessionType("employee");
    await rememberSession(emp.id, "employee");
    // 待審核帳號：登入後停在「等待審核」畫面（不能打卡），管理員通過後畫面會自動切換
    if (emp.status === "pending") {
      flash(result.created ? "已送出申請，請等待管理員審核通過" : "你的帳號正在等待管理員審核");
    } else {
      flash(result.created ? `已建立帳號，歡迎 ${name}` : `歡迎回來，${emp.name}`);
    }
    return "ok";
  };

  const reviewEmployee = async (id, decision) => {
    const target = (employees || []).find((e) => e.id === id);
    setBusy(true);
    try {
      // 伺服器端原子審核，避免與其他人同時申請時互相覆蓋
      const fresh = await window.storage.reviewEmployee(id, decision);
      setEmployees(fresh);
    } catch (e) {
      // 後端若尚未支援 reviewEmployee，退回本地修改後整包寫回（仍可運作，但少了原子保護）
      const next = decision === "approve"
        ? (employees || []).map((e) => (e.id === id ? { ...e, status: "active" } : e))
        : (employees || []).filter((e) => e.id !== id);
      await saveEmployees(next);
    }
    setBusy(false);
    flash(decision === "approve" ? `已通過「${target ? target.name : ""}」的申請` : `已拒絕「${target ? target.name : ""}」的申請`);
  };

  const handleLogout = async () => {
    setSessionId("");
    setSessionType("");
    setTab("punch");
    try {
      await window.storage.delete("session", false);
    } catch (e) {
      // 忽略刪除失敗
    }
  };

  // 資料備份／還原：讓管理員可以把資料下載成檔案，或從備份檔還原
  const exportBackup = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      employees: employees || [],
      punches: punches || [],
      holidays: holidays || {},
      otMultiplier: otMultiplier ?? 2,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `打卡系統備份_${fmtDateKey(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    flash("已匯出備份檔案");
  };

  const importBackup = async (file) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data.employees) || !Array.isArray(data.punches)) {
        flash("檔案格式不正確，無法還原", "error");
        return;
      }
      setBusy(true);
      await saveEmployees(data.employees);
      await savePunches(data.punches);
      await saveHolidays(data.holidays && typeof data.holidays === "object" ? data.holidays : {});
      await saveOtMultiplier(typeof data.otMultiplier === "number" && data.otMultiplier > 0 ? data.otMultiplier : 2);
      setBusy(false);
      flash("已從備份檔還原資料");
    } catch (e) {
      flash("讀取備份檔失敗，請確認檔案是否正確", "error");
    }
  };

  const sessionEmp = useMemo(
    () => (employees || []).find((e) => e.id === sessionId) || null,
    [employees, sessionId]
  );
  const isAdmin = sessionType === "admin";

  const employeePunchesToday = useMemo(() => {
    if (!punches || !sessionId) return [];
    const key = fmtDateKey(now);
    return punches
      .filter((p) => p.employeeId === sessionId && fmtDateKey(new Date(p.ts)) === key)
      .sort((a, b) => a.ts - b.ts);
  }, [punches, sessionId, now]);

  // 一天最多可以打兩次上班、兩次下班（有中午休息的員工：上午一次、下午一次）
  const todaySessionCounts = useMemo(() => {
    if (!punches || !sessionId) return { inCount: 0, outCount: 0 };
    const key = fmtDateKey(now);
    const mine = punches.filter((p) => p.employeeId === sessionId && fmtDateKey(new Date(p.ts)) === key);
    return {
      inCount: mine.filter((p) => p.type === "in").length,
      outCount: mine.filter((p) => p.type === "out").length,
    };
  }, [punches, sessionId, now]);

  const nextAction = useMemo(() => {
    const { inCount, outCount } = todaySessionCounts;
    if (inCount > outCount) return "out";
    if (inCount < 2) return "in";
    return null;
  }, [todaySessionCounts]);

  const doPunch = async (chosenMinutes) => {
    if (!sessionEmp || !punches || !nextAction) return;
    const type = nextAction;
    const d = new Date(now);
    d.setHours(Math.floor(chosenMinutes / 60), chosenMinutes % 60, 0, 0);

    if (companyLocation && companyLocation.radius) {
      setBusy(true);
      try {
        const pos = await getCurrentPosition();
        const dist = distanceMeters(
          pos.coords.latitude, pos.coords.longitude,
          companyLocation.lat, companyLocation.lng
        );
        if (dist > companyLocation.radius) {
          setBusy(false);
          flash(`你目前不在打卡範圍內（距離約 ${Math.round(dist)} 公尺，允許範圍 ${companyLocation.radius} 公尺）`, "error");
          return;
        }
      } catch (e) {
        setBusy(false);
        flash("無法取得你的目前位置，請開啟定位權限後再試一次", "error");
        return;
      }
    }

    const entry = { id: uid(), employeeId: sessionEmp.id, employeeName: sessionEmp.name, type, ts: d.getTime() };
    setBusy(true);
    try {
      // 用伺服器端的原子操作附加打卡紀錄，避免兩筆幾乎同時送出的打卡互相覆蓋
      const freshPunches = await window.storage.appendPunch(entry);
      setPunches(freshPunches);
      flash(`${sessionEmp.name} ${type === "in" ? "上班" : "下班"}打卡成功 · 記錄為 ${fmtHM(d)}`);
    } catch (e) {
      flash("打卡儲存失敗，請稍後再試", "error");
    }
    setBusy(false);
  };

  // 管理員：新增／移除員工帳號
  const addEmployeeAdmin = async (name, phone) => {
    const n = name.trim();
    const p = normalizePhone(phone);
    if (!n) return flash("請輸入姓名", "error");
    if (!p) return flash("請輸入手機號碼作為登入密碼", "error");
    if ((employees || []).some((e) => e.name === n)) return flash("這個姓名已經存在了", "error");
    setBusy(true);
    // 管理員手動新增的帳號直接視為已審核（active），不需再經審核流程
    await saveEmployees([...(employees || []), { id: uid(), name: n, phone: p, status: "active" }]);
    setBusy(false);
    flash(`已新增員工「${n}」`);
  };

  const removeEmployeeAdmin = async (id) => {
    const target = (employees || []).find((e) => e.id === id);
    setBusy(true);
    await saveEmployees((employees || []).filter((e) => e.id !== id));
    setBusy(false);
    flash(target ? `已移除「${target.name}」` : "已移除");
  };

  // 管理員：修改某位員工某一天的打卡時間（上午／下午各一組上班下班，清空欄位即可刪除該筆紀錄）
  const updateDayPunch = async (employeeId, employeeName, dateKey, times) => {
    if (!punches) return;
    const others = punches.filter(
      (p) => !(p.employeeId === employeeId && fmtDateKey(new Date(p.ts)) === dateKey)
    );
    const [y, m, d] = dateKey.split("-").map(Number);
    const built = [];
    const addIfSet = (hm, type) => {
      if (!hm) return;
      const [h, mi] = hm.split(":").map(Number);
      built.push({ id: uid(), employeeId, employeeName, type, ts: new Date(y, m - 1, d, h, mi, 0, 0).getTime() });
    };
    addIfSet(times.amIn, "in");
    addIfSet(times.amOut, "out");
    addIfSet(times.pmIn, "in");
    addIfSet(times.pmOut, "out");
    setBusy(true);
    await savePunches([...others, ...built]);
    setBusy(false);
    flash("已更新打卡紀錄");
  };

  const loading = employees === null || punches === null || holidays === null || otMultiplier === null || !sessionChecked;

  return (
    <div style={{
      fontFamily: "'IBM Plex Sans', sans-serif",
      background: COLORS.bg,
      color: COLORS.text,
      minHeight: "100vh",
      display: "flex",
      justifyContent: "center",
    }}>
      <style>{`
        @import url('${FONT_IMPORT}');
        @keyframes flapIn { from { transform: translateY(-6px); opacity: 0.4; } to { transform: translateY(0); opacity: 1; } }
        * { box-sizing: border-box; }
        input, select { font-family: 'IBM Plex Sans', sans-serif; }
        ::selection { background: ${COLORS.brassSoft}; }
        button {
          -webkit-user-select: none;
          user-select: none;
          -webkit-touch-callout: none;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
        }
      `}</style>

      <div style={{ width: "100%", maxWidth: 440, padding: "20px 16px 40px", minHeight: "100vh" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: 2, color: COLORS.textFaint, textTransform: "uppercase" }}>time clock</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: COLORS.text }}>員工打卡系統</div>
          </div>
          {(sessionEmp || isAdmin) && (
            <button
              onClick={handleLogout}
              style={{ background: "none", border: "none", color: COLORS.textFaint, fontSize: 12, cursor: "pointer" }}
            >
              {isAdmin ? `${ADMIN_ACCOUNT.name}（管理員）` : sessionEmp.name} · 登出
            </button>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: COLORS.textMuted, fontSize: 14 }}>載入中…</div>
        ) : !sessionEmp && !isAdmin ? (
          <>
            <Toast msg={toast} tone={toastTone} />
            <LoginView employees={employees} onLogin={handleLogin} flash={flash} />
          </>
        ) : isAdmin ? (
          <>
            <Toast msg={toast} tone={toastTone} />
            <AdminView
              employees={employees}
              punches={punches}
              holidays={holidays}
              canEdit
              onAddEmployee={addEmployeeAdmin}
              onRemoveEmployee={removeEmployeeAdmin}
              onUpdateDay={updateDayPunch}
              onToggleHoliday={toggleHoliday}
              onExportBackup={exportBackup}
              onImportBackup={importBackup}
              onReviewEmployee={reviewEmployee}
              companyLocation={companyLocation}
              onSaveLocation={saveCompanyLocation}
              onClearLocation={clearCompanyLocation}
              otMultiplier={otMultiplier}
              onSaveOtMultiplier={saveOtMultiplier}
              busy={busy}
            />
          </>
        ) : sessionEmp && sessionEmp.status === "pending" ? (
          <>
            <Toast msg={toast} tone={toastTone} />
            <PendingView emp={sessionEmp} />
          </>
        ) : (
          <>
            <div style={{ display: "flex", background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 4, marginBottom: 16 }}>
              {[["punch", "打卡"], ["admin", "我的紀錄"]].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    borderRadius: 7,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: 600,
                    fontFamily: "'IBM Plex Sans', sans-serif",
                    background: tab === key ? COLORS.brassSoft : "transparent",
                    color: tab === key ? COLORS.brass : COLORS.textMuted,
                    transition: "all 0.15s",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <Toast msg={toast} tone={toastTone} />

            {tab === "punch" ? (
              <PunchView
                now={now}
                sessionEmp={sessionEmp}
                nextAction={nextAction}
                sessionCounts={todaySessionCounts}
                doPunch={doPunch}
                busy={busy}
                todayPunches={employeePunchesToday}
                locationRestricted={!!(companyLocation && companyLocation.radius)}
              />
            ) : (
              <AdminView employees={employees} punches={punches} holidays={holidays} otMultiplier={otMultiplier} lockedEmployeeId={sessionEmp.id} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PunchView({ now, sessionEmp, nextAction, sessionCounts, doPunch, busy, todayPunches, locationRestricted }) {
  const [selected, setSelected] = useState(null);
  const options = halfHourOptions(now);
  const isOutNext = nextAction === "out";
  const done = nextAction === null;
  const actionLabel = isOutNext ? "下班打卡" : "上班打卡";
  const accentColor = isOutNext ? COLORS.red : COLORS.brass;
  const accentSoft = isOutNext ? COLORS.redSoft : COLORS.brassSoft;
  const accentBorder = isOutNext ? "#A9584B" : COLORS.brass;

  const { inCount = 0, outCount = 0 } = sessionCounts || {};
  let statusText = "未上班";
  if (done) statusText = "今日已完成打卡";
  else if (isOutNext) statusText = inCount > 1 ? "下午上班中" : "上班中";
  else if (inCount > 0 && inCount === outCount) statusText = "休息中（可再次上班打卡）";

  const confirm = () => {
    if (selected == null || done) return;
    doPunch(selected);
    setSelected(null);
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <SplitFlapClock now={now} />
        <div style={{ textAlign: "center", fontSize: 13, color: COLORS.textFaint, marginTop: 8 }}>
          {fmtDateLabel(now)} · 打卡採整點／半點制 · 一天可打兩次上下班
        </div>
        {locationRestricted && (
          <div style={{ textAlign: "center", fontSize: 11, color: COLORS.brass, marginTop: 4 }}>
            📍 打卡時需在公司範圍內，並允許定位權限
          </div>
        )}
      </div>

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: isOutNext ? COLORS.greenSoft : COLORS.panel,
        border: `1px solid ${isOutNext ? "#3E5A4C" : COLORS.border}`,
        borderRadius: 10, padding: "12px 14px", marginBottom: 18,
      }}>
        <div>
          <div style={{ fontSize: 13, color: COLORS.textMuted }}>目前狀態</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: done ? COLORS.textMuted : (isOutNext ? COLORS.green : COLORS.textMuted) }}>
            {statusText}
          </div>
        </div>
        <div style={{ fontSize: 13, color: COLORS.textFaint }}>{sessionEmp.name}</div>
      </div>

      {done ? (
        <div style={{
          textAlign: "center", padding: "20px 14px", marginBottom: 22,
          background: COLORS.panel, border: `1px solid ${COLORS.border}`,
          borderRadius: 12, fontSize: 13, color: COLORS.textMuted,
        }}>
          今天的上下班（含中午休息）都已經打過卡了，明天再來吧。
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8, letterSpacing: 1 }}>
            選擇 {actionLabel} 時間
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            {options.map((opt) => {
              const isSel = selected === opt.minutes;
              return (
                <button
                  key={opt.minutes}
                  onClick={() => setSelected(opt.minutes)}
                  disabled={busy}
                  style={{
                    flex: 1,
                    padding: "18px 0",
                    borderRadius: 14,
                    border: `2px solid ${isSel ? accentBorder : COLORS.border}`,
                    background: isSel ? accentSoft : COLORS.panel,
                    color: isSel ? accentColor : COLORS.textMuted,
                    fontFamily: "'Space Mono', monospace",
                    fontSize: 22,
                    fontWeight: 700,
                    cursor: busy ? "default" : "pointer",
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  {pad2(opt.h)}:{pad2(opt.m)}
                </button>
              );
            })}
          </div>

          <button
            onClick={confirm}
            disabled={busy || selected == null}
            style={{
              width: "100%",
              padding: "16px 0",
              borderRadius: 14,
              border: "none",
              background: selected == null ? COLORS.panelRaised : accentColor,
              color: selected == null ? COLORS.textFaint : "#1B1A17",
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: 1,
              cursor: busy || selected == null ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
              marginBottom: 22,
            }}
          >
            確定{actionLabel}
          </button>
        </>
      )}

      <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8, letterSpacing: 1 }}>
        今日紀錄
      </div>
      <LedgerCard>
        {todayPunches.length === 0 ? (
          <div style={{ padding: "16px 14px", fontSize: 13, color: COLORS.textFaint }}>
            今天還沒有打卡紀錄
          </div>
        ) : (
          todayPunches.map((p, i) => (
            <div
              key={p.id}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 14px",
                borderTop: i === 0 ? "none" : `1px dashed ${COLORS.borderSoft}`,
              }}
            >
              <span style={{ fontSize: 13, color: p.type === "in" ? COLORS.green : COLORS.red }}>
                {p.type === "in" ? "上班" : "下班"}
              </span>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 14, color: COLORS.text }}>
                {fmtHM(new Date(p.ts))}
              </span>
            </div>
          ))
        )}
      </LedgerCard>
    </div>
  );
}

// ---- 管理紀錄：考勤卡樣式 ----

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function buildDayCell(dayPunches) {
  const sorted = [...dayPunches].sort((a, b) => a.ts - b.ts);
  const ins = sorted.filter((p) => p.type === "in");
  const outs = sorted.filter((p) => p.type === "out");

  // 一天最多兩個時段（上午一次、下午一次，中間可休息）：依打卡順序對應到上午／下午欄位
  const am = { inTs: ins[0]?.ts ?? null, outTs: outs[0]?.ts ?? null };
  const pm = { inTs: ins[1]?.ts ?? null, outTs: outs[1]?.ts ?? null };

  const sessionMin = (inTs, outTs) => (inTs && outTs && outTs > inTs ? (outTs - inTs) / 60000 : 0);
  const subtotalMin = sessionMin(am.inTs, am.outTs) + sessionMin(pm.inTs, pm.outTs);

  return { am, pm, subtotalMin };
}

function fmtCell(ts) {
  return ts ? fmtHM(new Date(ts)) : "";
}

function fmtSubtotal(min) {
  if (!min) return "";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}:${pad2(m)}` : `${h}:00`;
}

// 供畫面表格與 CSV 匯出共用：判斷某一天是否為假日（覆寫表優先於自動偵測）
function resolveHolidayFor(dateKey, overrides) {
  const auto = isAutoHoliday(dateKey);
  const override = (overrides || {})[dateKey];
  return { isHoliday: override !== undefined ? override : auto, autoDetected: auto };
}

// 算出某位員工某個月每一天的打卡與工時（含假日 ×2、平日超時倍率），
// 抽成獨立函式讓「畫面上的考勤卡」與「CSV 匯出／全員彙總」共用同一套計算邏輯
function computeMonthRows(emp, punches, year, month, multiplier, overrides) {
  if (!emp) return [];
  const total = daysInMonth(year, month);
  const out = [];
  for (let day = 1; day <= total; day++) {
    const key = `${year}-${pad2(month)}-${pad2(day)}`;
    const dayPunches = punches.filter(
      (p) => p.employeeId === emp.id && fmtDateKey(new Date(p.ts)) === key
    );
    const cell = buildDayCell(dayPunches);
    const { isHoliday, autoDetected } = resolveHolidayFor(key, overrides);
    let displayMin, otMin;
    if (isHoliday) {
      displayMin = cell.subtotalMin * 2;
      otMin = 0;
    } else {
      const baseMin = Math.min(cell.subtotalMin, 480);
      otMin = Math.max(cell.subtotalMin - 480, 0);
      displayMin = baseMin + otMin * multiplier;
    }
    out.push({ day, dateKey: key, ...cell, isHoliday, autoDetected, displayMin, otMin });
  }
  return out;
}

// 把工時（分鐘）換成以「小時」為單位的數字，去掉多餘的小數尾數：
// 480 分 -> "8"、510 分 -> "8.5"、其餘（含倍率計算）最多保留兩位小數（例如 "1.34"）
function minToHours(min) {
  return String(Math.round((min / 60) * 100) / 100);
}

// CSV 欄位跳脫：含逗號、雙引號或換行時用雙引號包起來
function escapeCsv(v) {
  const s = String(v == null ? "" : v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// 把二維陣列組成 CSV 並觸發下載；開頭加上 UTF-8 BOM，確保 Excel 正確顯示中文
function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map(escapeCsv).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const WEEKDAY_SHORT = ["日", "一", "二", "三", "四", "五", "六"];

function optionRowStyle(active) {
  return {
    padding: "7px 10px", fontSize: 12, cursor: "pointer",
    background: active ? COLORS.cardBlueSoft : "#fff",
    color: "#1E2A33",
  };
}

function TimeSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const listRef = useRef(null);

  const openPicker = () => {
    const rect = btnRef.current.getBoundingClientRect();
    setCoords({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      const el = listRef.current && listRef.current.querySelector('[data-val="12:00"]');
      if (el) el.scrollIntoView({ block: "center" });
    });
    const onDocDown = (e) => {
      if (
        listRef.current && !listRef.current.contains(e.target) &&
        btnRef.current && !btnRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("touchstart", onDocDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("touchstart", onDocDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        onClick={openPicker}
        style={{
          width: 88, padding: "6px 4px", borderRadius: 6, fontSize: 12,
          border: `1px solid ${COLORS.cardBlue}`, background: "#fff", color: value ? "#1E2A33" : "#8A94A0",
          textAlign: "center", cursor: "pointer",
        }}
      >
        {value || "未打卡"}
      </button>
      {open && (
        <div
          ref={listRef}
          style={{
            position: "fixed", top: coords.top, left: coords.left, zIndex: 999,
            maxHeight: 200, overflowY: "auto", background: "#fff",
            border: `1px solid ${COLORS.cardBlue}`, borderRadius: 6, width: 88,
            boxShadow: "0 6px 18px rgba(0,0,0,0.3)",
          }}
        >
          <div data-val="" onClick={() => { onChange(""); setOpen(false); }} style={optionRowStyle(value === "")}>
            未打卡
          </div>
          {HALF_HOUR_SLOTS.map((t) => (
            <div key={t} data-val={t} onClick={() => { onChange(t); setOpen(false); }} style={optionRowStyle(value === t)}>
              {t}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function DayEditRow({ row, colCount, onSave, onClose, onToggleHoliday, busy }) {
  const [amIn, setAmIn] = useState(fmtCell(row.am.inTs));
  const [amOut, setAmOut] = useState(fmtCell(row.am.outTs));
  const [pmIn, setPmIn] = useState(fmtCell(row.pm.inTs));
  const [pmOut, setPmOut] = useState(fmtCell(row.pm.outTs));

  const labelStyle = { fontSize: 11, color: COLORS.cardBlue };

  return (
    <tr>
      <td colSpan={colCount} style={{ background: COLORS.cardBlueSoft, padding: "8px 10px", border: `1px solid ${COLORS.cardLine}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: COLORS.cardBlue, minWidth: 34 }}>{row.day} 日</span>
          <span style={labelStyle}>上午</span>
          <TimeSelect value={amIn} onChange={setAmIn} />
          <span style={{ ...labelStyle, opacity: 0.6 }}>～</span>
          <TimeSelect value={amOut} onChange={setAmOut} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <span style={{ ...labelStyle, minWidth: 34 }}>下午</span>
          <TimeSelect value={pmIn} onChange={setPmIn} />
          <span style={{ ...labelStyle, opacity: 0.6 }}>～</span>
          <TimeSelect value={pmOut} onChange={setPmOut} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <button
            onClick={() => onSave({ amIn, amOut, pmIn, pmOut })}
            disabled={busy}
            style={{
              padding: "6px 12px", borderRadius: 6, border: "none",
              background: COLORS.cardBlue, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            儲存
          </button>
          <button
            onClick={onClose}
            style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${COLORS.cardLine}`, background: "#fff", color: "#5A6570", fontSize: 12, cursor: "pointer" }}
          >
            取消
          </button>
          <label style={{
            display: "flex", alignItems: "center", gap: 5, fontSize: 11,
            color: row.isHoliday ? COLORS.cardRedText : COLORS.cardBlue,
            fontWeight: row.isHoliday ? 700 : 400,
            width: "100%", marginTop: 2,
          }}>
            <input
              type="checkbox"
              checked={!!row.isHoliday}
              onChange={(e) => onToggleHoliday(row.dateKey, e.target.checked)}
              style={{ accentColor: COLORS.cardRedText }}
            />
            國定假日（工時 ×2）
            {row.autoDetected && <span style={{ opacity: 0.7, fontWeight: 400 }}>（系統自動偵測，可取消勾選覆寫）</span>}
          </label>
        </div>
      </td>
    </tr>
  );
}

function AdminView({ employees, punches, holidays, canEdit, lockedEmployeeId, onAddEmployee, onRemoveEmployee, onUpdateDay, onToggleHoliday, onExportBackup, onImportBackup, onReviewEmployee, companyLocation, onSaveLocation, onClearLocation, otMultiplier, onSaveOtMultiplier, busy }) {
  const multiplier = otMultiplier ?? 2;
  const today = new Date();
  const overrides = holidays || {};
  // 只有「已審核（active）」的員工才進入考勤名冊；待審核（pending）另外列在審核區。
  // 沒有 status 欄位的舊資料一律視為 active，維持相容。
  const activeEmployees = employees.filter((e) => e.status !== "pending");
  const pendingEmployees = employees.filter((e) => e.status === "pending");
  const [employeeId, setEmployeeId] = useState(lockedEmployeeId || activeEmployees[0]?.id || "");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [editingDay, setEditingDay] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [showAddEmp, setShowAddEmp] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  useEffect(() => {
    // 鎖定模式（員工只能看自己）時不需自動切換；其餘情況下目前選到的員工
    // 若不在 active 名冊中（例如剛被移除），自動選回第一位
    if (lockedEmployeeId) return;
    if (!activeEmployees.some((e) => e.id === employeeId)) {
      setEmployeeId(activeEmployees[0]?.id || "");
    }
  }, [employees, employeeId, lockedEmployeeId]);

  // 一般員工端只能看自己的卡：強制鎖定到本人；管理員則用下拉選單選人
  const selectedId = lockedEmployeeId || employeeId;
  const emp = activeEmployees.find((e) => e.id === selectedId);
  const total = daysInMonth(year, month);

  const rows = useMemo(
    () => computeMonthRows(emp, punches, year, month, multiplier, overrides),
    [emp, punches, year, month, multiplier, holidays]
  );

  const monthSubtotal = rows.reduce((s, r) => s + r.displayMin, 0);
  const monthRaw = rows.reduce((s, r) => s + r.subtotalMin, 0);
  const monthBonus = monthSubtotal - monthRaw;

  // 匯出目前這位員工的當月考勤成 CSV（工時以「小時」為單位，半小時顯示為 0.5，可用 Excel 開啟做薪資計算）
  const exportEmployeeCsv = () => {
    if (!emp) return;
    const header = ["日期", "星期", "上午上班", "上午下班", "下午上班", "下午下班", "原始工時(小時)", "假日", "計算後工時(小時)"];
    const body = rows.map((r) => {
      const [y, m, d] = r.dateKey.split("-").map(Number);
      const w = "週" + WEEKDAY_SHORT[new Date(y, m - 1, d).getDay()];
      return [
        `${month}/${r.day}`, w,
        fmtCell(r.am.inTs), fmtCell(r.am.outTs), fmtCell(r.pm.inTs), fmtCell(r.pm.outTs),
        r.subtotalMin ? minToHours(r.subtotalMin) : "",
        r.isHoliday ? "是" : "",
        r.displayMin ? minToHours(r.displayMin) : "",
      ];
    });
    const totalRow = ["本月小計", "", "", "", "", "", minToHours(monthRaw), "", minToHours(monthSubtotal)];
    downloadCsv(
      `考勤_${emp.name}_${year}-${pad2(month)}.csv`,
      [[`${emp.name}　${year}年${month}月　考勤卡（單位：小時）`], [], header, ...body, [], totalRow]
    );
  };

  // 匯出全體員工的當月工時彙總成 CSV（工時以「小時」為單位，一次看完所有人，方便薪資結算）
  const exportAllSummaryCsv = () => {
    const header = ["姓名", "原始工時(小時)", "加乘(小時)", "本月合計(小時)"];
    const body = activeEmployees.map((e) => {
      const rws = computeMonthRows(e, punches, year, month, multiplier, overrides);
      const sub = rws.reduce((s, r) => s + r.displayMin, 0);
      const raw = rws.reduce((s, r) => s + r.subtotalMin, 0);
      return [e.name, minToHours(raw), minToHours(sub - raw), minToHours(sub)];
    });
    downloadCsv(
      `月度彙總_${year}-${pad2(month)}.csv`,
      [[`${year}年${month}月　全員工時彙總（單位：小時）`], [], header, ...body]
    );
  };

  const submitAddEmployee = async () => {
    if (!newName.trim() || !newPhone.trim()) return;
    await onAddEmployee(newName, newPhone);
    setNewName("");
    setNewPhone("");
    setShowAddEmp(false);
  };

  if (!activeEmployees.length) {
    return (
      <div>
        {canEdit && (
          <>
            <PendingApprovalPanel pending={pendingEmployees} onReview={onReviewEmployee} busy={busy} />
            <LocationPanel companyLocation={companyLocation} onSave={onSaveLocation} onClear={onClearLocation} busy={busy} />
            <OvertimeRatePanel multiplier={multiplier} onSave={onSaveOtMultiplier} busy={busy} />
            <BackupPanel onExport={onExportBackup} onImport={onImportBackup} busy={busy} />
            <AddEmployeeForm
              showAddEmp={showAddEmp} setShowAddEmp={setShowAddEmp}
              newName={newName} setNewName={setNewName}
              newPhone={newPhone} setNewPhone={setNewPhone}
              submitAddEmployee={submitAddEmployee} busy={busy}
            />
          </>
        )}
        <div style={{ textAlign: "center", padding: "50px 0", color: COLORS.textMuted, fontSize: 13 }}>
          尚無員工帳號
        </div>
      </div>
    );
  }

  return (
    <div>
      {canEdit && (
        <>
          <PendingApprovalPanel pending={pendingEmployees} onReview={onReviewEmployee} busy={busy} />
          <LocationPanel companyLocation={companyLocation} onSave={onSaveLocation} onClear={onClearLocation} busy={busy} />
          <OvertimeRatePanel multiplier={multiplier} onSave={onSaveOtMultiplier} busy={busy} />
          <BackupPanel onExport={onExportBackup} onImport={onImportBackup} busy={busy} />
          <AddEmployeeForm
            showAddEmp={showAddEmp} setShowAddEmp={setShowAddEmp}
            newName={newName} setNewName={setNewName}
            newPhone={newPhone} setNewPhone={setNewPhone}
            submitAddEmployee={submitAddEmployee} busy={busy}
          />
          <AccountListPanel employees={activeEmployees} />
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {/* 鎖定模式（員工只能看自己）不顯示員工下拉選單，避免看到別人的卡 */}
        {!lockedEmployeeId && (
          <select
            value={employeeId}
            onChange={(e) => { setEmployeeId(e.target.value); setEditingDay(null); setConfirmRemove(false); }}
            style={{
              flex: 1.4, padding: "9px 10px", borderRadius: 8,
              background: COLORS.panelRaised, border: `1px solid ${COLORS.border}`,
              color: COLORS.text, fontSize: 13, outline: "none",
            }}
          >
            {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          style={{
            flex: 1, padding: "9px 10px", borderRadius: 8,
            background: COLORS.panelRaised, border: `1px solid ${COLORS.border}`,
            color: COLORS.text, fontSize: 13, outline: "none",
          }}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{m} 月</option>
          ))}
        </select>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          style={{
            flex: 1, padding: "9px 10px", borderRadius: 8,
            background: COLORS.panelRaised, border: `1px solid ${COLORS.border}`,
            color: COLORS.text, fontSize: 13, outline: "none",
          }}
        >
          {[today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {canEdit && emp && (
        !confirmRemove ? (
          <button
            onClick={() => setConfirmRemove(true)}
            style={{ background: "none", border: "none", color: COLORS.textFaint, fontSize: 12, cursor: "pointer", padding: 0, marginBottom: 14 }}
          >
            移除員工「{emp.name}」
          </button>
        ) : (
          <div style={{
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            background: COLORS.redSoft, border: `1px solid #A9584B`, borderRadius: 8,
            padding: "8px 10px", marginBottom: 14,
          }}>
            <span style={{ fontSize: 12, color: COLORS.red }}>確定要移除「{emp.name}」嗎？此動作無法復原</span>
            <button
              onClick={() => { onRemoveEmployee(emp.id); setConfirmRemove(false); }}
              disabled={busy}
              style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: COLORS.red, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              確定移除
            </button>
            <button
              onClick={() => setConfirmRemove(false)}
              style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${COLORS.border}`, background: "none", color: COLORS.textMuted, fontSize: 12, cursor: "pointer" }}
            >
              取消
            </button>
          </div>
        )
      )}

      {/* CSV 匯出僅限管理員；員工端（管理紀錄頁）不提供下載功能 */}
      {canEdit && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button
            onClick={exportEmployeeCsv}
            disabled={!emp}
            style={{
              flex: 1, minWidth: 150, padding: "9px 0", borderRadius: 8,
              border: `1px solid ${COLORS.brassDim}`, background: "none",
              color: COLORS.brass, fontSize: 13, fontWeight: 600,
              cursor: emp ? "pointer" : "default", opacity: emp ? 1 : 0.5,
            }}
          >
            ⤓ 匯出本月考勤 CSV
          </button>
          <button
            onClick={exportAllSummaryCsv}
            style={{
              flex: 1, minWidth: 150, padding: "9px 0", borderRadius: 8,
              border: `1px solid ${COLORS.brassDim}`, background: "none",
              color: COLORS.brass, fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            ⤓ 匯出全員月度彙總 CSV
          </button>
        </div>
      )}

      <div style={{
        background: COLORS.cardPaper,
        borderRadius: 8,
        border: `1px solid ${COLORS.cardBlue}`,
        overflow: "hidden",
        color: "#1E2A33",
      }}>
        <div style={{ background: COLORS.cardBlue, padding: "8px 12px", textAlign: "center", color: "#fff", fontSize: 15, fontWeight: 600, letterSpacing: 4 }}>
          考勤卡
        </div>
        <div style={{ padding: "10px 12px 4px", borderBottom: `1px solid ${COLORS.cardLine}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
            <span>姓名：<b>{emp?.name || "—"}</b></span>
            <span style={{ color: COLORS.cardBlue }}>{year} 年 {month} 月份</span>
          </div>
          {canEdit && (
            <div style={{ fontSize: 11, color: COLORS.cardBlue, opacity: 0.75 }}>系統會自動偵測國定假日；點選任一天也可手動修改上班／下班時間或覆寫假日設定</div>
          )}
          <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 10 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4, color: COLORS.cardRedText }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: COLORS.cardRedBg, border: `1px solid ${COLORS.cardRedText}`, display: "inline-block" }} />
              國定假日（全天 ×2）
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4, color: COLORS.cardAmberText }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: COLORS.cardAmberBg, border: `1px solid ${COLORS.cardAmberText}`, display: "inline-block" }} />
              超時（超過 8 小時 ×{multiplier}）
            </span>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 340 }}>
            <thead>
              <tr style={{ color: COLORS.cardBlue }}>
                <th rowSpan={2} style={thStyle(38)}>日期</th>
                <th colSpan={2} style={thStyle()}>上　午</th>
                <th colSpan={2} style={thStyle()}>下　午</th>
                <th rowSpan={2} style={thStyle(44)}>小計</th>
              </tr>
              <tr style={{ color: COLORS.cardBlue }}>
                <th style={thStyle()}>上班</th>
                <th style={thStyle()}>下班</th>
                <th style={thStyle()}>上班</th>
                <th style={thStyle()}>下班</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <React.Fragment key={r.day}>
                  <tr
                    onClick={() => canEdit && setEditingDay(editingDay === r.day ? null : r.day)}
                    style={{ cursor: canEdit ? "pointer" : "default", background: editingDay === r.day ? COLORS.cardBlueSoft : "transparent" }}
                  >
                    <td style={{ ...tdStyle(true), color: r.isHoliday ? COLORS.cardRedText : tdStyle(true).color, fontWeight: r.isHoliday ? 700 : 400 }}>
                      {r.day}{r.isHoliday ? " 假" : ""}
                    </td>
                    <td style={tdStyle()}>{fmtCell(r.am.inTs)}</td>
                    <td style={tdStyle()}>{fmtCell(r.am.outTs)}</td>
                    <td style={tdStyle()}>{fmtCell(r.pm.inTs)}</td>
                    <td style={tdStyle()}>{fmtCell(r.pm.outTs)}</td>
                    <td style={{
                      ...tdStyle(),
                      background: r.isHoliday ? COLORS.cardRedBg : (r.otMin > 0 ? COLORS.cardAmberBg : undefined),
                      color: r.isHoliday ? COLORS.cardRedText : (r.otMin > 0 ? COLORS.cardAmberText : tdStyle().color),
                      fontWeight: r.isHoliday || r.otMin > 0 ? 700 : 400,
                    }}>
                      {r.isHoliday ? (
                        r.subtotalMin > 0 && <div>{fmtSubtotal(r.subtotalMin)} ×2</div>
                      ) : (
                        <div>{fmtSubtotal(r.displayMin)}</div>
                      )}
                      {!r.isHoliday && r.otMin > 0 && (
                        <div style={{ fontSize: 9, fontWeight: 400 }}>+{fmtSubtotal(r.otMin)}×{multiplier}</div>
                      )}
                    </td>
                  </tr>
                  {canEdit && editingDay === r.day && (
                    <DayEditRow
                      row={r}
                      colCount={6}
                      busy={busy}
                      onClose={() => setEditingDay(null)}
                      onToggleHoliday={onToggleHoliday}
                      onSave={async (times) => {
                        await onUpdateDay(emp.id, emp.name, r.dateKey, times);
                        setEditingDay(null);
                      }}
                    />
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{
          padding: "10px 12px", borderTop: `1px solid ${COLORS.cardBlue}`,
          background: COLORS.cardBlueSoft,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: COLORS.cardBlue }}>本月小計（含加乘）</span>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 16, fontWeight: 700, color: COLORS.cardBlue }}>
              {fmtSubtotal(monthSubtotal) || "0:00"}
            </span>
          </div>
          {monthBonus > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 3 }}>
              <span style={{ fontSize: 10, color: COLORS.cardBlue, opacity: 0.75 }}>原始工時 {fmtSubtotal(monthRaw) || "0:00"}，加乘部分</span>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, fontWeight: 600, color: COLORS.cardRedText }}>
                +{fmtSubtotal(monthBonus)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LocationPanel({ companyLocation, onSave, onClear, busy }) {
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState(companyLocation?.address ?? "");
  const [lat, setLat] = useState(companyLocation?.lat ?? "");
  const [lng, setLng] = useState(companyLocation?.lng ?? "");
  const [radius, setRadius] = useState(companyLocation?.radius ?? 200);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  const inputStyle = {
    padding: "8px 10px", borderRadius: 8, background: COLORS.panelRaised,
    border: `1px solid ${COLORS.border}`, color: COLORS.text, fontSize: 13, outline: "none",
  };

  const useCurrentPosition = () => {
    setError("");
    setLocating(true);
    if (!navigator.geolocation) {
      setLocating(false);
      setError("此裝置或瀏覽器不支援定位功能");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setError("無法取得目前位置，請確認已允許定位權限");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const save = () => {
    const la = parseFloat(lat), ln = parseFloat(lng), r = parseInt(radius, 10);
    if (Number.isNaN(la) || Number.isNaN(ln) || Number.isNaN(r) || r <= 0) {
      setError("請輸入有效的緯度、經度與範圍");
      return;
    }
    onSave({ lat: la, lng: ln, radius: r, address: address.trim() });
    setEditing(false);
  };

  return (
    <div style={{
      background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10,
      padding: 12, marginBottom: 14,
    }}>
      <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8 }}>打卡地點限制</div>

      {!editing ? (
        <div>
          {companyLocation ? (
            <div style={{ fontSize: 13, color: COLORS.text, marginBottom: 8 }}>
              已啟用：{companyLocation.address && <>{companyLocation.address}　</>}
              範圍 <b>{companyLocation.radius}</b> 公尺
              <div style={{ fontSize: 11, color: COLORS.textFaint, marginTop: 2 }}>
                座標 {companyLocation.lat.toFixed(5)}, {companyLocation.lng.toFixed(5)}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: COLORS.textFaint, marginBottom: 8 }}>
              目前未啟用，員工可在任何地點打卡
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setEditing(true)}
              style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: `1px solid ${COLORS.brassDim}`, background: "none", color: COLORS.brass, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              {companyLocation ? "修改設定" : "設定範圍"}
            </button>
            {companyLocation && (
              <button
                onClick={onClear}
                disabled={busy}
                style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: "none", color: COLORS.textMuted, fontSize: 13, cursor: "pointer" }}
              >
                停用限制
              </button>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 11, color: COLORS.textFaint, marginBottom: 8 }}>
            建議管理員站在公司現場，按「使用目前位置」自動抓取座標
          </div>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="公司地址（僅供標記顯示，例如：台北市中山區OO路100號）"
            style={{ ...inputStyle, width: "100%", marginBottom: 10 }}
          />
          <button
            onClick={useCurrentPosition}
            disabled={locating}
            style={{ width: "100%", padding: "9px 0", borderRadius: 8, border: "none", background: COLORS.brass, color: "#1B1A17", fontWeight: 600, fontSize: 13, cursor: "pointer", marginBottom: 10 }}
          >
            {locating ? "定位中…" : "📍 使用目前位置"}
          </button>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="緯度" style={{ ...inputStyle, flex: 1 }} />
            <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="經度" style={{ ...inputStyle, flex: 1 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <input value={radius} onChange={(e) => setRadius(e.target.value)} placeholder="公尺" style={{ ...inputStyle, width: 90 }} />
            <span style={{ fontSize: 12, color: COLORS.textFaint }}>公尺範圍（GPS 有誤差，室內建議至少 150 公尺）</span>
          </div>
          {error && <div style={{ fontSize: 12, color: COLORS.red, marginBottom: 8 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={save}
              disabled={busy}
              style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "none", background: COLORS.brass, color: "#1B1A17", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            >
              儲存
            </button>
            <button
              onClick={() => setEditing(false)}
              style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: "none", color: COLORS.textMuted, fontSize: 13, cursor: "pointer" }}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function OvertimeRatePanel({ multiplier, onSave, busy }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(multiplier));
  const [error, setError] = useState("");

  const inputStyle = {
    padding: "8px 10px", borderRadius: 8, background: COLORS.panelRaised,
    border: `1px solid ${COLORS.border}`, color: COLORS.text, fontSize: 13, outline: "none",
  };

  const save = () => {
    const v = parseFloat(value);
    if (Number.isNaN(v) || v <= 0) {
      setError("請輸入大於 0 的數字");
      return;
    }
    onSave(v);
    setEditing(false);
    setError("");
  };

  return (
    <div style={{
      background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10,
      padding: 12, marginBottom: 14,
    }}>
      <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8 }}>平日超時（超過 8 小時）倍率</div>

      {!editing ? (
        <div>
          <div style={{ fontSize: 13, color: COLORS.text, marginBottom: 8 }}>
            目前設定：超過 8 小時的部分以 <b>×{multiplier}</b> 計算工時
          </div>
          <button
            onClick={() => { setValue(String(multiplier)); setEditing(true); setError(""); }}
            style={{ width: "100%", padding: "9px 0", borderRadius: 8, border: `1px solid ${COLORS.brassDim}`, background: "none", color: COLORS.brass, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            修改倍率
          </button>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="例如 2"
              style={{ ...inputStyle, width: 100 }}
            />
            <span style={{ fontSize: 12, color: COLORS.textFaint }}>倍（例如 1.34、1.67、2）</span>
          </div>
          {error && <div style={{ fontSize: 12, color: COLORS.red, marginBottom: 8 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={save}
              disabled={busy}
              style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "none", background: COLORS.brass, color: "#1B1A17", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            >
              儲存
            </button>
            <button
              onClick={() => { setEditing(false); setError(""); }}
              style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: "none", color: COLORS.textMuted, fontSize: 13, cursor: "pointer" }}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BackupPanel({ onExport, onImport, busy }) {
  const fileInputRef = useRef(null);
  const [confirming, setConfirming] = useState(false);

  const handleFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!confirming) return;
    setConfirming(false);
    onImport(file);
  };

  return (
    <div style={{
      background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10,
      padding: 12, marginBottom: 14,
    }}>
      <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8 }}>資料備份</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onExport}
          disabled={busy}
          style={{
            flex: 1, padding: "9px 0", borderRadius: 8, border: `1px solid ${COLORS.brassDim}`,
            background: "none", color: COLORS.brass, fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          匯出備份
        </button>
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            disabled={busy}
            style={{
              flex: 1, padding: "9px 0", borderRadius: 8, border: `1px solid ${COLORS.border}`,
              background: "none", color: COLORS.textMuted, fontSize: 13, cursor: "pointer",
            }}
          >
            從備份還原
          </button>
        ) : (
          <button
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            disabled={busy}
            style={{
              flex: 1, padding: "9px 0", borderRadius: 8, border: `1px solid ${COLORS.red}`,
              background: COLORS.redSoft, color: COLORS.red, fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            選擇檔案（將覆蓋目前所有資料）
          </button>
        )}
        <input ref={fileInputRef} type="file" accept="application/json" onChange={handleFileChange} style={{ display: "none" }} />
      </div>
      {confirming && (
        <button
          onClick={() => setConfirming(false)}
          style={{ marginTop: 6, background: "none", border: "none", color: COLORS.textFaint, fontSize: 11, cursor: "pointer", padding: 0 }}
        >
          取消還原
        </button>
      )}
    </div>
  );
}

// 管理員審核區：列出待審核的新申請帳號，可逐一「通過」或「拒絕」
function PendingApprovalPanel({ pending, onReview, busy }) {
  if (!pending || pending.length === 0) return null;
  return (
    <div style={{
      background: COLORS.panel, border: `1px solid ${COLORS.brassDim}`, borderRadius: 10,
      padding: 12, marginBottom: 14,
    }}>
      <div style={{ fontSize: 12, color: COLORS.brass, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
        <span>待審核申請</span>
        <span style={{
          background: COLORS.brassSoft, color: COLORS.brass, borderRadius: 10,
          padding: "1px 8px", fontSize: 11, fontWeight: 700,
        }}>{pending.length}</span>
      </div>
      <div style={{ fontSize: 11, color: COLORS.textFaint, marginBottom: 10 }}>
        通過後才會加入打卡名冊並可開始打卡；拒絕則會移除該申請。
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {pending.map((e) => (
          <div key={e.id} style={{
            display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
            background: COLORS.panelRaised, border: `1px solid ${COLORS.border}`,
            borderRadius: 8, padding: "8px 10px",
          }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <div style={{ fontSize: 14, color: COLORS.text, fontWeight: 600 }}>{e.name}</div>
              <div style={{ fontSize: 11, color: COLORS.textFaint }}>手機：{e.phone}</div>
            </div>
            <button
              onClick={() => onReview(e.id, "approve")}
              disabled={busy}
              style={{
                padding: "7px 14px", borderRadius: 8, border: "none",
                background: COLORS.green, color: "#fff", fontSize: 13, fontWeight: 600,
                cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
              }}
            >
              通過
            </button>
            <button
              onClick={() => onReview(e.id, "reject")}
              disabled={busy}
              style={{
                padding: "7px 12px", borderRadius: 8, border: `1px solid ${COLORS.border}`,
                background: "none", color: COLORS.textMuted, fontSize: 13,
                cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
              }}
            >
              拒絕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// 管理員專用：查看員工帳號（姓名）與密碼（手機號碼），供員工忘記密碼時查詢。
// 密碼屬敏感資訊，預設以圓點遮蔽，點眼睛才顯示。
function AccountListPanel({ employees }) {
  const [show, setShow] = useState(false);
  if (!employees.length) return null;
  return (
    <div style={{
      background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10,
      padding: 12, marginBottom: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: COLORS.textMuted }}>員工帳號密碼</div>
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "隱藏密碼" : "顯示密碼"}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            background: "none", border: "none", cursor: "pointer",
            color: show ? COLORS.brass : COLORS.textMuted, fontSize: 12, padding: 4,
          }}
        >
          <EyeIcon off={show} />
          {show ? "隱藏" : "顯示"}
        </button>
      </div>
      <div style={{ fontSize: 11, color: COLORS.textFaint, marginBottom: 8 }}>
        密碼即為登入用的手機號碼；員工忘記時可在此查詢。
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {employees.map((e) => (
          <div key={e.id} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: COLORS.panelRaised, border: `1px solid ${COLORS.border}`,
            borderRadius: 8, padding: "8px 10px",
          }}>
            <span style={{ fontSize: 14, color: COLORS.text, fontWeight: 600, marginRight: 10, wordBreak: "break-all" }}>{e.name}</span>
            <span style={{
              fontFamily: "'Space Mono', monospace", fontSize: 14,
              color: show ? COLORS.brass : COLORS.textFaint,
              letterSpacing: show ? 0.5 : 2, whiteSpace: "nowrap",
            }}>
              {show ? (e.phone || "—") : "••••••••"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddEmployeeForm({ showAddEmp, setShowAddEmp, newName, setNewName, newPhone, setNewPhone, submitAddEmployee, busy }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {!showAddEmp ? (
        <button
          onClick={() => setShowAddEmp(true)}
          style={{ background: "none", border: "none", color: COLORS.brass, fontSize: 13, cursor: "pointer", padding: "4px 0" }}
        >
          ＋ 新增員工
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="姓名（帳號）"
              style={{ flex: 1, padding: "9px 10px", borderRadius: 8, background: COLORS.panelRaised, border: `1px solid ${COLORS.border}`, color: COLORS.text, fontSize: 13, outline: "none" }}
            />
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="手機號碼（密碼）"
              style={{ flex: 1, padding: "9px 10px", borderRadius: 8, background: COLORS.panelRaised, border: `1px solid ${COLORS.border}`, color: COLORS.text, fontSize: 13, outline: "none" }}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={submitAddEmployee}
              disabled={busy}
              style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "none", background: COLORS.brass, color: "#1B1A17", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            >
              新增
            </button>
            <button
              onClick={() => setShowAddEmp(false)}
              style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: `1px solid ${COLORS.border}`, background: "none", color: COLORS.textMuted, fontSize: 13, cursor: "pointer" }}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function thStyle(width) {
  return {
    border: `1px solid ${COLORS.cardLine}`,
    padding: "5px 2px",
    fontWeight: 500,
    background: COLORS.cardBlueSoft,
    width: width || undefined,
  };
}
function tdStyle(isDay) {
  return {
    border: `1px solid ${COLORS.cardLine}`,
    padding: "4px 2px",
    textAlign: "center",
    fontFamily: isDay ? "'IBM Plex Sans', sans-serif" : "'Space Mono', monospace",
    color: isDay ? "#3A4A56" : "#1E2A33",
  };
}
