// 洗車紀錄表：後端在試算表建立「洗車 YYYY-MM」分頁、讀回數字。以模擬的試算表執行 Code.gs，不連真正的 Google。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../google-apps-script/Code.gs', import.meta.url), 'utf8');
const ADMIN_PW = '999888';

function mockSheet(name, id) {
  const cells = new Map();
  const key = (r, c) => `${r},${c}`;
  return {
    name, cells,
    getSheetId: () => id,
    setFrozenRows() {}, setFrozenColumns() {},
    getRange(r, c, nr = 1, nc = 1) {
      return {
        setValues(rows) { rows.forEach((row, i) => row.forEach((v, j) => cells.set(key(r + i, c + j), v))); return this; },
        getValues() { return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cells.get(key(r + i, c + j)) ?? '')); },
      };
    },
    set(r, c, v) { cells.set(key(r, c), v); },
    get(r, c) { return cells.get(key(r, c)); },
  };
}

function backend(employees) {
  const kv = new Map([['employees', JSON.stringify(employees)]]);
  const sheets = {}; let n = 0;
  const ss = {
    getSheetByName: (nm) => sheets[nm] || null,
    insertSheet: (nm) => (sheets[nm] = mockSheet(nm, 1000 + (++n))),
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
  return { call, sheets };
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
