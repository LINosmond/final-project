// ─────────────────────────────────────────────────────────────────────────
//  爬蟲核心：用真實的 Chromium 瀏覽器登入 gnjoy、查詢物價、解析結果。
//
//  重要：因為目前還沒對過「登入後的實際頁面」，這裡的欄位判斷是用「模糊比對」
//  和「攔截網站的 API 回應」兩種策略盡量自動抓。之後拿到你實際頁面的內容
//  （用 npm run capture 產生的檔案），主要就是回來調整這個檔案。
//  可調整的地方都標了【調整處】。
// ─────────────────────────────────────────────────────────────────────────
import { chromium, firefox } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { config, selectors, DATA_DIR } from './config.js';

const SESSION_PATH = path.join(DATA_DIR, 'session.json');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// 依 .env 的 RO_BROWSER 選瀏覽器。gnjoy 登入的環境驗證在 Chrome 家族容易失敗，
// 預設用 Firefox（實測較能通過），並隱藏自動化特徵讓它更像正常瀏覽器。
function pickBrowser() {
  const b = (config.browser || 'firefox').toLowerCase();
  if (b === 'chrome') return { type: chromium, name: 'chrome', channel: 'chrome' };
  if (b === 'chromium') return { type: chromium, name: 'chromium' };
  return { type: firefox, name: 'firefox' };
}

async function launchBrowser({ headless } = {}) {
  const { type, name, channel } = pickBrowser();
  const opts = { headless: headless ?? config.headless, executablePath: config.executablePath };
  if (channel) opts.channel = channel;
  if (name === 'firefox') {
    // 隱藏 navigator.webdriver 等自動化痕跡
    opts.firefoxUserPrefs = { 'dom.webdriver.enabled': false, useAutomationExtension: false };
  } else {
    opts.args = ['--disable-blink-features=AutomationControlled'];
  }
  return { browser: await type.launch(opts), name };
}

// 用指定瀏覽器建立情境，若之前登入過就沿用登入狀態。
async function newSessionContext(browser, name, viewport) {
  const opts = { viewport, locale: 'zh-TW' };
  if (name !== 'firefox') opts.userAgent = USER_AGENT; // Firefox 用它自己的 UA 較自然
  if (fs.existsSync(SESSION_PATH)) opts.storageState = SESSION_PATH;
  return browser.newContext(opts);
}

async function launchContext({ headless } = {}) {
  const { browser, name } = await launchBrowser({ headless });
  const context = await newSessionContext(browser, name, { width: 1366, height: 900 });
  return { browser, context };
}

// 有沒有存過登入狀態（給 App 顯示「已登入 / 未登入」）。
export function hasSavedSession() {
  return fs.existsSync(SESSION_PATH);
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

// 這個網站的登入在別的頁面，無法用自動填帳密解決，所以改成「手動登入一次、
// 之後沿用登入狀態」。這裡只負責判斷「現在到底有沒有登入」。
class NeedsLoginError extends Error {
  constructor(msg) {
    super(msg || '需要登入');
    this.needsLogin = true;
  }
}

// 判斷「是否還沒登入」：頁面出現「請先登入」等字，或還有密碼欄位。
async function needsLogin(page) {
  const html = await page.content();
  const lower = html.toLowerCase();
  const hit = selectors.needsLoginHints.some((h) =>
    /[a-z]/i.test(h) ? lower.includes(h.toLowerCase()) : html.includes(h)
  );
  const hasPasswordField = (await page.locator('input[type=password]').count()) > 0;
  return hit || hasPasswordField;
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

// 確保已登入：開查詢頁，若還沒登入就丟出 NeedsLoginError（請使用者手動登入一次）。
async function ensureLoggedIn(page) {
  await page.goto(config.searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1200);
  if (await needsLogin(page)) {
    throw new NeedsLoginError(
      '需要登入 gnjoy：請在 App 點「登入 gnjoy」，在跳出的視窗登入一次即可。'
    );
  }
}

// 在查詢頁搜尋單一商品，回傳結構化結果。
async function searchOnPage(page, itemName, responseBucket) {
  await page.goto(config.searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);

  if (await needsLogin(page)) {
    throw new NeedsLoginError('需要登入 gnjoy：請在 App 點「登入 gnjoy」重新登入一次。');
  }

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
    try {
      await ensureLoggedIn(page);
    } catch (err) {
      if (err.needsLogin) {
        // 還沒登入：把每個商品標成「需要登入」，讓 App 顯示登入提示。
        for (const name of names) {
          out[name] = emptyResult(String(err.message || err), true);
          onProgress?.(name, out[name]);
        }
        return out;
      }
      throw err;
    }
    await saveSession(context);
    for (const name of names) {
      try {
        out[name] = await searchOnPage(page, name, responseBucket);
      } catch (err) {
        out[name] = emptyResult(String(err.message || err), !!err.needsLogin);
      }
      onProgress?.(name, out[name]);
    }
  } finally {
    await browser.close();
  }
  return out;
}

function emptyResult(error, needsLogin = false) {
  return { ok: false, error, needsLogin, listings: [], rawRows: [], sources: [] };
}

// 檢查目前有沒有有效的登入狀態（給 App 顯示「已登入 / 未登入」）。
export async function checkLoggedIn() {
  const { browser, context } = await launchContext({ headless: true });
  const page = await context.newPage();
  try {
    await page.goto(config.searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    return !(await needsLogin(page));
  } catch {
    return false;
  } finally {
    await browser.close();
  }
}

// 開一個「看得到的」瀏覽器視窗讓使用者手動登入一次。回傳控制把手。
// 使用者登入好之後呼叫 finishLogin() 把登入狀態存起來，之後就能自動沿用。
export async function openLoginBrowser() {
  const { browser, name } = await launchBrowser({ headless: false });
  const context = await newSessionContext(browser, name, { width: 1280, height: 900 });
  const page = await context.newPage();
  await page.goto(config.searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  return {
    browser,
    context,
    page,
    // 存檔並關閉視窗。回傳是否偵測到已登入。
    async finish() {
      let loggedIn = false;
      try {
        await page.goto(config.searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(1200);
        loggedIn = !(await needsLogin(page));
      } catch {
        /* 忽略 */
      }
      await saveSession(context);
      await browser.close();
      return loggedIn;
    },
    async cancel() {
      await browser.close().catch(() => {});
    },
  };
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
