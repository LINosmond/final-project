import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { transformWithEsbuild } from 'vite';
import React from 'react';
import { create, act } from 'react-test-renderer';

process.env.TZ = 'Asia/Taipei';
const source = await fs.readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'App.jsx', { loader: 'jsx', jsx: 'transform' });
const generated = resolve('node_modules/.cache/timeclock-test/App.mjs');
await fs.mkdir(resolve('node_modules/.cache/timeclock-test'), { recursive: true });
await fs.copyFile(new URL('../src/startupSnapshot.js', import.meta.url), resolve('node_modules/.cache/timeclock-test/startupSnapshot.js'));
await fs.writeFile(generated, code);
const { default: App, SalaryPanel, salaryEffectiveRecord, salaryHoursOf, salaryCalc, computeMonthRows } = await import(pathToFileURL(generated));
const emp = { id: 'test', name: 'Test', status: 'active' };
const date = new Date();
const year = date.getFullYear(), month = date.getMonth() + 1;
const ym = `${year}-${String(month).padStart(2, '0')}`;
const key = day => `${ym}-${String(day).padStart(2, '0')}`;
const punches = (day, hours, employeeId = emp.id) => [
  { id: `${day}-in`, employeeId, type: 'in', ts: new Date(year, month - 1, day, 8).getTime() },
  { id: `${day}-out`, employeeId, type: 'out', ts: new Date(year, month - 1, day, 8 + hours).getTime() },
];
const holidays = { [key(1)]: false, [key(2)]: false };
const salary = { test: { [ym]: { position: '', workHours: 46.5, otHours: 99, hourlyRate: 200, otRate: 300, specialBonus: 500, advance: 100 } } };
const props = { employees: [emp], punches: punches(1, 8), holidays, otMultiplier: 2, salary, onSaveSalary: async () => {} };
const input = (view, label) => view.root.findByProps({ 'aria-label': label });
const button = (view, text) => view.root.findAllByType('button').find(b => String(b.props.children).includes(text));

test('舊結算工時忽略；補登、刪除、空月份均採最新考勤，金額設定保留', () => {
  const before = JSON.stringify(salary);
  for (const [rows, work, ot] of [[punches(1, 8), 8, 0], [[...punches(1, 10), ...punches(2, 4)], 12, 2], [[], 0, 0]]) {
    const rec = salaryEffectiveRecord(emp, salary, rows, year, month, 2, holidays);
    assert.equal(rec.workHours, work); assert.equal(rec.otHours, ot);
    assert.equal(rec.specialBonus, 500); assert.equal(rec.advance, 100);
  }
  assert.equal(JSON.stringify(salary), before);
});

test('假日、加班分列與考勤加權合計一致，不重複乘倍率', () => {
  const rows = [...punches(1, 10), ...punches(2, 4)];
  const overrides = { ...holidays, [key(2)]: true };
  const h = salaryHoursOf(emp, rows, year, month, 2, overrides);
  assert.deepEqual(h, { work: 16, ot: 2 });
  assert.equal(computeMonthRows(emp, rows, year, month, 2, overrides).reduce((n, r) => n + r.displayMin, 0) / 60, h.work + h.ot * 2);
  assert.equal(salaryCalc({ workHours: h.work, otHours: h.ot, hourlyRate: 200, otRate: 300 }).gross, 3800);
});

test('月薪與舊站長資料固定 1／0；不同員工及月份互不混用', () => {
  for (const position of ['月薪', '站長']) {
    const s = { test: { [ym]: { position, workHours: 77, otHours: 88, hourlyRate: 30000 } } };
    const rec = salaryEffectiveRecord(emp, s, punches(1, 10), year, month, 2, holidays);
    assert.equal(rec.workHours, 1); assert.equal(rec.otHours, 0); assert.equal(salaryCalc(rec).gross, 30000);
  }
  assert.deepEqual(salaryHoursOf(emp, punches(1, 8, 'other'), year, month, 2, holidays), { work: 0, ot: 0 });
  const next = new Date(year, month, 1);
  assert.deepEqual(salaryHoursOf(emp, punches(1, 8), next.getFullYear(), next.getMonth() + 1, 2, {}), { work: 0, ot: 0 });
});

test('薪資頁即時跟隨考勤，保留未存獎金，工時唯讀且無帶入按鈕', async () => {
  let view;
  await act(async () => { view = create(React.createElement(SalaryPanel, props)); });
  assert.equal(input(view, '工作時數').props.value, 8);
  await act(async () => { input(view, '特別獎金').props.onChange({ target: { value: '777' } }); });
  const originalInput = input(view, '特別獎金');
  await act(async () => { view.update(React.createElement(SalaryPanel, { ...props, punches: punches(1, 10), salary: JSON.parse(JSON.stringify(salary)) })); });
  assert.equal(input(view, '工作時數').props.value, 8);
  assert.equal(input(view, '加班時數').props.value, 2);
  assert.equal(input(view, '特別獎金').props.value, '777');
  assert.equal(input(view, '特別獎金'), originalInput);
  assert.equal(input(view, '工作時數').props.readOnly, true);
  assert.equal(button(view, '點我帶入'), undefined);
  await act(async () => { view.update(React.createElement(SalaryPanel, { ...props, punches: [], holidays })); });
  assert.equal(input(view, '工作時數').props.value, 0);
  assert.equal(input(view, '特別獎金').props.value, '777');
  await act(async () => { view.unmount(); });
});

