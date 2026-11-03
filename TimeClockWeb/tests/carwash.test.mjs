// 洗車紀錄表：後端在試算表建立「洗車 YYYY-MM」分頁、讀回數字。以模擬的試算表執行 Code.gs，不連真正的 Google。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../google-apps-script/Code.gs', import.meta.url), 'utf8');
const ADMIN_PW = '999888';

function mockSheet(name, id, registry, nextId, order = []) {
  const cells = new Map();
  const key = (r, c) => `${r},${c}`;
  const sh = {
    name, cells,
    getName: () => sh.name,
    getIndex: () => order.indexOf(sh) + 1,
    getSheetId: () => id,
    setFrozenRows() {}, setFrozenColumns() {},
    setName(nm) { delete registry[sh.name]; sh.name = nm; registry[nm] = sh; return sh; },
    copyTo() {
      const copy = mockSheet(sh.name + ' 的副本', nextId(), registry, nextId, order);
      cells.forEach((v, k) => copy.cells.set(k, v instanceof Date ? new Date(v) : v));
      registry[copy.name] = copy;
      return copy;
    },
    getRange(r, c, nr = 1, nc = 1) {
      const grid = f => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => f(cells.get(key(r + i, c + j)))));
      return {
        setValues(rows) { rows.forEach((row, i) => row.forEach((v, j) => cells.set(key(r + i, c + j), v))); return this; },
        setFormulas(rows) { return this.setValues(rows); },
        getValues() { return grid(v => v ?? ''); },
        getFormulas() { return grid(v => (typeof v === 'string' && v.startsWith('=') ? v : '')); },
      };
    },
    set(r, c, v) { cells.set(key(r, c), v); },
    get(r, c) { return cells.get(key(r, c)); },
  };
  order.push(sh);
  return sh;
}

// 依使用者 Excel「範本」分頁的版面做一份假的範本（4 月、7 位員工、單價公式 *15）
const col = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const C = s => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
function fillTemplate(t) {
  t.set(1, 1, '4月');
  ['許嘉晏', '林俐璇', '林毅傑', '韓建龍', '陳益昌', '劉祐寧', '潘柏翰'].forEach((nm, i) => t.set(1, 3 + i, nm));
  t.set(1, 11, '單日合計');
  for (let d = 1; d <= 31; d++) {
    const r = 2 + d;
    t.set(r, 1, new Date(2026, 3, d));
    t.set(r, 2, `=A${r}`);
    t.set(r, 11, `=SUM(C${r}:J${r})*15`);
  }
  for (let c = 3; c <= 10; c++) { t.set(35, c, `=SUM(${col(c)}1:${col(c)}33)`); t.set(36, c, `=SUM(${col(c)}1:${col(c)}33)*15`); }
  t.set(36, 11, '=SUM(C36:J36)');
  [[18, 80], [20, 100], [22, 180], [24, 250], [33, 80], [35, 100], [37, 180], [39, 250]].forEach(([c, p]) => t.set(1, c, p));
  t.set(1, C('Z'), '金額'); t.set(1, C('AO'), '金額');
  for (let r = 3; r <= 32; r++) { t.set(r, C('Q'), r % 2 ? '早' : '晚'); t.set(r, C('Z'), `=$R$1*R${r}+$T$1*T${r}+$V$1*V${r}+$X$1*X${r}`); }
  for (let r = 3; r <= 34; r++) { t.set(r, C('AF'), r % 2 ? '早' : '晚'); t.set(r, C('AO'), `=$AG$1*AG${r}+$AI$1*AI${r}+$AK$1*AK${r}+$AM$1*AM${r}`); }
  t.set(35, C('AO'), '=SUM(Z3:AA32,AO3:AP34)');
  // 範本裡殘留的輸入（測試清空用）：31 號的數量與收入
  t.set(33, 3, 5); t.set(33, C('AG'), 2); t.set(34, C('AM'), 1);
}

