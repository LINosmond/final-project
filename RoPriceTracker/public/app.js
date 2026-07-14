const $ = (sel) => document.querySelector(sel);

let intervalDirty = false; // 使用者正在改「幾分鐘」時，暫停覆蓋輸入框

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  return res.json().catch(() => ({}));
}

function timeAgo(ts) {
  if (!ts) return '尚未更新';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  return `${Math.floor(h / 24)} 天前`;
}

function toNumber(v) {
  if (v == null) return NaN;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function fmt(n) {
  return Number.isFinite(n) ? n.toLocaleString('zh-TW') : '—';
}

let lastStatus = {};

function renderStatus(status) {
  lastStatus = status;
  const el = $('#status');
  if (status.running) {
    el.innerHTML = `<span class="spin dot">⟳</span> 更新中…${status.currentItem ? '（' + status.currentItem + '）' : ''}`;
  } else if (status.needsLogin) {
    el.innerHTML = `<span class="err">尚未登入 gnjoy</span>`;
  } else if (status.lastError) {
    el.innerHTML = `<span class="err">更新出錯：${status.lastError}</span>`;
  } else {
    el.innerHTML = `<span class="dot">●</span> 上次全部更新：${timeAgo(status.lastRunAt)}`;
  }
  renderLoginBox(status);
}

function renderLoginBox(status) {
  const box = $('#login-box');
  box.classList.remove('hidden'); // 登入區永遠顯示，方便隨時登入
  const openBtn = $('#login-open');
  const doneBtn = $('#login-done');
  const cancelBtn = $('#login-cancel');

  if (status.loginOpen) {
    $('#login-msg').textContent = '已打開你電腦的瀏覽器（Edge/Chrome）視窗，請在裡面登入 gnjoy，完成後按右邊 →';
    openBtn.classList.add('hidden');
    doneBtn.classList.remove('hidden');
    cancelBtn.classList.remove('hidden');
    box.classList.remove('ok');
    return;
  }

  doneBtn.classList.add('hidden');
  cancelBtn.classList.add('hidden');
  openBtn.classList.remove('hidden');
  openBtn.disabled = false;

  if (status.needsLogin) {
    $('#login-msg').textContent = '⚠ 還沒登入 gnjoy，先點右邊登入才能查價。';
    openBtn.textContent = '登入 gnjoy';
    box.classList.remove('ok');
  } else if (status.hasSession) {
    $('#login-msg').textContent = '✓ 已登入 gnjoy（若查不到價格可重新登入）。';
    openBtn.textContent = '重新登入';
    box.classList.add('ok');
  } else {
    $('#login-msg').textContent = '第一次使用請先登入 gnjoy（點右邊 →），登入一次之後會記住。';
    openBtn.textContent = '登入 gnjoy';
    box.classList.remove('ok');
  }
}

function renderResultBody(result) {
  if (!result) return `<div class="muted">尚未查詢，稍待自動更新…</div>`;
  if (result.needsLogin) return `<div class="muted">🔒 需要先登入 gnjoy（點上方黃色「登入 gnjoy」按鈕）。</div>`;
  if (!result.ok) return `<div class="muted err">查詢失敗：${result.error || '未知錯誤'}</div>`;

  const listings = result.listings || [];
  const rawRows = result.rawRows || [];

  if (listings.length) {
    const prices = listings.map((l) => toNumber(l.price)).filter(Number.isFinite);
    const lowest = prices.length ? Math.min(...prices) : NaN;
    const rows = listings
      .slice()
      .sort((a, b) => (toNumber(a.price) || Infinity) - (toNumber(b.price) || Infinity))
      .slice(0, 20)
      .map(
        (l) => `<tr>
          <td>${esc(l.name)}</td>
          <td>${fmt(toNumber(l.price))}</td>
          <td>${esc(l.quantity)}</td>
          <td>${esc(l.seller)}</td>
        </tr>`
      )
      .join('');
    return `
      <div class="best">${fmt(lowest)} <small>最低價 · 共 ${listings.length} 筆</small></div>
      <table class="listings">
        <thead><tr><th>商品</th><th>價格</th><th>數量</th><th>賣家</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  if (rawRows.length) {
    const body = rawRows
      .slice(0, 30)
      .map((cells) => `<tr>${cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
      .join('');
    return `
      <div class="muted">已抓到頁面表格（爬蟲欄位尚未對準，先顯示原始內容）：</div>
      <details class="details" open>
        <summary>展開 ${rawRows.length} 列</summary>
        <div class="rawtable"><table class="listings"><tbody>${body}</tbody></table></div>
      </details>`;
  }

  return `<div class="muted">這次沒抓到資料。可能是查無此商品，或爬蟲需要對頁面調整（跑一次 <code>npm run capture</code> 給我看看）。</div>`;
}

function esc(v) {
  if (v == null) return '';
  return String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function render(state) {
  renderStatus(state.status);

  if (!intervalDirty) $('#interval').value = state.settings.intervalMinutes;

  const container = $('#items');
  const tpl = $('#item-tpl');
  container.innerHTML = '';
  $('#empty').classList.toggle('hidden', state.items.length > 0);

  for (const item of state.items) {
    const node = tpl.content.cloneNode(true);
    const result = state.results[item.id];
    node.querySelector('.item-name').textContent = item.name;
    const meta = node.querySelector('.item-meta');
    if (result) {
      const cls = result.ok ? 'ok' : 'err';
      meta.innerHTML = `<span class="${cls}">${result.ok ? '✓' : '✕'}</span> 更新於 ${timeAgo(result.updatedAt)}`;
    } else {
      meta.textContent = '尚未查詢';
    }
    node.querySelector('.item-body').innerHTML = renderResultBody(result);
    node.querySelector('.refresh').addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = '更新中…';
      await api(`/api/items/${item.id}/refresh`, { method: 'POST' });
      load();
    });
    node.querySelector('.remove').addEventListener('click', async () => {
      if (!confirm(`確定不再追蹤「${item.name}」？`)) return;
      await api(`/api/items/${item.id}`, { method: 'DELETE' });
      load();
    });
    container.appendChild(node);
  }
}

async function load() {
  const state = await api('/api/state');
  render(state);
}

// 事件
$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#add-input');
  const name = input.value.trim();
  if (!name) return;
  input.value = '';
  await api('/api/items', { method: 'POST', body: JSON.stringify({ name }) });
  load();
});

