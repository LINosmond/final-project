// 集中管理設定與「網站相關」的可調整參數。
// 之後拿到你實際登入後的頁面，主要就是調整這個檔案 + scraper.js。
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const PUBLIC_DIR = path.join(ROOT, 'public');

export const config = {
  account: process.env.RO_ACCOUNT || '',
  password: process.env.RO_PASSWORD || '',
  searchUrl: process.env.RO_SEARCH_URL || 'https://event.gnjoy.com.tw/Ro/RoShopSearch',
  loginUrl: process.env.RO_LOGIN_URL || '',
  port: Number(process.env.PORT) || 5178,
  headless: String(process.env.HEADLESS ?? 'true').toLowerCase() !== 'false',
  // 登入/查價用哪個瀏覽器：firefox（預設，較能過 gnjoy 驗證）/ chromium / chrome
  browser: (process.env.RO_BROWSER || 'firefox').toLowerCase(),
  // 選填：萬一 Playwright 找不到瀏覽器，可在 .env 指定執行檔路徑
  executablePath: process.env.PW_EXECUTABLE_PATH || undefined,
};

// ─── 網站頁面的欄位線索（heuristic，先用猜的） ──────────────────────────
// scraper.js 會用這些關鍵字去「模糊比對」頁面上的欄位，
// 這樣就算不知道確切 id/name 也有機會抓到。之後可視實際頁面收斂。
export const selectors = {
  // 帳號欄位可能的線索
  accountHints: ['account', 'userid', 'user_id', 'username', 'user', 'id', 'login', 'membid', 'memberid', '帳號'],
  // 密碼欄位一律用 input[type=password]，這裡是備援線索
  passwordHints: ['password', 'passwd', 'pwd', 'pass', '密碼'],
  // 搜尋輸入框可能的線索（依實際頁面：placeholder 是「請輸入道具關鍵字」）
  searchHints: ['關鍵字', '道具', 'search', 'keyword', 'itemname', 'item', 'name', 'goods', '搜尋', '物品', '商品', '名稱'],
  // 「還沒登入」的判斷：頁面上出現這些字（依實際頁面：按鈕寫「請先登入」）
  needsLoginHints: ['請先登入', '請登入', '登入後', 'login required'],
};

export function assertCredentials() {
  if (!config.account || !config.password) {
    throw new Error(
      '找不到帳號或密碼。請把 .env.example 複製成 .env，並填入 RO_ACCOUNT / RO_PASSWORD。'
    );
  }
}