function backend(employees, { template = false, extra = [] } = {}) {
  const kv = new Map([['employees', JSON.stringify(employees)]]);
  const sheets = {}; let n = 0;
  const nextId = () => 1000 + (++n);
  const order = [];
  if (template) fillTemplate(sheets['範本'] = mockSheet('範本', nextId(), sheets, nextId, order));
  for (const nm of extra) sheets[nm] = mockSheet(nm, nextId(), sheets, nextId, order);
  let active = null;
  const ss = {
    getSheetByName: (nm) => sheets[nm] || null,
    insertSheet: (nm) => (sheets[nm] = mockSheet(nm, nextId(), sheets, nextId, order)),
    getSheets: () => order.slice(),
    setActiveSheet: (sh) => { active = sh; return sh; },
    moveActiveSheet: (pos) => { order.splice(order.indexOf(active), 1); order.splice(pos - 1, 0, active); },
    order,
    getUrl: () => 'https://docs.google.com/spreadsheets/d/fixture/edit',
  };
  const props = { ADMIN_PASSWORD: ADMIN_PW };
  const ctx = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => 'u', formatDate: () => '2026-10' },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
  });
  vm.runInContext(source, ctx);
  ctx.getSheet_ = () => ({});
  ctx.readValue_ = (_, k) => kv.get(k) ?? null;
  ctx.writeValue_ = (_, k, v) => kv.set(k, v);
  ctx.jsonResponse_ = obj => JSON.parse(JSON.stringify(obj));
  const call = body => ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  return { call, sheets, order };
}

const emps = [
  { id: 'e1', name: '許嘉晏', status: 'active' },
  { id: 'e2', name: '韓建龍', status: 'active' },
  { id: 'e3', name: '已封存', status: 'archived' },
  { id: 'e4', name: '待審核', status: 'pending' },
];
const A = { adminPassword: ADMIN_PW };

test('非管理員不能開啟或讀取洗車分頁', () => {
  const b = backend(emps);
  assert.equal(b.call({ action: 'openCarwashSheet', ym: '2026-10' }).ok, false);
  assert.equal(b.call({ action: 'getCarwash', ym: '2026-10' }).ok, false);
  assert.deepEqual(Object.keys(b.sheets), []);
});

