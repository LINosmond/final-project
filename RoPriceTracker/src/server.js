// 本機伺服器：提供網頁介面 + API，並負責「定時自動更新」。
import express from 'express';
import os from 'node:os';
import { config, PUBLIC_DIR } from './config.js';
import * as store from './store.js';
import { fetchMany, openLoginBrowser } from './scraper.js';

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// 更新狀態（給前端顯示「更新中…」「需不需要登入」）
const runState = { running: false, lastRunAt: null, lastError: null, currentItem: null, needsLogin: false };

// 正在開啟中的「手動登入」瀏覽器視窗把手（同時只允許一個）
let loginHandle = null;

// 更新指定商品（不給參數就更新全部釘選商品）。同一時間只跑一次。
async function refresh(itemIds) {
  if (runState.running) return { skipped: true, reason: '已有更新在進行中' };
  const items = store.getItems().filter((i) => !itemIds || itemIds.includes(i.id));
  if (!items.length) return { skipped: true, reason: '沒有要更新的商品' };

  runState.running = true;
  runState.lastError = null;
  try {
    const names = items.map((i) => i.name);
    const nameToId = new Map(items.map((i) => [i.name, i.id]));
    let sawNeedsLogin = false;
    await fetchMany(names, {
      onProgress: (name, result) => {
        runState.currentItem = name;
        if (result.needsLogin) sawNeedsLogin = true;
        const id = nameToId.get(name);
        if (id) store.setResult(id, result);
      },
    });
    runState.needsLogin = sawNeedsLogin;
    runState.lastRunAt = Date.now();
    return { ok: true };
  } catch (err) {
    runState.lastError = String(err.message || err);
    return { ok: false, error: runState.lastError };
  } finally {
    runState.running = false;
    runState.currentItem = null;
  }
}

// ── API ───────────────────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  res.json({
    items: store.getItems(),
    results: store.getState().results,
    settings: store.getSettings(),
    status: {
      running: runState.running,
      currentItem: runState.currentItem,
      lastRunAt: runState.lastRunAt,
      lastError: runState.lastError,
      needsLogin: runState.needsLogin,
      loginOpen: Boolean(loginHandle),
    },
  });
});

// ── 登入（手動一次，之後沿用）───────────────────────────────────────────────
// 開一個看得到的瀏覽器視窗讓使用者登入 gnjoy。
app.post('/api/login/open', async (req, res) => {
  try {
    if (loginHandle) return res.json({ ok: true, alreadyOpen: true });
    loginHandle = await openLoginBrowser();
    res.json({ ok: true });
  } catch (err) {
    loginHandle = null;
    res.status(500).json({ error: '打不開登入視窗：' + String(err.message || err) });
  }
});

// 使用者在視窗登入好之後按這個：存下登入狀態並關閉視窗。
app.post('/api/login/done', async (req, res) => {
  if (!loginHandle) return res.status(400).json({ error: '沒有開啟中的登入視窗' });
  try {
    const loggedIn = await loginHandle.finish();
    loginHandle = null;
    runState.needsLogin = !loggedIn;
    if (loggedIn) refresh(null); // 登入成功後順便更新一次全部
    res.json({ ok: true, loggedIn });
  } catch (err) {
    loginHandle = null;
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/login/cancel', async (req, res) => {
  if (loginHandle) {
    await loginHandle.cancel();
    loginHandle = null;
  }
  res.json({ ok: true });
});

app.post('/api/items', (req, res) => {
  try {
    const item = store.addItem(req.body?.name);
    refresh([item.id]); // 新增後立刻查一次（不等它完成）
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.delete('/api/items/:id', (req, res) => {
  store.removeItem(req.params.id);
  res.json({ ok: true });
});

app.post('/api/items/:id/refresh', async (req, res) => {
  const r = await refresh([req.params.id]);
  res.json(r);
});

app.post('/api/refresh', async (req, res) => {
  const r = await refresh(null);
  res.json(r);
});

app.post('/api/settings', (req, res) => {
  const patch = {};
  const mins = Number(req.body?.intervalMinutes);
  if (Number.isFinite(mins) && mins >= 1) patch.intervalMinutes = Math.round(mins);
  const settings = store.updateSettings(patch);
  restartScheduler();
  res.json(settings);
});

// ── 定時排程 ────────────────────────────────────────────────────────────────
let timer = null;
function restartScheduler() {
  if (timer) clearInterval(timer);
  const mins = store.getSettings().intervalMinutes || 30;
  timer = setInterval(() => {
    refresh(null).catch(() => {});
  }, mins * 60 * 1000);
}

// Tailscale 給裝置的 IP 落在 100.64.0.0/10（100.64 ~ 100.127）。
function isTailscale(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

// 找出本機的 IPv4 位址，分成「同 Wi-Fi 的區網」和「Tailscale（不同網路可用）」。
function localAddresses() {
  const lan = [];
  const tailscale = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      (isTailscale(ni.address) ? tailscale : lan).push(ni.address);
    }
  }
  return { lan, tailscale };
}

// 綁定 0.0.0.0，讓同一個 Wi-Fi 的手機、以及 Tailscale 的裝置都連得到
app.listen(config.port, '0.0.0.0', () => {
  restartScheduler();
  const { lan, tailscale } = localAddresses();
  console.log('\n  RO 物價追蹤 已啟動');
  console.log(`  這台電腦上打開：   http://localhost:${config.port}`);
  if (lan.length) {
    console.log('\n  手機打開（跟電腦連同一個 Wi-Fi）：');
    for (const ip of lan) console.log(`     http://${ip}:${config.port}`);
  }
  if (tailscale.length) {
    console.log('\n  手機打開（不同網路也能用 · Tailscale）：');
    for (const ip of tailscale) console.log(`     http://${ip}:${config.port}`);
    console.log('  （手機也要開著 Tailscale、登入同一個帳號）');
  } else {
    console.log('\n  想在不同網路下使用？裝好 Tailscale 後，這裡會多出一個 100.x.x.x 的網址。');
  }
  console.log('\n  在手機瀏覽器輸入上面網址 → 選單「加到主畫面」就變成 App 圖示。');
  console.log('  ※ 第一次啟動時 Windows 若跳出防火牆提示，請勾「私人網路」並允許存取。');
  console.log('  ※ 第一次查詢前，請在網頁上點「登入 gnjoy」登入一次。\n');
});