$('#refresh-all').addEventListener('click', async (e) => {
  e.target.disabled = true;
  await api('/api/refresh', { method: 'POST' });
  e.target.disabled = false;
  load();
});

// 登入流程
$('#login-open').addEventListener('click', async (e) => {
  e.target.disabled = true;
  e.target.textContent = '正在打開登入視窗…';
  const r = await api('/api/login/open', { method: 'POST' });
  if (r.error) { alert(r.error); e.target.disabled = false; e.target.textContent = '登入 gnjoy'; }
  load();
});
$('#login-done').addEventListener('click', async (e) => {
  e.target.disabled = true;
  e.target.textContent = '確認中…';
  const r = await api('/api/login/done', { method: 'POST' });
  e.target.disabled = false;
  e.target.textContent = '我登入好了 ✓';
  if (r.loggedIn === false) {
    alert('已把登入狀態存下來了。如果你確定在視窗裡登入好了，可以直接搜一個商品看看；查不到再按一次「重新登入」。');
  }
  load();
});
$('#login-cancel').addEventListener('click', async () => {
  await api('/api/login/cancel', { method: 'POST' });
  load();
});

$('#interval').addEventListener('input', () => { intervalDirty = true; });
$('#save-interval').addEventListener('click', async () => {
  const intervalMinutes = Number($('#interval').value);
  await api('/api/settings', { method: 'POST', body: JSON.stringify({ intervalMinutes }) });
  intervalDirty = false;
  load();
});

// 開始：載入一次，之後每 4 秒同步一次狀態（就能看到自動更新的結果）
load();
setInterval(load, 4000);
