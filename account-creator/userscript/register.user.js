// ==UserScript==
// @name         帳號自動建立器（網頁版 / Tampermonkey）
// @namespace    final-project.account-creator
// @version      1.0
// @description  在註冊網頁上自動填「帳號／密碼／信箱」，一次一批（預設 4 組），不佔用滑鼠鍵盤。
// @author       you
// @match        https://www.userjoy.com/MemberAL1G/*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

/* ============================================================
 *  使用步驟
 *  1) 裝瀏覽器擴充「Tampermonkey（篡改猴/竄改猴）」。
 *  2) Tampermonkey → 新增腳本 → 把這整份貼進去。
 *  3) 改上面第 8 行的 @match 成你的「註冊頁網址」，結尾保留 /*
 *     例：// @match  https://example.com/register*
 *  4) 改下面 CONFIG.registerUrl 成同一個註冊頁網址（自動翻頁會用到）。
 *  5) 把 ACCOUNTS 這段換成你的帳號資料（格式同 accounts.txt：帳號 密碼 邮箱 API链接）。
 *  6) 存檔 → 打開註冊頁 → 右下角會出現小面板，按「自動填 4 組」。
 *
 *  抓不到欄位怎麼辦？在欄位上按右鍵→檢查，看它的 id 或 name，
 *  填到下面 CONFIG.selectors 對應那一欄（留空 "" 就用自動猜測）。
 * ============================================================ */

const CONFIG = {
  // 註冊頁網址（送出後自動回到這頁抓下一組的新表單）。要和上面 @match 同一區。
  // ⚠ 下面這個是你給的「登入頁」；若真正的「註冊/加入會員」頁是別的網址，請改成那一頁。
  registerUrl: "https://www.userjoy.com/MemberAL1G/login/index.aspx?lang=zh-TW",

  batchSize: 4, // 一次填幾組

  // 各欄位的 CSS 選擇器；留空 "" 就用「自動猜測」。抓不對時填死，例如 "#username"、"input[name='email']"
  selectors: {
    account: "",
    password: "",
    email: "",
    mailboxPassword: "", // 表單若要填信箱密碼才設；否則留空
    submit: "",          // 送出/註冊按鈕；留空會自動找 type=submit 或含「註冊/送出/提交/注册」字樣的按鈕
  },

  fillMailboxPassword: false, // 表單需要填信箱密碼時設 true
  clickSubmit: true,          // 填完是否自動按送出
  afterSubmit: "goto",        // 送出後動作："goto"=回到 registerUrl 抓新表單 / "reload"=重新整理 / "none"=不動
  waitFormMs: 1500,           // 進頁面後等表單出現的時間
  afterFillMs: 400,           // 每格之間、送出前的等待
  afterSubmitMs: 1500,        // 送出後等頁面反應的時間
};

// ====== 帳號資料（格式同 accounts.txt：帳號 <Tab> 密碼 <Tab> 邮箱 <Tab> API链接）======
// 第一行標題、空行、# 開頭的行都會自動略過。API链接可留空；會自動解析尾端 ----xxxx 當信箱密碼。
const ACCOUNTS = `
帳號	密碼	邮箱	API链接
qqsd01	11111111	agwa6461@outlook.com	http://query.paopaodw.com/boobar?email=agwa6461@outlook.com----ukem7855
qqsd02	11111111	ztfk6673@outlook.com	http://query.paopaodw.com/boobar?email=ztfk6673@outlook.com----ctcf2759
qqsd03	11111111	eimt6162@outlook.com	http://query.paopaodw.com/boobar?email=eimt6162@outlook.com----yhfp2349
qqsd04	11111111	ltkl8581@outlook.com	http://query.paopaodw.com/boobar?email=ltkl8581@outlook.com----mdku9662
`;

