// 從手機主畫面圖示打開的網站（網頁 App）不能列印。把報表壓縮後放進網址 #tcprint=…，
// 交給 Safari 開啟，在 Safari 裡顯示報表再列印。
export const PRINT_HASH = "#tcprint=";

export function isStandaloneApp() {
  try {
    return navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  } catch (e) {
    return false;
  }
}

function toB64Url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(str) {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(buf);
}

export async function encodeReport(html) {
  return toB64Url(await pipe(new TextEncoder().encode(html), new CompressionStream("deflate-raw")));
}

export async function decodeReport(data) {
  return new TextDecoder().decode(await pipe(fromB64Url(data), new DecompressionStream("deflate-raw")));
}

// 報表最上方加一條列印按鈕（列印時隱藏），在 Safari 裡按這顆印。
// 還在網頁 App 裡（不能列印）時，改成「用 Safari 開啟」的連結。
export function withPrintBar(html, safariHref) {
  const btn = safariHref
    ? '<a href="' + safariHref.replace(/"/g, "&quot;") + '" style="font-size:18px;padding:10px 28px;display:inline-block;border:1px solid #999;border-radius:8px;background:#f5f5f5;color:#111;text-decoration:none;">🧭 用 Safari 開啟再列印</a>'
    : '<button onclick="window.print()" style="font-size:18px;padding:10px 28px;">🖨 列印 / 存成 PDF</button>';
  const bar =
    '<style>@media print{.tc-safari-bar{display:none!important}}</style>' +
    '<div class="tc-safari-bar" style="position:sticky;top:0;z-index:9;background:#fff;padding:10px;text-align:center;border-bottom:1px solid #ddd;">' +
    btn + '</div>';
  return /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (m) => m + bar) : bar + html;
}

// 報表的列印網址（同一個網站加上 #tcprint=…），在 Safari 打開後只顯示報表
export async function reportPrintUrl(html) {
  return location.origin + location.pathname + PRINT_HASH + (await encodeReport(html));
}

// iPhone 的「x-safari-https://…」會跳出網頁 App、改用 Safari 打開（iOS 17 起）
export function safariUrl(url) {
  return "x-safari-" + url;
}

// 網址帶 #tcprint=… 時，整頁換成報表；回傳 true 表示不要再載入打卡系統
export async function showPrintLinkIfAny() {
  if (!location.hash.startsWith(PRINT_HASH)) return false;
  const html = withPrintBar(await decodeReport(location.hash.slice(PRINT_HASH.length)), isStandaloneApp() ? safariUrl(location.href) : "");
  document.open();
  document.write(html);
  document.close();
  return true;
}
