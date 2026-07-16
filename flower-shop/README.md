# 花樣 LoveFor 花藝設計 — 現代化官網

以原站 lovefor.com.tw（高雄旗山美濃花店「花樣 LoveFor 花藝設計」）為基礎重新設計的多頁響應式官網。純靜態 HTML/CSS/JS，無框架、無外部相依，可直接部署到任何靜態主機（GitHub Pages / Netlify / Cloudflare Pages / 一般虛擬主機）。

> ⚠️ 品牌名稱、電話、傳真、地址、配送與訂購規則皆取自原站截圖；**商品品名、價格、LINE ID、社群連結、圖片仍為示範內容**，請依下方清單替換後再上線。

## 頁面結構

| 檔案 | 內容 |
|------|------|
| `index.html` | 首頁：主視覺、特色、場合、精選花禮、會場佈置、見證、CTA |
| `products.html` | 花禮商品：**分類篩選 + 關鍵字搜尋 + 加入詢價** |
| `promotions.html` | 促銷花禮：節慶檔期優惠與預購方案 |
| `ordering.html` | 訂購須知：配送時段/區域、截單時間、下單方式、取消更改、簽收、**付款方式**、注意事項 |
| `about.html` | 關於我們：品牌故事、堅持、服務流程 |
| `gallery.html` | 作品集（瀑布流版位） |
| `contact.html` | 聯絡・預約：資訊、預約表單、FAQ |
| `assets/style.css` | 全站設計系統（色彩、字體變數集中在最上方 `:root`） |
| `assets/main.js` | 行動選單、篩選搜尋、詢價購物車、浮動鈕、回頂端、表單示範 |

## 新增功能

- **商品分類篩選 + 關鍵字搜尋**（`products.html`）
- **詢價購物車**：商品「加入詢價」→ 右側抽屜清單（localStorage 保存）→「前往預約諮詢」自動把清單帶入聯絡表單
- **促銷花禮頁**：節慶預購方案版位
- **浮動快速鈕**：LINE / 一鍵撥號 / 回頂端
- **頂部公告條** 與 **訂購須知頁**（含真實配送與截單規則）

## 相較舊站的現代化

- **響應式**：手機 / 平板 / 桌機自適應，含漢堡選單
- **精品莓紫紅風格**：莓紫紅主色 × 暖奶油 × 金色點綴，大量留白、優雅襯線標題
- **效能**：無框架、無外部圖庫，字型漸進載入
- **SEO**：每頁獨立 `title`/`description`/OpenGraph、語意化 HTML
- **無障礙**：`aria` 標籤、鍵盤可用、對比充足、支援「減少動態」偏好

## 上線前替換清單

1. **LINE ID**：搜尋 footer 與浮動鈕的 LINE `href="#"`，改為實際加好友網址。
2. **社群連結**：footer 的 Facebook / Instagram `href="#"`。
3. **商品與價格**：`products.html`、`promotions.html`、`index.html` 的品名、說明、`NT$` 價格與 `data-price`。
4. **圖片**：所有 `.frame` 灰粉色區塊為照片版位——換成
   `<img src="images/xxx.jpg" alt="說明" class="frame ...">`（建議尺寸見版位內文字）。
5. **地圖**：`contact.html` 的地圖版位貼入旗山門市 Google Maps `iframe`。
6. **表單串接**：`contact.html` 表單目前為前端示範（`data-demo`）。可接 Formspree /
   Google 表單 / 自架後端 / LINE，移除 `data-demo` 並設定 `action`。

> 已內建的真實資訊：店名「花樣 LoveFor 花藝設計」、地址「高雄市旗山區延平一路15號」、
> TEL `07-662-5868`、FAX `07-662-5867`、配送時段與訂購截單規則。若有變動請一併更新。

## 本機預覽

```bash
cd flower-shop
python3 -m http.server 8000   # 開啟 http://localhost:8000
```

## 調整配色

改 `assets/style.css` 最上方 `:root` 變數即可全站套用：

```css
--berry: #d1356f;   /* 主色（莓紫紅） */
--gold:  #c79a4b;   /* 金色點綴 */
--peach: #fdeef2;   /* 柔粉背景 */
```
