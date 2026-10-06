# TimeClock v2 — 員工打卡與薪資系統（自架版）

舊版（`../TimeClockWeb/`）把 Google 試算表當資料庫、Apps Script 當 API。這一版是重新製作的獨立系統：

- **後端**：Node.js 22 內建 `node:sqlite`，**零外部套件**。單一程序同時提供 API 與前端靜態檔。
- **前端**：React + Vite，手機優先，可加到主畫面當 App 用。
- **多公司**：每家公司有自己的代碼、員工、規則與資料；同一台主機可服務多家店。
- **真正的登入**：密碼以 scrypt 雜湊、HttpOnly cookie session，權限全部在伺服器檢查。
- **逐筆打卡、不整包覆寫**：管理員補登只動該員工該日的幾筆，舊紀錄軟刪除保留可追查。
- **考勤規則可設定**：打卡時間單位、每日正常工時、加班分段倍率（1.34 / 1.67 / 2）或單一倍率、假日倍率、跨午夜班自動歸到上班日。
- **薪資**：工時一律由考勤自動算，金額設定分「固定」與「本月」，可發佈給員工看，可列印薪資條。
- **可匯入舊版備份**，重複匯入不會重複寫入。

> 舊版目錄 `TimeClockWeb/` 完全未更動，兩者可並行。

## 目錄

```
timeclock-v2/
├─ server/            後端（http、路由、服務、資料庫）
├─ shared/            前後端共用的純邏輯：時區、假日、考勤配對、薪資計算
├─ web/               React 前端（build 後產生 web/dist）
├─ scripts/           命令列工具：新增公司、匯入舊版備份
├─ tests/             node --test（共用邏輯 + 完整 API 流程）
└─ deploy/            systemd、Caddy、每日備份範例
```

## 快速開始（本機）

需要 Node.js **22.13 以上**（`node:sqlite` 內建）。

```bash
cd timeclock-v2
npm install          # 只為了 Vite / React 建置，伺服器本身沒有相依套件
npm test             # 跑全部測試
npm run build        # 產出 web/dist
npm start            # http://localhost:3000
```

第一次開啟網頁會出現「初始設定」：填公司名稱、公司代碼、管理員帳號密碼。之後：

- **員工**：用公司代碼 + 手機 + 自訂密碼「申請帳號」，管理員在「員工」分頁審核通過後即可打卡。或由管理員直接新增。
- **管理員**：考勤（總表、每日補登、假日）、員工（審核、封存、重設密碼、排序）、薪資（設定、發佈、列印）、設定（規則、地點限制、假日、備份、匯入、操作紀錄）。

開發時前後端分開跑：`npm run dev`（後端，含自動重啟）與 `npm run dev:web`（Vite，/api 自動代理到 3000）。

## 部署到 Railway（建議，最省事）

Railway 會用本目錄的 `Dockerfile` 建置，所以 Node 版本不會出錯。整個流程大約十分鐘：

1. 到 https://railway.com 用 GitHub 登入，**New Project → Deploy from GitHub repo**，選這個 repo（第一次要授權 Railway 讀取 repo）。
2. 進到建立好的 Service → **Settings**：
   - **Source → Root Directory** 填 `timeclock-v2`（很重要，repo 裡還有其他專案）。
   - **Source → Branch** 選要部署的分支（例如 `master` 或 `claude/timeclock-v2`）。
3. **Variables** 新增：
   - `DATA_DIR` = `/data`
   - `TRUST_PROXY` = `1`
   - `PORT` 不用設，Railway 會自己給。
4. **Settings → Volumes → Add Volume**，Mount Path 填 `/data`。**沒有這步，每次重新部署資料會消失。**
5. **Settings → Networking → Generate Domain**，會得到一個 `xxx.up.railway.app` 的 HTTPS 網址。要用自己的網域就在同一處加 Custom Domain，照指示到 DNS 加一筆 CNAME。
6. 等部署完成（Deployments 分頁變綠），打開網址會看到「初始設定」頁，填公司名稱、公司代碼、管理員帳密即可開始用。

之後每次推送到那個分支，Railway 會自動重新建置部署；資料在 Volume 裡不受影響。

**費用**：Hobby 方案每月 5 美元（內含 5 美元用量）。這套程式閒置時幾乎不耗資源，一般一到數十家店都在這個額度內；Volume 另依 GB 計費，打卡資料一年也用不到 0.1 GB。

**備份**：管理員後台「設定 → 下載完整備份」可隨時匯出 JSON；Railway 的 Volume 設定頁也有備份功能，建議開啟。

**搬舊資料**：部署好之後在後台「設定 → 匯入舊版備份檔」上傳舊版匯出的 JSON，見下方「從舊版搬資料」。

**在 Railway 上新增第二家公司**：Service 頁面右上角可開 **Shell**（或用 Railway CLI 的 `railway run`），執行
`node scripts/create-company.mjs --name "第二家店" --code shop2 --admin-login 0912345678 --admin-password 密碼`。

同一個 `Dockerfile` 也能直接用在 Fly.io、Render、任何支援 Docker 的主機，只要把持久磁碟掛到 `/data`。

