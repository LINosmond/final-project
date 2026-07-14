// 本機伺服器：提供網頁介面 + API，並負責「定時自動更新」。
import express from 'express';
import os from 'node:os';
import { config, PUBLIC_DIR, assertCredentials } from './config.js';
import * as store from './store.js';
import { fetchMany } from './scraper.js';

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// 更新狀態（給前端顯示「更新中…」）
const runState = { running: false, lastRunAt: null, lastError: null, currentItem: null };

// 更新指定商品（不給參數就更新全部釘選商品）。同一時間只跑一次。
async function refresh(itemIds) {
  if (runState.running) return { skipped: true, reason: '已有更新在進行中' };
  const items = store.getItems().filter((i) => !itemIds || itemIds.includes(i.id));
  if (!items.length) return { skipped: true, reason: '沒有要更新的商品' };

  runState.running = true;
  runState.lastError = null;
  try {
    assertCredentials();
    const names = items.map((i) => i.name);
    const nameToId = new Map(items.map((i) => [i.name, i.id]));
    await fetchMany(names, {
      onProgress: (name, result) => {
        runState.currentItem = name;
        const id = nameToId.get(name);
        if (id) store.setResult(id, result);
      },
    });
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
      hasCredentials: Boolean(config.account && config.password),
    },
  });
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

// 找出本機在區網的 IPv4 位址（手機要用這個連進來）
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

// 綁定 0.0.0.0，讓同一個 Wi-Fi 下的手機也連得到
app.listen(config.port, '0.0.0.0', () => {
  restartScheduler();
  const ips = lanAddresses();
  console.log('\n  RO 物價追蹤 已啟動');
  console.log(`  這台電腦上打開：   http://localhost:${config.port}`);
  if (ips.length) {
    console.log('\n  手機打開（要跟電腦連同一個 Wi-Fi）：');
    for (const ip of ips) console.log(`     http://${ip}:${config.port}`);
    console.log('  在手機瀏覽器輸入上面網址 → 選單「加到主畫面」就變成 App 圖示。');
  }
  console.log('  ※ 第一次啟動時 Windows 若跳出防火牆提示，請勾「私人網路」並允許存取。\n');
  if (!config.account || !config.password) {
    console.log('  ⚠ 尚未設定帳號密碼：請把 .env.example 複製成 .env 並填入帳密後重開。\n');
  }
});
