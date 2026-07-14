// ─────────────────────────────────────────────────────────────────────────
//  爬蟲核心：用真實的 Chromium 瀏覽器登入 gnjoy、查詢物價、解析結果。
//
//  重要：因為目前還沒對過「登入後的實際頁面」，這裡的欄位判斷是用「模糊比對」
//  和「攔截網站的 API 回應」兩種策略盡量自動抓。之後拿到你實際頁面的內容
//  （用 npm run capture 產生的檔案），主要就是回來調整這個檔案。
//  可調整的地方都標了【調整處】。
// ─────────────────────────────────────────────────────────────────────────
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { config, selectors, DATA_DIR } from './config.js';

const SESSION_PATH = path.join(DATA_DIR, 'session.json');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// 建立瀏覽器情境，若之前登入過就沿用登入狀態（減少重複登入、降低被擋機率）。
async function launchContext({ headless } = {}) {
  const browser = await chromium.launch({
    headless: headless ?? config.headless,
    executablePath: config.executablePath, // 通常為 undefined，讓 Playwright 自己找
  });
  const contextOptions = {
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 900 },
    locale: 'zh-TW',
  };
  if (fs.existsSync(SESSION_PATH)) {
    contextOptions.storageState = SESSION_PATH;
  }
  const context = await browser.newContext(contextOptions);
  return { browser, context };
}

async function saveSession(context) {
  try {
    await context.storageState({ path: SESSION_PATH });
  } catch {
    /* 忽略：儲存登入狀態失敗不影響本次查詢 */
  }
}

// 收集頁面在查詢時發出的 JSON API 回應 —— 這通常是價格資料最可靠的來源。
function attachResponseCollector(context, bucket) {
  context.on('response', async (resp) => {
    try {
      const ct = (resp.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('json')) return;
      const url = resp.url();
      const body = await resp.json().catch(() => null);
      if (body != null) bucket.push({ url, body });
    } catch {
      /* 略過無法解析的回應 */
    }
  });
}

// 粗略判斷是否已登入。
async function looksLoggedIn(page) {
  // 【調整處】若有更明確的「已登入」判斷（例如某個只有登入才會出現的元素），改這裡。
  const html = (await page.content()).toLowerCase();
  const hasLogoutHint = selectors.loggedInHints.some((h) => html.includes(h.toLowerCase()));
  const hasPasswordField = (await page.locator('input[type=password]').count()) > 0;
  // 出現登出/會員字樣，且畫面上沒有密碼輸入框 → 視為已登入
  return hasLogoutHint && !hasPasswordField;
}

// 在目前頁面上用模糊比對找出帳號欄位。
async function findAccountInput(page) {
  for (const hint of selectors.accountHints) {
    const loc = page.locator(
      `input[name*="${hint}" i], input[id*="${hint}" i], input[placeholder*="${hint}" i]`
    );
    if ((await loc.count()) && (await loc.first().isVisible().catch(() => false))) {
      return loc.first();
    }
  }
  // 備援：第一個可見的文字/email 輸入框
  const generic = page.locator('input[type=text], input[type=email], input:not([type])');
  const n = await generic.count();
  for (let i = 0; i < n; i++) {
    const el = generic.nth(i);
    if (await el.isVisible().catch(() => false)) return el;
  }
  return null;
}

async function findSearchInput(page) {
  for (const hint of selectors.searchHints) {
    const loc = page.locator(
      `input[name*="${hint}" i], input[id*="${hint}" i], input[placeholder*="${hint}" i], input[type=search]`
    );
    if ((await loc.count()) && (await loc.first().isVisible().catch(() => false))) {
      return loc.first();
    }
  }
  // 備援：頁面上第一個可見、且不是密碼的文字輸入框
  const generic = page.locator('input[type=text], input[type=search], input:not([type])');
  const n = await generic.count();
  for (let i = 0; i < n; i++) {
    const el = generic.nth(i);
    if (await el.isVisible().catch(() => false)) return el;
  }
  return null;
}

// 執行登入（模糊比對）。
async function heuristicLogin(page) {
  const pwField = page.locator('input[type=password]').first();
  if (!(await pwField.count())) {
    // 頁面上沒有密碼欄位；可能已登入，或登入在別的網址。
    return false;
  }
  const account = await findAccountInput(page);
  if (!account) throw new Error('找不到帳號輸入欄位（登入頁面結構可能不同，需要對頁面後調整）。');

  await account.fill(config.account);
  await pwField.fill(config.password);

  // 送出：優先點送出按鈕，否則在密碼欄位按 Enter。
  const submit = page.locator(
    'button[type=submit], input[type=submit], button:has-text("登入"), button:has-text("登录"), a:has-text("登入")'
  );
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => {}),
    (async () => {
      if ((await submit.count()) && (await submit.first().isVisible().catch(() => false))) {
        await submit.first().click();
      } else {
        await pwField.press('Enter');
      }
    })(),
  ]);
  await page.waitForTimeout(1500);
  return true;
}

// 確保已登入：先開查詢頁，需要時再登入。
async function ensureLoggedIn(page) {
  const startUrl = config.loginUrl || config.searchUrl;
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1000);

  if (await looksLoggedIn(page)) return;

  await heuristicLogin(page);

  // 登入後再回到查詢頁確認
  await page.goto(config.searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1000);

  if ((await page.locator('input[type=password]').count()) > 0 && !(await looksLoggedIn(page))) {
    throw new Error('登入後仍看到密碼欄位，登入可能失敗（帳密錯誤，或頁面結構需要調整）。');
  }
}