/* ==================== 以下不用改 ==================== */
(function () {
  "use strict";

  // ---- 解析帳號資料 ----
  function parseAccounts(text) {
    const rows = [];
    for (const raw of text.split("\n")) {
      const line = raw.replace(/\r$/, "");
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      let parts = s.split(/\t+|\s{2,}/);
      if (parts.length < 3) parts = s.split(/\s+/);
      if (parts.length < 3) continue;
      const [account, password, email] = parts;
      if (account === "帳號") continue; // 標題列
      const apiLink = parts[3] || "";
      const m = apiLink.match(/----([^\s]+)$/);
      rows.push({
        account, password, email,
        mailboxPassword: m ? m[1] : "",
      });
    }
    return rows;
  }

  const accounts = parseAccounts(ACCOUNTS);

  // ---- 進度（跨翻頁保存）----
  const getDone = () => new Set(GM_getValue("done", []));
  const setDone = (set) => GM_setValue("done", [...set]);
  const getBatchLeft = () => GM_getValue("batchLeft", 0);
  const setBatchLeft = (n) => GM_setValue("batchLeft", n);

  // ---- React/Vue 相容的填值（直接改 .value 不會觸發框架，得走原生 setter + 事件）----
  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ---- 找欄位：優先用設定的選擇器，否則自動猜 ----
  function find(sel, guessType) {
    if (sel) return document.querySelector(sel);
    if (guessType === "account") {
      return document.querySelector(
        "input[name*='user' i], input[name*='account' i], input[id*='user' i], input[id*='account' i], input[autocomplete='username']"
      );
    }
    if (guessType === "password") {
      return document.querySelector("input[type='password']");
    }
    if (guessType === "email") {
      return document.querySelector(
        "input[type='email'], input[name*='mail' i], input[id*='mail' i]"
      );
    }
    if (guessType === "submit") {
      let b = document.querySelector("button[type='submit'], input[type='submit']");
      if (b) return b;
      for (const el of document.querySelectorAll("button, input[type='button']")) {
        const t = (el.innerText || el.value || "").trim();
        if (/註冊|注册|送出|提交|注 ?册|sign ?up|register|submit/i.test(t)) return el;
      }
      return null;
    }
    return null;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(getter, timeout) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const el = getter();
      if (el) return el;
      await sleep(150);
    }
    return getter();
  }

  // ---- 填一組 ----
  async function fillOne(row, log) {
    const acc = await waitFor(() => find(CONFIG.selectors.account, "account"), CONFIG.waitFormMs);
    if (!acc) { log("找不到帳號欄，請在 CONFIG.selectors.account 填死選擇器。"); return false; }

    const setField = async (el, val, name) => {
      if (!el) { log(`找不到「${name}」欄，略過`); return; }
      el.focus();
      setNativeValue(el, val);
      await sleep(CONFIG.afterFillMs);
    };

    log(`填入 ${row.account}`);
    await setField(acc, row.account, "帳號");
    await setField(find(CONFIG.selectors.password, "password"), row.password, "密碼");
    await setField(find(CONFIG.selectors.email, "email"), row.email, "信箱");
    if (CONFIG.fillMailboxPassword && row.mailboxPassword) {
      await setField(find(CONFIG.selectors.mailboxPassword, null), row.mailboxPassword, "信箱密碼");
    }

    if (CONFIG.clickSubmit) {
      const btn = find(CONFIG.selectors.submit, "submit");
      if (btn) { log("按下送出"); btn.click(); }
      else log("找不到送出鈕（可在 CONFIG.selectors.submit 填死）");
    }
    await sleep(CONFIG.afterSubmitMs);
    return true;
  }

  // ---- 主流程：每次載入頁面時，若還在批次中就填下一組 ----
  async function tick(log, refresh) {
    if (getBatchLeft() <= 0) return;
    const done = getDone();
    const pending = accounts.filter((a) => !done.has(a.account));
    if (pending.length === 0) { setBatchLeft(0); log("全部填完了。"); refresh(); return; }

    const row = pending[0];
    const ok = await fillOne(row, log);
    if (ok) {
      done.add(row.account);
      setDone(done);
      setBatchLeft(getBatchLeft() - 1);
      refresh();
    }

    if (getBatchLeft() > 0 && pending.length > 1) {
      if (CONFIG.afterSubmit === "goto") location.href = CONFIG.registerUrl;
      else if (CONFIG.afterSubmit === "reload") location.reload();
      // "none"：留在原頁，不自動翻頁（適合送出後表單自己清空的網站）
    } else {
      setBatchLeft(0);
      log("這一批完成。");
      refresh();
    }
  }

  // ---- 右下角控制面板 ----
  function buildPanel() {
    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:999999;background:#1f2430;color:#e6e6e6;" +
      "font:13px/1.5 system-ui,sans-serif;padding:12px 14px;border-radius:10px;width:220px;" +
      "box-shadow:0 6px 24px rgba(0,0,0,.35)";
    box.innerHTML =
      "<div style='font-weight:600;margin-bottom:6px'>帳號自動建立器</div>" +
      "<div id='ac-stat' style='margin-bottom:8px;opacity:.85'></div>" +
      "<button id='ac-go' style='width:100%;padding:6px;margin-bottom:6px;cursor:pointer'>自動填 " +
      CONFIG.batchSize + " 組</button>" +
      "<button id='ac-one' style='width:100%;padding:6px;margin-bottom:6px;cursor:pointer'>只填 1 組</button>" +
      "<button id='ac-reset' style='width:100%;padding:6px;cursor:pointer'>重設進度</button>" +
      "<div id='ac-log' style='margin-top:8px;font-size:12px;opacity:.7;min-height:18px'></div>";
    document.body.appendChild(box);

    const stat = box.querySelector("#ac-stat");
    const logEl = box.querySelector("#ac-log");
    const log = (m) => { logEl.textContent = m; };
    const refresh = () => {
      const done = getDone().size;
      stat.textContent = `已填 ${done} / 共 ${accounts.length}　本批剩 ${getBatchLeft()}`;
    };
    refresh();

    box.querySelector("#ac-go").onclick = () => { setBatchLeft(CONFIG.batchSize); refresh(); tick(log, refresh); };
    box.querySelector("#ac-one").onclick = () => { setBatchLeft(1); refresh(); tick(log, refresh); };
    box.querySelector("#ac-reset").onclick = () => {
      setDone(new Set()); setBatchLeft(0); refresh(); log("進度已清除。");
    };

    return { log, refresh };
  }

  // 頁面就緒後建面板；若還在批次中（剛翻頁過來）就自動接著填
  window.addEventListener("load", async () => {
    await sleep(300);
    const { log, refresh } = buildPanel();
    if (getBatchLeft() > 0) tick(log, refresh);
  });
})();
