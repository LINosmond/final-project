import React from "react";
import ReactDOM from "react-dom/client";
import "./storage.js";
import TimeClockApp from "./App.jsx";
import { PRINT_HASH, showPrintLinkIfAny } from "./printLink.js";

if (location.hash.startsWith(PRINT_HASH)) {
  // 從網頁 App 交給 Safari 的報表：只顯示報表，不載入打卡系統
  showPrintLinkIfAny().catch((e) => { document.body.textContent = "報表網址無法讀取：" + e; });
} else {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <TimeClockApp />
    </React.StrictMode>
  );
}
