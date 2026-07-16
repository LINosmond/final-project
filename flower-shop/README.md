# LOVEFOR 花坊 — 現代化花店網站

以 lovefor.com.tw 的「花店・高質感・粉色」為方向，重新設計的多頁響應式官網。純靜態 HTML/CSS/JS，無框架、無外部相依，可直接部署到任何靜態主機（GitHub Pages / Netlify / Cloudflare Pages / 一般虛擬主機）。

> ⚠️ 目前的工作環境無法連到 lovefor.com.tw（網路白名單封鎖），因此文字、電話、地址、方案價格皆為**示範用預留內容**。請依下方清單替換為真實資料後再上線。

## 頁面結構

| 檔案 | 內容 |
|------|------|
| `index.html` | 首頁：主視覺、特色、精選花禮、場合、顧客見證、CTA |
| `about.html` | 關於我們：品牌故事、堅持、服務流程 |
| `products.html` | 花禮系列：日常 / 求婚 / 祝賀 / 婚禮花藝 |
| `gallery.html` | 作品集（瀑布流版位） |
| `contact.html` | 聯絡・預約：資訊、諮詢表單、FAQ |
| `assets/style.css` | 全站樣式與設計系統（色彩、字體變數集中在最上方 `:root`） |
| `assets/main.js` | 行動選單、捲動效果、進場動畫、表單示範 |

## 設計重點（相較舊站的現代化）

- **響應式**：手機 / 平板 / 桌機自適應，含漢堡選單。
- **高質感粉色調**：柔霧玫瑰主色，大量留白，優雅襯線標題（Cormorant Garamond + Noto Serif TC）。
- **效能**：無框架、無外部圖庫，字型漸進載入，載入快。
- **SEO**：每頁獨立 `title`／`description`／OpenGraph、語意化 HTML。
- **無障礙**：`aria` 標籤、鍵盤可用、對比充足、支援「減少動態」偏好。

## 上線前替換清單

1. **品牌名稱**：全站 `LOVEFOR 花坊` → 你的店名（含 `<title>` 與 footer）。
2. **聯絡資訊**：搜尋 `02-0000-0000`、`@lovefor`、`台北市〇〇區〇〇路 000 號`、`10:00–20:00` 全部替換。
3. **社群連結**：footer 的 `href="#"`（Facebook / Instagram / LINE）改成實際網址。
4. **商品與價格**：`products.html` / `index.html` 的品名、說明、`NT$` 價格。
5. **圖片**：所有 `.frame` 灰粉色區塊都是照片版位——把 `<div class="frame ...">…</div>`
   換成 `<img src="images/xxx.jpg" alt="說明" class="frame ...">`，建議尺寸見版位內文字。
6. **地圖**：`contact.html` 的地圖版位貼入 Google Maps 內嵌 `iframe`。
7. **表單串接**：`contact.html` 的表單目前是前端示範。可接 Formspree / Google Form /
   自架後端 / LINE 官方帳號，移除 `data-demo` 並設定 `action`。

## 本機預覽

直接用瀏覽器打開 `index.html` 即可；或啟動簡易伺服器：

```bash
cd flower-shop
python3 -m http.server 8000
# 開啟 http://localhost:8000
```

## 調整配色

改 `assets/style.css` 最上方 `:root` 的變數即可全站套用，例如主色：

```css
--rose: #c1547a;   /* 主色 */
--blush: #fbedf0;  /* 柔粉背景 */
```