test('儲存不固定工時、連點只送一次；列印／CSV使用最新考勤', async () => {
  let view, resolveSave, saved, calls = 0, html = '', csvBlob;
  const changed = { ...props, punches: punches(1, 10), onSaveSalary: (...args) => { calls++; saved = args; return new Promise(r => { resolveSave = r; }); } };
  await act(async () => { view = create(React.createElement(SalaryPanel, changed)); });
  const save = button(view, '儲存').props.onClick;
  let pending;
  act(() => { pending = save(); save(); });
  assert.equal(calls, 1); assert.equal(saved[2].workHours, null); assert.equal(saved[2].otHours, null);
  assert.equal(view.root.findByType('fieldset').props.disabled, true);
  await act(async () => { resolveSave(); await pending; });
  // 報表改在頁內全螢幕覆蓋層（iframe srcdoc）顯示，避免手機 Safari 開新分頁後無法返回
  const el = () => ({ style: {}, append() {}, remove() {}, set srcdoc(v) { html = v; } });
  global.document = { createElement: el, body: { style: {}, appendChild() {} } };
  act(() => button(view, '列印總表').props.onClick());
  assert.match(html, /<th>工作時數<\/th><td>8<\/td>/);
  assert.match(html, /<th>加班時數<\/th><td>2<\/td>/);
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  URL.createObjectURL = blob => { csvBlob = blob; return 'blob:test'; }; URL.revokeObjectURL = () => {};
  global.document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {}, removeChild() {} } };
  try { act(() => button(view, '匯出總表').props.onClick()); assert.match(await csvBlob.text(), /1,Test,,8,200,2,300/); }
  finally { URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; await act(async () => view.unmount()); }
});

test('薪資寫入成功前不報成功，失敗不覆蓋原資料，可重試', async () => {
  let resolveWrite, rejectWrite, view;
  global.window = { storage: {
    getAll: async () => ({ employees: JSON.stringify([emp]), punches: '[]', holidays: '{}', companyLocation: null, otMultiplier: '2', salary: JSON.stringify(salary), declaration: '{}', salaryVisible: null }),
    get: async () => ({ value: JSON.stringify({ id: 'admin', type: 'admin', token: 'fixture-token' }) }),
    setAdminToken() {}, adminLogout: async () => {},
    set: () => new Promise((res, rej) => { resolveWrite = res; rejectWrite = rej; }),
  } };
  await act(async () => { view = create(React.createElement(App)); });
  const admin = () => view.root.find(n => typeof n.type === 'function' && n.type.name === 'AdminView');
  let pending;
  act(() => { pending = admin().props.onSaveSalary(emp.id, ym, { workHours: null, specialBonus: 888 }, {}); });
  assert.equal(admin().props.salary.test[ym].specialBonus, 500);
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /已儲存薪資/);
  await act(async () => { rejectWrite(new Error('offline')); await pending; });
  assert.equal(admin().props.salary.test[ym].specialBonus, 500);
  assert.match(JSON.stringify(view.toJSON()), /薪資儲存失敗/);
  act(() => { pending = admin().props.onSaveSalary(emp.id, ym, { workHours: null, specialBonus: 888 }, {}); });
  await act(async () => { resolveWrite(); await pending; });
  assert.equal(admin().props.salary.test[ym].specialBonus, 888);
  assert.match(JSON.stringify(view.toJSON()), /已儲存薪資/);
  await act(async () => view.unmount());
});

test('申報：月薪人員固定月休 8 天、連續上班不超過 6 天，有洗車獎金且職務加級 5000', async () => {
  const { buildMonthlySchedule, buildDeclarationSnapshot } = await import(pathToFileURL(generated));
  for (const dim of [28, 29, 30, 31]) {
    for (const realDays of [[], [21, 23, 24, 25, 26, 27, 29, 30, 31].filter(d => d <= dim), Array.from({ length: dim }, (_, i) => i + 1)]) {
      const days = buildMonthlySchedule(realDays.map(day => ({ day })), dim, 8, 6);
      assert.equal(dim - days.length, 8, `${dim} 天月份應休 8 天`);
      let run = 0;
      for (let d = 1; d <= dim; d++) { run = days.includes(d) ? run + 1 : 0; assert.ok(run <= 6, `${dim} 天月份第 ${d} 天連上 ${run} 天`); }
    }
  }
  const chief = { id: 'c1', name: 'Chief', status: 'active' };
  const rows = [21, 23, 24].flatMap(d => [
    { id: `${d}i`, employeeId: 'c1', type: 'in', ts: new Date(2026, 6, d, 8).getTime() },
    { id: `${d}o`, employeeId: 'c1', type: 'out', ts: new Date(2026, 6, d, 18).getTime() },
  ]);
  const snap = buildDeclarationSnapshot([chief], { c1: { defaults: { position: '月薪', hourlyRate: 30000 } } }, rows, 2026, 7, 2, {});
  const r = snap.emps.c1;
  assert.equal(r.chief, true);
  assert.equal(r.days.length, 31 - 8);
  assert.ok(r.rec.carWash >= 600 && r.rec.carWash <= 1000);
  assert.equal(r.rec.dutyAllowance, 5000);
  assert.equal(r.days.find(d => d.day === 21).in, '08:00'); // 有真實打卡的日子用真實時間
});
