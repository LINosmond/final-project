import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base 預設為 "/"（本機開發、部署到網站根目錄時適用）。
// 部署到 GitHub Pages 的專案頁（網址是 https://<帳號>.github.io/<repo>/）時，
// CI 會設定環境變數 VITE_BASE=/final-project/ 讓資源路徑正確。
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react()],
  // 建置時間（台北時間），顯示在設定頁，方便確認手機載入的是不是最新版
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })),
  },
});