test('開啟時建立「洗車 YYYY-MM」分頁，版面同 Excel，回傳指向該分頁的網址', () => {
  const b = backend(emps);
  const r = b.call({ action: 'openCarwashSheet', ym: '2026-11', ...A });
  assert.equal(r.ok, true);
  assert.match(r.url, /#gid=\d+$/);
  const sh = b.sheets['洗車 2026-11'];
  assert.ok(sh);
  assert.equal(sh.get(1, 3), 8); // C1 每單位金額
  assert.equal(sh.get(2, 3), '許嘉晏');
  assert.equal(sh.get(2, 4), '韓建龍');
  assert.equal(sh.get(2, 5), ''); // 封存、待審核不列入
  assert.equal(sh.get(3, 1), '11/1');
  assert.equal(sh.get(32, 1), '11/30'); // 11 月 30 天
  assert.equal(sh.get(2, 21), '班');
  assert.equal(sh.get(3, 21), '早');
  assert.equal(sh.get(4, 21), '晚');
  // 再開一次不重建、不覆蓋已填資料
  sh.set(3, 3, 9.5);
  b.call({ action: 'openCarwashSheet', ym: '2026-11', ...A });
  assert.equal(b.sheets['洗車 2026-11'].get(3, 3), 9.5);
});

test('讀取：依姓名對到員工 ID，計入數量、單價與收入；對不到的姓名列出', () => {
  const b = backend(emps);
  b.call({ action: 'openCarwashSheet', ym: '2026-10', ...A });
  const sh = b.sheets['洗車 2026-10'];
  sh.set(1, 3, 10);        // 單價改 10
  sh.set(3, 3, 11);        // 10/1 許嘉晏 11
  sh.set(4, 3, '9.5');     // 10/2 許嘉晏 9.5
  sh.set(5, 4, 4);         // 10/3 韓建龍 4
  sh.set(2, 5, '林俐璇');  // 系統沒有的人
  sh.set(3, 5, 7);
  sh.set(3, 24, 2);        // 10/1 早班 180 元 2 台（T=20 起：日期、班、80、100、180 → 第 24 欄）
  sh.set(6, 22, 1);        // 10/2 晚班 80 元 1 台
  const r = b.call({ action: 'getCarwash', ym: '2026-10', ...A });
  assert.equal(r.ok, true);
  assert.equal(r.data.rate, 10);
  assert.deepEqual(r.data.units, { e1: { 1: 11, 2: 9.5 }, e2: { 3: 4 } });
  assert.deepEqual(r.data.unknown, ['林俐璇']);
  assert.equal(r.data.sales[1]['早'][180], 2);
  assert.equal(r.data.sales[2]['晚'][80], 1);
});

test('分頁不存在時讀取回傳 null，不會自動建立', () => {
  const b = backend(emps);
  const r = b.call({ action: 'getCarwash', ym: '2026-09', ...A });
  assert.equal(r.ok, true);
  assert.equal(r.data, null);
  assert.deepEqual(Object.keys(b.sheets), []);
});

test('有「範本」分頁時複製它建立新月份：月份、日期、姓名、單價公式改 *8，範本本身不動', () => {
  const b = backend(emps, { template: true });
  const r = b.call({ action: 'openCarwashSheet', ym: '2026-11', ...A });
  assert.equal(r.ok, true);
  assert.deepEqual(r.overflow, []);
  const sh = b.sheets['洗車 2026-11'];
  assert.ok(sh);
  assert.match(r.url, new RegExp(`#gid=${sh.getSheetId()}$`));
  assert.equal(sh.get(1, 1), '11月');
  assert.equal(sh.get(1, 11), '單日合計');
  assert.deepEqual([3, 4, 5, 6, 7, 8, 9, 10].map(c => sh.get(1, c)), ['許嘉晏', '韓建龍', '', '', '', '', '', '']); // 範本原有姓名被覆蓋
  assert.equal(Object.prototype.toString.call(sh.get(3, 1)), "[object Date]");
  assert.equal(sh.get(3, 1).getTime(), new Date(2026, 10, 1).getTime());
  assert.equal(sh.get(32, 1).getTime(), new Date(2026, 10, 30).getTime());
  assert.equal(sh.get(33, 1), ''); // 11 月沒有 31 號
  assert.equal(sh.get(33, 3), ''); // 31 號的數量清空
  assert.equal(sh.get(33, C('AG')), ''); assert.equal(sh.get(34, C('AM')), ''); // 31 號的收入清空
  assert.equal(sh.get(3, 11), '=SUM(C3:J3)*8');
  assert.equal(sh.get(33, 11), '=SUM(C33:J33)*8');
  assert.equal(sh.get(36, 3), '=SUM(C1:C33)*8');
  assert.equal(sh.get(36, 10), '=SUM(J1:J33)*8');
  assert.equal(sh.get(35, 3), '=SUM(C1:C33)'); // 其他公式不動
  assert.equal(sh.get(32, 2), '=A32'); assert.equal(sh.get(33, 2), ''); // 沒有的日子星期也清空
  assert.equal(sh.get(35, C('AO')), '=SUM(Z3:AA32,AO3:AP34)');
  assert.equal(sh.get(3, C('Z')), '=$R$1*R3+$T$1*T3+$V$1*V3+$X$1*X3');
  // 範本本身不動
  const t = b.sheets['範本'];
  assert.equal(t.get(1, 1), '4月');
  assert.equal(t.get(1, 3), '許嘉晏');
  assert.equal(t.get(3, 11), '=SUM(C3:J3)*15');
  // 再開一次：不重建、不覆蓋已填資料，只把新員工補進空格
  sh.set(3, 3, 9.5);
  const b2emps = [...emps, { id: 'e5', name: '新同事', status: 'active' }];
  b.sheets['洗車 2026-11'] = sh;
  const kvCall = backend(b2emps, { template: true });
  kvCall.sheets['洗車 2026-11'] = sh;
  kvCall.call({ action: 'openCarwashSheet', ym: '2026-11', ...A });
  assert.equal(sh.get(3, 3), 9.5);
  assert.equal(sh.get(1, 1), '11月');
  assert.deepEqual([3, 4, 5, 6].map(c => sh.get(1, c)), ['許嘉晏', '韓建龍', '新同事', '']);
});

test('範本建立 2 月：29～31 號的日期與數量、收入台數清空', () => {
  const b = backend(emps, { template: true });
  b.call({ action: 'openCarwashSheet', ym: '2026-02', ...A });
  const sh = b.sheets['洗車 2026-02'];
  assert.equal(sh.get(1, 1), '2月');
  assert.equal(sh.get(30, 1).getTime(), new Date(2026, 1, 28).getTime());
  for (const r of [31, 32, 33]) {
    assert.equal(sh.get(r, 1), '');
    for (let c = 3; c <= 10; c++) assert.equal(sh.get(r, c), '');
    assert.equal(sh.get(r, 11), `=SUM(C${r}:J${r})*8`); // 公式保留
  }
  for (const r of [29, 30, 31, 32, 33, 34]) for (const c of ['AG', 'AI', 'AK', 'AM']) assert.equal(sh.get(r, C(c)), '');
});

test('範本建立：在職員工超過 8 人只填前 8 位，其餘回傳在 overflow', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, name: `員工${i + 1}`, status: 'active' }));
  const b = backend(many, { template: true });
  const r = b.call({ action: 'openCarwashSheet', ym: '2026-11', ...A });
  const sh = b.sheets['洗車 2026-11'];
  assert.equal(sh.get(1, 10), '員工8');
  assert.equal(sh.get(1, 11), '單日合計');
  assert.deepEqual(r.overflow, ['員工9', '員工10']);
  assert.deepEqual(b.call({ action: 'openCarwashSheet', ym: '2026-11', ...A }).overflow, ['員工9', '員工10']);
});

