import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import React from 'react';
import { create, act } from 'react-test-renderer';

// Compile the real component in memory; tests never contact the live backend.
const source = await fs.readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'App.jsx', {
  loader: 'jsx', jsx: 'transform', format: 'cjs',
});
const require = createRequire(import.meta.url);
const employee = { id: 'fixture-employee', name: 'Fixture Employee', phone: '00000000', status: 'active' };
const savedEmployee = { id: employee.id, type: 'employee' };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const fixtureData = (employees = [employee]) => ({
  employees: employees === null ? null : JSON.stringify(employees),
  punches: '[]', holidays: '{}', companyLocation: null, otMultiplier: '2',
  salary: '{}', declaration: '{}',
});

async function mountApp(t, { session = savedEmployee, data = fixtureData(), responses = [], visibility = 'visible' } = {}) {
  let storedSession = session === null ? null : JSON.stringify(session);
  let view, nextTimer = 0, visibilityState = visibility;
  const intervals = new Map(), timeouts = new Map(), listeners = new Map();
  const state = {
    data, failReads: false, failSessionSave: false, reviewError: null,
    calls: [], writes: [], reviews: [], sessionReads: 0, active: 0, maxActive: 0, responses: [...responses],
  };
  const storage = {
    async getAll(keys) {
      state.calls.push({ action: 'getAll', keys: [...keys] });
      state.active++;
      state.maxActive = Math.max(state.maxActive, state.active);
      try {
        if (state.failReads) throw new Error('Fixture network unavailable');
        const result = state.responses.length ? await state.responses.shift() : state.data;
        return Object.fromEntries(keys.map(key => [key, result[key] ?? null]));
      } finally { state.active--; }
    },
    async get(key, shared) {
      if (!shared) {
        assert.equal(key, 'session');
        state.sessionReads++;
        return storedSession === null ? null : { value: storedSession };
      }
      state.calls.push({ action: 'get', keys: [key] });
      if (state.failReads) throw new Error('Fixture network unavailable');
      return state.data[key] == null ? null : { value: state.data[key] };
    },
    async set(key, value, shared) {
      state.writes.push({ key, shared });
      if (!shared && key === 'session') {
        if (state.failSessionSave) throw new Error('Fixture storage unavailable');
        storedSession = value;
      } else throw new Error('Unexpected fixture write');
    },
    async delete(key, shared) {
      assert.equal(key, 'session');
      assert.equal(shared, false);
      storedSession = null;
    },
    async findOrCreateEmployee(name, phone) {
      assert.equal(name, employee.name);
      assert.equal(phone, employee.phone);
      return { employee, created: false, employees: JSON.parse(state.data.employees) };
    },
    setAdminToken(token) { state.adminToken = token; },
    async adminLogout() { state.adminToken = ''; },
    async reviewEmployee(id, decision) {
      state.reviews.push({ id, decision });
      if (state.reviewError) throw state.reviewError;
      throw new Error('Unexpected fixture review');
    },
  };
  const eventTarget = {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
  };
  const document = {
    ...eventTarget,
    get visibilityState() { return visibilityState; },
    get hidden() { return visibilityState === 'hidden'; },
  };
  const module = { exports: {} };
  const context = vm.createContext({
    require, module, exports: module.exports, console,
    window: { storage, ...eventTarget }, document,
    setInterval(callback, ms) { const id = ++nextTimer; intervals.set(id, { callback, ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(callback, ms) { const id = ++nextTimer; timeouts.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
  });
  vm.runInContext(code, context, { filename: 'App.fixture.cjs' });
  await act(async () => { view = create(React.createElement(module.exports.default)); });
  t.after(async () => { await act(async () => { view.unmount(); }); });
  const app = {
    state,
    get view() { return view; },
    get storedSession() { return storedSession; },
    has(componentName) { return view.root.findAll(node => typeof node.type === 'function' && node.type.name === componentName).length > 0; },
    text() {
      const visit = node => node == null ? '' : typeof node === 'string' ? node : Array.isArray(node) ? node.map(visit).join(' ') : visit(node.children);
      return visit(view.toJSON());
    },
    async poll() {
      await act(async () => {
        for (const timer of [...intervals.values()]) if (timer.ms !== 1000) timer.callback();
        // One-shot timers disappear before their callback runs. A new timer
        // scheduled after an async refresh belongs to the next simulated tick.
        for (const [id, timer] of [...timeouts]) {
          timeouts.delete(id);
          timer.callback();
        }
      });
    },
    async setVisibility(value) {
      visibilityState = value;
      await act(async () => {
        for (const callback of listeners.get('visibilitychange') || []) callback({ type: 'visibilitychange' });
      });
    },
    async finish(gate, value = state.data) { await act(async () => { gate.resolve(value); }); },
    async logout() {
      const button = view.root.findAllByType('button').find(node => /登出|切換帳號/.test(String(node.props.children)));
      assert.ok(button, 'A signed-in or unresolved account must offer logout/switch-account');
      await act(async () => { await button.props.onClick(); });
    },
    async loginEmployee() {
      await act(async () => {
        view.root.findByProps({ placeholder: '請輸入姓名' }).props.onChange({ target: { value: employee.name } });
        view.root.findByProps({ placeholder: '請輸入手機號碼' }).props.onChange({ target: { value: employee.phone } });
      });
      const button = view.root.findAllByType('button').find(node => node.props.children === '登入');
      assert.ok(button, 'The fixture employee must have a login button');
      await act(async () => { await button.props.onClick(); });
    },
  };
  return app;
}

test('還原已存員工登入後顯示打卡畫面', async t => {
  const app = await mountApp(t);
  assert.equal(app.has('PunchView'), true);
  assert.equal(app.has('LoginView'), false);
  assert.equal(app.state.sessionReads, 1);
});

test('遠端首讀尚未完成時已讀取本機登入，尚未確認身份前不可打卡', async t => {
  const gate = deferred();
  const app = await mountApp(t, { responses: [gate.promise] });
  assert.equal(app.state.sessionReads, 1);
  assert.equal(app.has('LoginView'), false);
  assert.equal(app.has('PunchView'), false);
  await app.finish(gate);
  assert.equal(app.has('PunchView'), true);
});

for (const empty of [[], null]) {
  test(`首次員工名單 ${JSON.stringify(empty)} 不放棄登入，正確名單到達後自動恢復`, async t => {
    const app = await mountApp(t, { data: fixtureData(empty) });
    assert.equal(app.has('LoginView'), false);
    assert.equal(app.has('PunchView'), false);
    assert.match(app.text(), /正在確認登入帳號/);
    assert.deepEqual(JSON.parse(app.storedSession), savedEmployee);
    app.state.data = fixtureData();
    await app.poll();
    assert.equal(app.has('PunchView'), true);
    assert.equal(app.has('LoginView'), false);
    assert.equal(app.state.sessionReads, 1);
  });
}

test('輪詢名單缺少目前員工時保持待確認，沒有可操作打卡畫面', async t => {
  const app = await mountApp(t);
  app.state.data = fixtureData([{ id: 'fixture-other', name: 'Other Fixture', status: 'active' }]);
  await app.poll();
  assert.equal(app.has('LoginView'), false);
  assert.equal(app.has('PunchView'), false);
  assert.match(app.text(), /正在確認登入帳號/);
  assert.deepEqual(JSON.parse(app.storedSession), savedEmployee);
  app.state.data = fixtureData();
  await app.poll();
  assert.equal(app.has('PunchView'), true);
});

test('主動登出後，遲到同步及之後輪詢不得恢復登入', async t => {
  const app = await mountApp(t);
  const gate = deferred();
  app.state.responses.push(gate.promise);
  await app.poll();
  assert.equal(app.state.active, 1);
  await app.logout();
  assert.equal(app.storedSession, null);
  await app.finish(gate);
  await app.poll();
  assert.equal(app.has('LoginView'), true);
  assert.equal(app.has('PunchView'), false);
  assert.equal(app.storedSession, null);
});

test('待確認帳號可切換帳號，正確名單之後到達也不自動登入', async t => {
  const app = await mountApp(t, { data: fixtureData([]) });
  assert.equal(app.has('PunchView'), false);
  await app.logout();
  app.state.data = fixtureData();
  await app.poll();
  assert.equal(app.has('LoginView'), true);
  assert.equal(app.has('PunchView'), false);
  assert.equal(app.storedSession, null);
});

test('慢同步未完成時，多次 timer 與前景事件不疊加請求', async t => {
  const app = await mountApp(t);
  const gate = deferred();
  app.state.responses.push(gate.promise);
  const before = app.state.calls.length;
  await app.poll();
  for (let i = 0; i < 4; i++) await app.poll();
  await app.setVisibility('visible');
  assert.equal(app.state.calls.length, before + 1);
  assert.equal(app.state.active, 1);
  assert.equal(app.state.maxActive, 1);
  await app.finish(gate);
  await app.poll();
  assert.equal(app.state.calls.length, before + 2);
  assert.equal(app.state.maxActive, 1);
});

test('頁面在背景時暫停同步，回到前景立即刷新', async t => {
  const app = await mountApp(t);
  await app.setVisibility('hidden');
  const before = app.state.calls.length;
  await app.poll();
  await app.poll();
  assert.equal(app.state.calls.length, before);
  await app.setVisibility('visible');
  assert.equal(app.state.calls.length, before + 1);
});

test('尚未登入只載入員工名單；員工同步不下載薪資及申報', async t => {
  const signedOut = await mountApp(t, { session: null });
  assert.equal(signedOut.has('LoginView'), true);
  assert.ok(signedOut.state.calls.length > 0);
  for (const call of signedOut.state.calls) assert.deepEqual(call.keys, ['employees']);
  const signedIn = await mountApp(t);
  await signedIn.poll();
  const allKeys = new Set(signedIn.state.calls.flatMap(call => call.keys));
  for (const key of ['employees', 'punches', 'holidays', 'companyLocation', 'otMultiplier']) assert.ok(allKeys.has(key));
  assert.equal(allKeys.has('salary'), false);
  assert.equal(allKeys.has('declaration'), false);
});

test('管理員同步仍載入薪資及申報資料', async t => {
  const app = await mountApp(t, { session: { id: 'admin', type: 'admin', token: 'fixture-token' } });
  assert.equal(app.has('AdminView'), true);
  const allKeys = new Set(app.state.calls.flatMap(call => call.keys));
  assert.ok(allKeys.has('salary'));
  assert.ok(allKeys.has('declaration'));
});

test('暫時同步失敗保留已確認帳號與打卡畫面', async t => {
  const app = await mountApp(t);
  app.state.failReads = true;
  await app.poll();
  assert.equal(app.has('PunchView'), true);
  assert.equal(app.has('LoginView'), false);
  assert.deepEqual(JSON.parse(app.storedSession), savedEmployee);
});

test('審核逾時且結果不明時不整包覆寫員工，也不顯示成功', async t => {
  const pending = { id: 'fixture-pending', name: 'Pending Fixture', phone: '00000001', status: 'pending' };
  const app = await mountApp(t, { session: { id: 'admin', type: 'admin', token: 'fixture-token' }, data: fixtureData([employee, pending]) });
  app.state.reviewError = Object.assign(new Error('Fixture review timeout'), { code: 'TIMEOUT', resultUnknown: true });
  const staff = app.view.root.findAllByType('button').find(node => String(node.props.children).includes('員工管理'));
  assert.ok(staff);
  await act(async () => { staff.props.onClick(); });
  const approve = app.view.root.findAllByType('button').find(node => node.props.children === '通過');
  assert.ok(approve);
  await act(async () => { await approve.props.onClick(); });
  assert.deepEqual(app.state.reviews, [{ id: pending.id, decision: 'approve' }]);
  assert.deepEqual(app.state.writes, []);
  assert.match(app.text(), /審核結果尚未確認/);
  assert.doesNotMatch(app.text(), /已通過「|已拒絕「/);
  assert.equal(app.view.root.findAllByType('button').filter(node => node.props.children === '通過').length, 1);
});

test('本機登入保存失敗仍可登入，保存失敗提示不被歡迎訊息或通知消失覆蓋', async t => {
  const app = await mountApp(t, { session: null });
  app.state.failSessionSave = true;
  await app.loginEmployee();
  assert.equal(app.has('PunchView'), true);
  assert.equal(app.storedSession, null);
  assert.match(app.text(), /歡迎回來/);
  assert.match(app.text(), /此裝置無法保存登入/);
  await app.poll(); // Includes the welcome toast expiry and the next sync.
  assert.doesNotMatch(app.text(), /歡迎回來/);
  assert.match(app.text(), /此裝置無法保存登入/);
  assert.equal(app.has('PunchView'), true);
});

test('管理員慢讀期間切換員工，舊請求完成後立即讀新身分資料，不等待下一輪 timer', async t => {
  const app = await mountApp(t, { session: { id: 'admin', type: 'admin', token: 'fixture-token' } });
  const gate = deferred();
  app.state.responses.push(gate.promise);
  const before = app.state.calls.length;
  await app.poll();
  assert.ok(app.state.calls.at(-1).keys.includes('salary'));
  await app.logout();
  await app.loginEmployee();
  assert.equal(app.state.calls.length, before + 1);
  assert.equal(app.state.active, 1);
  assert.equal(app.has('PunchView'), false);
  await app.finish(gate); // Do not fire a timer or visibility event after this.
  assert.equal(app.state.calls.length, before + 2);
  const newKeys = app.state.calls.at(-1).keys;
  assert.ok(newKeys.includes('punches'));
  assert.equal(newKeys.includes('salary'), false);
  assert.equal(newKeys.includes('declaration'), false);
  assert.equal(app.state.maxActive, 1);
  assert.equal(app.has('PunchView'), true);
});
