# 員工打卡系統（獨立網站版）

從原本的 `TimeClock.jsx` 單檔元件重建成可獨立部署的靜態網站，資料庫由 Google 試算表擔任（透過 Google Apps Script 當中介 API）。畫面與功能邏輯（登入、打卡、國定假日加乘、地點限制、管理紀錄、備份還原）完全比照原始規格，只有資料儲存層被替換。

## 架構

```
瀏覽器（React 靜態網站）
   │  fetch POST（action: get / set / delete）
   ▼
Google Apps Script Web App（google-apps-script/Code.gs）
   │  讀寫
   ▼
Google 試算表（一個叫 KV 的工作表，key / value / updatedAt 三欄）
```

- `employees`、`punches`、`holidays`、`companyLocation` 四把 key 存在 Google 試算表，多裝置共用。
- `session`（這台裝置記得的登入狀態）存在瀏覽器 `localStorage`，不會、也不需要同步到試算表。

## 第一步：建立 Google 試算表 + 部署 Apps Script

1. 到 [Google Sheets](https://sheets.new) 建立一份新的空白試算表（之後 KV 工作表會自動建立，不用手動加欄位）。
2. 上方選單「擴充功能 → Apps Script」，開啟腳本編輯器。
3. 把編輯器裡預設的 `Code.gs` 內容整個換成本專案的 [google-apps-script/Code.gs](google-apps-script/Code.gs)。
4. （建議）左側「專案設定 → Script Properties → 新增指令碼屬性」，新增一筆 `API_KEY`，值自訂一組亂數字串。這是輕量防護，擋掉隨機掃描到你網址的機器人，**不是**正式的身份驗證機制。
5. 右上角「部署 → 新增部署作業」：
   - 類型選「網頁應用程式」
   - 執行身分：我（你的帳號）
   - 具有存取權的使用者：任何人
   - 部署後複製產生的網址（結尾是 `/exec`），這就是後面要填的 `VITE_SHEETS_API_URL`。
6. 之後若修改 `Code.gs`，記得用「管理部署作業 → 編輯 → 新增版本」重新部署，網址才會套用新程式碼。

## 第二步：設定前端環境變數

```bash
cp .env.example .env
```

編輯 `.env`：

```
VITE_SHEETS_API_URL=你剛剛複製的 /exec 網址
VITE_SHEETS_API_KEY=你在 Script Properties 設的 API_KEY（沒設就留空）
```

## 第三步：本機開發 / 建置

```bash
npm install
npm run dev       # 本機開發，預設 http://localhost:5173
npm run build      # 產出 dist/，可上傳到任何靜態主機
npm run preview    # 預覽 build 後的結果
```

`npm run build` 產出的 `dist/` 資料夾可以直接部署到 GitHub Pages、Netlify、Vercel、Cloudflare Pages 等任何靜態網站服務。

> 打卡地點限制功能會用到瀏覽器定位 API（`navigator.geolocation`），這在正式環境需要 HTTPS 才能運作；上述主機預設都是 HTTPS，本機開發用 `localhost` 也沒問題。

## 管理員帳號

管理員帳密寫在 `src/App.jsx` 的 `ADMIN_ACCOUNT` 常數中（比照原始規格）。

**請注意一個重要的安全限制**：這個網站是純前端靜態網站，管理員登入檢查只發生在瀏覽器端；打卡 API（Apps Script）只要拿到網址，任何人都可以直接呼叫，不會真的檢查「是不是管理員在操作」。`API_KEY` 只能擋住不知道網址的路人，擋不住願意打開瀏覽器開發者工具查看程式碼的人。如果之後需要真正的存取控管（例如员工看不到彼此薪資、只有管理员能改資料），需要另外加一層有身份驗證的後端，這已超出「把儲存層換成 Google 試算表」的範圍，請再另外討論。

## 匯出考勤 CSV

CSV 匯出**僅限管理員**使用；一般員工登入後的「管理紀錄」頁只能檢視，不會出現匯出按鈕。管理員登入後，考勤卡上方有兩顆匯出按鈕：

- **匯出本月考勤 CSV**：把目前選到的員工、當月每一天的上下班時間與工時（含假日 ×2、平日超時倍率）輸出成一份 CSV，最後附上本月小計。
- **匯出全員月度彙總 CSV**：一次輸出所有員工當月的原始工時、加乘工時與合計，方便薪資結算。

CSV 內容與畫面上的考勤卡採用同一套工時計算，並帶有 UTF-8 BOM，用 Excel 直接打開即可正確顯示中文。每一列都額外附上十進位小時（例如 `8.5`），方便乘上時薪試算。

## 檔案結構

```
TimeClockWeb/
├─ index.html
├─ package.json
├─ vite.config.js
├─ .env.example
├─ src/
│  ├─ main.jsx        # 進入點，載入 storage.js 後掛載 App
│  ├─ storage.js       # 取代 window.storage：共用資料走 Apps Script，session 走 localStorage
│  └─ App.jsx           # 原 TimeClock.jsx 的完整畫面與邏輯
└─ google-apps-script/
   └─ Code.gs           # 部署到 Google Apps Script 的後端程式
```