test('讀取範本版面：數量、單價（K3 公式）、左右兩塊早晚收入、對不到的姓名', () => {
  const b = backend(emps, { template: true });
  b.call({ action: 'openCarwashSheet', ym: '2026-10', ...A });
  const sh = b.sheets['洗車 2026-10'];
  sh.set(3, 3, 11);          // 10/1 許嘉晏 11
  sh.set(4, 3, '9.5');       // 10/2 許嘉晏 9.5
  sh.set(5, 4, 0.5);         // 10/3 韓建龍 0.5
  sh.set(33, 4, 2);          // 10/31 韓建龍 2
  sh.set(1, 10, '林俐璇');   // 系統沒有的人（J1）
  sh.set(3, 10, 7);
  sh.set(3, C('R'), 2);      // 1 號早 80 元 2 台
  sh.set(6, C('X'), 1);      // 2 號晚 250 元 1 台
  sh.set(32, C('V'), 3);     // 15 號晚 180 元 3 台
  sh.set(3, C('AG'), 4);     // 16 號早 80 元 4 台
  sh.set(34, C('AM'), 5);    // 31 號晚 250 元 5 台
  sh.set(33, C('AI'), 6);    // 31 號早 100 元 6 台
  let r = b.call({ action: 'getCarwash', ym: '2026-10', ...A });
  assert.equal(r.ok, true);
  assert.equal(r.data.rate, 8);
  assert.deepEqual(r.data.units, { e1: { 1: 11, 2: 9.5 }, e2: { 3: 0.5, 31: 2 } });
  assert.deepEqual(r.data.unknown, ['林俐璇']);
  assert.deepEqual(r.data.sales, {
    1: { '早': { 80: 2 } }, 2: { '晚': { 250: 1 } }, 15: { '晚': { 180: 3 } },
    16: { '早': { 80: 4 } }, 31: { '早': { 100: 6 }, '晚': { 250: 5 } },
  });
  sh.set(3, 11, '=SUM(C3:J3)*15'); // 手動把單價改成 15
  r = b.call({ action: 'getCarwash', ym: '2026-10', ...A });
  assert.equal(r.data.rate, 15);
  sh.set(3, 11, 0);                // 公式被蓋掉：用預設 8
  r = b.call({ action: 'getCarwash', ym: '2026-10', ...A });
  assert.equal(r.data.rate, 8);
});

test('沒有範本時用舊版面建立，預設單價 8，讀取也照舊版面', () => {
  const b = backend(emps);
  const r = b.call({ action: 'openCarwashSheet', ym: '2026-12', ...A });
  assert.deepEqual(r.overflow, []);
  const sh = b.sheets['洗車 2026-12'];
  assert.equal(sh.get(1, 3), 8);
  assert.equal(sh.get(2, 3), '許嘉晏');
  assert.equal(sh.get(1, 11), undefined);
  sh.set(1, 3, '');
  assert.equal(b.call({ action: 'getCarwash', ym: '2026-12', ...A }).data.rate, 8);
});

test('新的洗車分頁排在最後一個洗車分頁後面，不跑到列印用分頁後面', () => {
  for (const template of [true, false]) {
    const b = backend(emps, { template, extra: ['KV', '洗車 2026-10', '手抄版', '出勤表'] });
    assert.equal(b.call({ action: 'openCarwashSheet', ym: '2026-11', ...A }).ok, true);
    assert.equal(b.call({ action: 'openCarwashSheet', ym: '2026-12', ...A }).ok, true);
    const names = b.order.map(s => s.name).filter(n => n !== '範本');
    assert.deepEqual(names, ['KV', '洗車 2026-10', '洗車 2026-11', '洗車 2026-12', '手抄版', '出勤表']);
  }
  // 完全沒有洗車分頁時不移動
  const b = backend(emps, { extra: ['KV', '手抄版'] });
  b.call({ action: 'openCarwashSheet', ym: '2026-11', ...A });
  assert.deepEqual(b.order.map(s => s.name), ['KV', '手抄版', '洗車 2026-11']);
});
