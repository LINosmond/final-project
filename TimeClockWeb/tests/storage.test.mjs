import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../google-apps-script/Code.gs', import.meta.url), 'utf8');
function backend() {
  const kv = new Map(); let punches = [], releases = 0;
  const ctx = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'fixture-key' }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() { releases++; } }) },
    Utilities: { getUuid: () => 'fixture-id' },
  });
  vm.runInContext(source, ctx);
  ctx.getSheet_ = () => ({});
  ctx.migratePunchesIfNeeded_ = () => {};
  ctx.readValue_ = (_, key) => kv.get(key) ?? null;
  ctx.writeValue_ = (_, key, value) => kv.set(key, value);
  ctx.readPunches_ = () => structuredClone(punches);
  ctx.writePunches_ = rows => { punches = structuredClone(rows); };
  ctx.getPunchSheet_ = () => ({ getLastRow: () => punches.length + 1, getRange: () => ({ setNumberFormat() { return this; }, setValues(rows) { for (const r of rows) punches.push({ id: r[0], employeeId: r[1], employeeName: r[2], type: r[3], ts: Number(r[4]), actualTs: Number(r[5]) }); } }) });
  ctx.jsonResponse_ = obj => JSON.parse(JSON.stringify(obj));
  return { call: body => ctx.doPost({ postData: { contents: JSON.stringify({ apiKey: 'fixture-key', ...body }) } }), kv, releases: () => releases };
}

test('後端：重試同筆打卡不重複，其他員工同時打卡保留', () => {
  const b = backend();
  const entry = { id: 'p1', employeeId: 'e1', employeeName: 'Fixture', type: 'in', ts: 1000, actualTs: 1200 };
  assert.equal(b.call({ action: 'appendPunch', entry }).punches.length, 1);
  assert.equal(b.call({ action: 'appendPunch', entry }).punches.length, 1);
  const result = b.call({ action: 'appendPunch', entry: { ...entry, id: 'p2', employeeId: 'e2' } });
  assert.equal(result.punches.length, 2); assert.equal(result.punches[0].actualTs, 1200);
  assert.equal(b.releases(), 3);
});

test('後端：薪資 null 工時與固定設定完整往返；備份格式不變', () => {
  const b = backend();
  const value = JSON.stringify({ e1: { defaults: { hourlyRate: 200 }, '2026-09': { workHours: null, otHours: null, specialBonus: 500 } } });
  assert.equal(b.call({ action: 'set', key: 'salary', value }).ok, true);
  assert.equal(b.call({ action: 'get', key: 'salary' }).value, value);
  const records = [{ id: 'p1', employeeId: 'e1', type: 'in', ts: 1000 }];
  b.call({ action: 'set', key: 'punches', value: JSON.stringify(records) });
  assert.deepEqual(JSON.parse(b.call({ action: 'get', key: 'punches' }).value), records);
});

test('後端：新帳號待審核，審核通過；錯誤 API key 不寫入', () => {
  const b = backend();
  const result = b.call({ action: 'findOrCreateEmployee', name: 'Fixture', phone: '00000000' });
  assert.equal(result.employee.status, 'pending');
  const approved = b.call({ action: 'reviewEmployee', id: result.employee.id, decision: 'approve' });
  assert.equal(approved.employees[0].status, 'active');
  const denied = b.call({ action: 'set', key: 'salary', value: '{}', apiKey: 'wrong' });
  assert.equal(denied.ok, false); assert.equal(b.kv.has('salary'), false);
});
