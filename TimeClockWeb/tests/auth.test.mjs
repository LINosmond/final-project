// 後端權限控管：員工查薪資只能看自己、開關關閉時後端擋、管理員憑證不受他人猜錯鎖定。
// 以模擬的 Google Apps Script 環境執行 Code.gs，不連真正的試算表。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../google-apps-script/Code.gs', import.meta.url), 'utf8');
const ADMIN_PW = '999888';
const A = { adminPassword: ADMIN_PW };
const emps = [
  { id: 'e1', name: '甲', phone: '11111111', status: 'active' },
  { id: 'e2', name: '乙', phone: '22222222', status: 'active' },
];

function backend() {
  const kv = new Map(), props = { ADMIN_PASSWORD: ADMIN_PW }, cache = {};
  let n = 0;
  const ctx = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; },
    }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => `uuid-${++n}-${Math.random()}`, formatDate: () => '2026-10' },
  });
  vm.runInContext(source, ctx);
  ctx.getSheet_ = () => ({ getDataRange: () => ({ getValues: () => [['key', 'value'], ...[...kv].map(([k, v]) => [k, v])] }) });
  ctx.migratePunchesIfNeeded_ = () => {};
  ctx.readPunches_ = () => [];
  ctx.readValue_ = (_, key) => kv.get(key) ?? null;
  ctx.writeValue_ = (_, key, value) => kv.set(key, value);
  ctx.jsonResponse_ = obj => JSON.parse(JSON.stringify(obj));
  const call = body => ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  return { call, props, cache, kv };
}

function seeded() {
  const b = backend();
  b.call({ action: 'set', key: 'employees', value: JSON.stringify(emps), ...A });
  b.call({ action: 'set', key: 'salary', value: '{"e2":{"x":1}}', ...A });
  b.call({ action: 'set', key: 'salaryPublished', value: JSON.stringify({ '2026-09': { e1: { netRounded: 111 }, e2: { netRounded: 222 } } }), ...A });
  return b;
}

test('非管理員不能寫入、審核，讀不到薪資與手機號碼', () => {
  const b = seeded();
  assert.equal(b.call({ action: 'set', key: 'employees', value: '[]' }).ok, false);
  assert.equal(b.call({ action: 'reviewEmployee', id: 'e1', decision: 'reject' }).ok, false);
  const r = b.call({ action: 'getAll', keys: ['salary', 'salaryPublished', 'employees'] });
  assert.equal(r.values.salary, null);
  assert.equal(r.values.salaryPublished, null);
  assert.doesNotMatch(r.values.employees, /phone|11111111/);
  assert.equal(b.call({ action: 'get', key: 'salary' }).value, null);
  const admin = b.call({ action: 'getAll', keys: ['salary', 'employees'], ...A });
  assert.ok(admin.values.salary);
  assert.match(admin.values.employees, /11111111/);
});

test('開關關閉時後端拒絕；非管理員不能開啟開關', () => {
  const b = seeded();
  assert.equal(b.call({ action: 'getMySalary', name: '甲', phone: '11111111' }).error, 'disabled');
  b.call({ action: 'set', key: 'salaryVisible', value: 'true' });
  assert.notEqual(b.kv.get('salaryVisible'), 'true');
});

test('員工只能拿到自己的薪資，傳別人的 ID 或用別人的手機都無效', () => {
  const b = seeded();
  b.call({ action: 'set', key: 'salaryVisible', value: 'true', ...A });
  const mine = b.call({ action: 'getMySalary', name: '甲', phone: '11111111', id: 'e2', employeeId: 'e2' });
  assert.equal(mine.ok, true);
  assert.equal(mine.record.netRounded, 111);
  assert.equal(b.call({ action: 'getMySalary', name: '甲', phone: '22222222' }).ok, false);
});

test('登入時密碼錯誤不洩漏手機；連續猜錯會鎖定', () => {
  const b = seeded();
  b.call({ action: 'set', key: 'salaryVisible', value: 'true', ...A });
  assert.doesNotMatch(JSON.stringify(b.call({ action: 'findOrCreateEmployee', name: '甲', phone: '00000000' })), /11111111/);
  for (let i = 0; i < 11; i++) b.call({ action: 'getMySalary', name: '乙', phone: `bad${i}` });
  assert.equal(b.call({ action: 'getMySalary', name: '乙', phone: '22222222' }).ok, false);
});

test('管理員：未設定密碼時一律拒絕；缺手機的整包寫入會補回原手機', () => {
  const b = seeded();
  b.call({ action: 'set', key: 'employees', value: JSON.stringify([{ id: 'e1', name: '甲', status: 'active' }]), ...A });
  assert.match(b.call({ action: 'getAll', keys: ['employees'], ...A }).values.employees, /11111111/);
  b.props.ADMIN_PASSWORD = '';
  assert.equal(b.call({ action: 'getAll', keys: ['salary'], ...A }).values.salary, null);
});

test('管理員憑證：別人猜錯密碼不影響已登入者；假憑證與登出後憑證無效', () => {
  const b = seeded();
  const tok = b.call({ action: 'adminLogin', ...A }).token;
  assert.ok(typeof tok === 'string' && tok.length > 20);
  assert.equal(b.call({ action: 'adminLogin', adminPassword: 'bad' }).admin, false);
  for (let i = 0; i < 12; i++) b.call({ action: 'adminLogin', adminPassword: `x${i}` });
  assert.notEqual(b.call({ action: 'getAll', keys: ['salary'], adminToken: tok }).values.salary, null);
  assert.equal(b.call({ action: 'getAll', keys: ['salary'], adminToken: 'fake' }).values.salary, null);
  b.call({ action: 'adminLogout', adminToken: tok });
  assert.equal(b.call({ action: 'getAll', keys: ['salary'], adminToken: tok }).values.salary, null);
});