// 在查詢頁搜尋單一商品，回傳結構化結果。
async function searchOnPage(page, itemName, responseBucket) {
  await page.goto(config.searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);

  const box = await findSearchInput(page);
  if (!box) throw new Error('找不到搜尋輸入框（查詢頁結構需要對頁面後調整）。');

  await box.fill(itemName);

  const before = responseBucket.length;
  // 送出搜尋：按 Enter，或點旁邊的查詢/搜尋按鈕
  const searchBtn = page.locator(
    'button:has-text("查詢"), button:has-text("搜尋"), button:has-text("搜索"), input[type=submit], button[type=submit]'
  );
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => {}),
    (async () => {
      if ((await searchBtn.count()) && (await searchBtn.first().isVisible().catch(() => false))) {
        await searchBtn.first().click();
      } else {
        await box.press('Enter');
      }
    })(),
  ]);
  await page.waitForTimeout(1800);

  const newResponses = responseBucket.slice(before);
  const listings = parseListingsFromJson(newResponses);
  const rawRows = await parseTables(page);

  return {
    ok: true,
    error: null,
    listings,
    rawRows,
    sources: newResponses.map((r) => ({ url: r.url })),
  };
}

// 從攔截到的 JSON 回應裡，找出看起來像「商品列表」的陣列並正規化。
// 【調整處】對過實際 API 後，可以直接依真正的欄位名精準取值，取代這個猜測。
function parseListingsFromJson(responses) {
  const priceKeys = ['price', 'cost', 'zeny', 'amount', 'gold', '單價', '價格', '價', 'unitprice'];
  const results = [];

  const looksLikeListing = (obj) =>
    obj &&
    typeof obj === 'object' &&
    !Array.isArray(obj) &&
    Object.keys(obj).some((k) => priceKeys.some((pk) => k.toLowerCase().includes(pk.toLowerCase())));

  const pick = (obj, hints) => {
    for (const key of Object.keys(obj)) {
      if (hints.some((h) => key.toLowerCase().includes(h.toLowerCase()))) return obj[key];
    }
    return undefined;
  };

  // 遞迴走訪整個 JSON，收集「元素含價格欄位的陣列」
  const walk = (node) => {
    if (Array.isArray(node)) {
      if (node.length && node.every(looksLikeListing)) {
        for (const row of node) {
          results.push({
            name: pick(row, ['name', 'item', 'goods', '商品', '物品', '道具', '名稱']),
            price: pick(row, priceKeys),
            quantity: pick(row, ['qty', 'quantity', 'count', 'num', 'amount', '數量']),
            seller: pick(row, ['seller', 'owner', 'char', 'nick', 'shop', '賣家', '店', '角色']),
            location: pick(row, ['map', 'location', 'pos', 'place', '地圖', '位置']),
            raw: row,
          });
        }
      }
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(walk);
    }
  };

  for (const r of responses) walk(r.body);
  return results;
}

// 備援：把頁面上的表格內容抓成純文字列（當 API 攔截不到時至少有東西看）。
async function parseTables(page) {
  return page.evaluate(() => {
    const out = [];
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (const tr of rows) {
        const cells = [...tr.querySelectorAll('th,td')].map((c) => c.innerText.trim());
        if (cells.some((c) => c.length)) out.push(cells);
      }
    }
    return out.slice(0, 200); // 避免抓太多
  });
}

// ── 對外主要 API ──────────────────────────────────────────────────────────

// 一次查詢多個商品（共用同一個瀏覽器與登入狀態，較有效率）。
export async function fetchMany(names, { headless, onProgress } = {}) {
  const { browser, context } = await launchContext({ headless });
  const responseBucket = [];
  attachResponseCollector(context, responseBucket);
  const page = await context.newPage();
  const out = {};
  try {
    await ensureLoggedIn(page);
    await saveSession(context);
    for (const name of names) {
      try {
        out[name] = await searchOnPage(page, name, responseBucket);
      } catch (err) {
        out[name] = { ok: false, error: String(err.message || err), listings: [], rawRows: [], sources: [] };
      }
      onProgress?.(name, out[name]);
    }
  } finally {
    await browser.close();
  }
  return out;
}

export async function fetchItemPrice(name, opts = {}) {
  const res = await fetchMany([name], opts);
  return res[name];
}

// 供 capture.js 使用：登入 + 查一個商品，並回傳頁面與攔截到的原始回應。
export async function captureRun(itemName, { headless } = {}) {
  const { browser, context } = await launchContext({ headless });
  const responseBucket = [];
  attachResponseCollector(context, responseBucket);
  const page = await context.newPage();
  try {
    await ensureLoggedIn(page);
    await saveSession(context);
    const result = await searchOnPage(page, itemName, responseBucket).catch((e) => ({
      ok: false,
      error: String(e.message || e),
      listings: [],
      rawRows: [],
      sources: [],
    }));
    const html = await page.content();
    const png = await page.screenshot({ fullPage: true }).catch(() => null);
    return { html, png, result, responses: responseBucket, url: page.url() };
  } finally {
    await browser.close();
  }
}