## 部署到自己的主機

1. 安裝 Node.js 22（建議 LTS 最新版）。
2. 把整個 `timeclock-v2/` 放到例如 `/opt/timeclock-v2`，執行 `npm install && npm run build`。
3. 建一個系統使用者與資料目錄：`useradd -r timeclock && mkdir -p /var/lib/timeclock && chown timeclock /var/lib/timeclock`。
4. 複製 `deploy/timeclock.service` 到 `/etc/systemd/system/`，`systemctl enable --now timeclock`。
5. 前面放 HTTPS 反向代理（`deploy/Caddyfile` 範例，Caddy 會自動申請憑證）。**打卡定位功能必須走 HTTPS。** 有反向代理時 `TRUST_PROXY=1` 要開。
6. 設排程每天跑 `deploy/backup.sh`。

環境變數見 `.env.example`：`PORT`、`DATA_DIR`、`TRUST_PROXY`。

## 從舊版搬資料

舊版管理員後台「備份」匯出的 JSON（`employees / punches / holidays / otMultiplier`）可直接匯入：

- 網頁：管理員 → 設定 → 「匯入舊版備份檔」
- 命令列：`npm run import-legacy -- --code 公司代碼 --file 備份.json`

匯入後員工帳號＝手機、初始密碼＝手機號碼（與舊版相同），請提醒員工登入後更改。舊版的加班倍率會轉成「單一倍率」模式，可在設定改為分段倍率。舊版的薪資設定不在備份檔內，需在新版重新填一次（每位員工填一次即可沿用）。

## 新增第二家公司

```bash
npm run create-company -- --name "第二家店" --code shop2 --admin-name 老闆 --admin-login 0912345678 --admin-password 密碼
```

## API 一覽

所有 API 都在 `/api/` 下，JSON 進出，登入狀態靠 cookie。寫入請求若帶 `Origin` 必須與站台同源。

| 用途 | 方法與路徑 |
|---|---|
| 初始設定 | `GET /api/setup/status`、`POST /api/setup` |
| 登入／申請／登出 | `POST /api/auth/login`、`POST /api/auth/register`、`POST /api/auth/logout`、`GET /api/me`、`POST /api/me/password` |
| 員工打卡 | `GET /api/me/today`、`POST /api/me/punch`、`GET /api/me/months/:ym`、`GET /api/me/salary`、`GET /api/me/salary/:ym` |
| 員工管理 | `GET/POST /api/admin/employees`、`PATCH /api/admin/employees/:id`、`POST …/:id/review`、`POST …/:id/archive`、`PUT /api/admin/employees/order` |
| 考勤 | `GET /api/admin/attendance/:ym`、`GET /api/admin/attendance/:ym/:employeeId`、`PUT /api/admin/attendance/:employeeId/days/:date`、`GET /api/admin/attendance-export/:ym` |
| 假日 | `GET /api/admin/holidays/:year`、`PUT /api/admin/holidays/:date` |
| 設定 | `GET/PUT /api/admin/settings` |
| 薪資 | `GET /api/admin/salary/:ym`、`PUT /api/admin/salary/:employeeId/profile`、`PUT /api/admin/salary/:employeeId/months/:ym`、`POST /api/admin/salary/:ym/publish` |
| 備份／匯入／稽核 | `GET /api/admin/backup`、`POST /api/admin/import-legacy`、`GET /api/admin/audit` |

## 考勤計算規則（shared/attendance.js）

- 打卡依時間排序，「上班」開啟一個時段、下一個「下班」結束它；時段**歸屬於上班那一天**，所以 22:00 到 02:00 的晚班整段算在前一天。
- 上班後超過「單一班最長」（預設 16 小時）沒下班，視為漏打卡，不自動配對；月表會以紅字標示，請管理員補登。
- 一天可有任意多個時段（中午休息、分段上班都可以）。
- 每日總工時超過「每日正常工時」（預設 480 分）的部分是加班。分段倍率模式下前 120 分 ×1.34、再 120 分 ×1.67、其後 ×2；單一倍率模式下全部乘同一個倍率。
- 國定假日全部工時乘「假日倍率」（預設 2），不另算加班。假日來源：2025、2026 行政院公告日期，其他年份只有固定國曆假日，管理員可逐日覆寫。

這些是計算方式，不是法律意見。休息日、例假日、變形工時等請依貴公司制度自行調整規則或與員工約定。

## 測試

```bash
npm test
```

- `tests/shared.test.mjs`：時區、假日、配對、加班分段、整月、薪資計算。
- `tests/api.test.mjs`：啟動真實伺服器（記憶體資料庫）跑完整流程：初始設定、申請審核、打卡順序與冪等、定位限制、單日補登隔離、假日覆寫、薪資發佈與可見性、密碼與封存、匯入舊版、跨站保護。

## 已知限制與後續

- 尚未做：排班／班表、請假、多管理員角色（目前每家公司可有多位管理員帳號但權限相同）、推播通知。
- 國定假日表需每年更新 `shared/holidays.js`（或由管理員手動新增）。
- 列印薪資條用瀏覽器列印；需要 PDF 可用瀏覽器「另存為 PDF」。
