import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppsScriptBridge } from '../src/appsScriptBridge.js';

function fixture() {
  const listeners = new Map(), frames = [], sent = [];
  const win = {
    location: { origin: 'https://linosmond.github.io' },
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    setTimeout, clearTimeout,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
  };
  const doc = { createElement: () => ({ remove() {} }), body: { appendChild: frame => frames.push(frame) } };
  const google = { postMessage: (packet, origin) => sent.push({ packet, origin }) };
  const origin = 'https://n-fixture-script.googleusercontent.com';
  const bridge = createAppsScriptBridge({ apiUrl: 'https://script.google.com/macros/s/fixture/exec', window: win, document: doc, readyTimeoutMs: 1000 });
  function emit(packet, overrides = {}) {
    listeners.get('message')?.({ data: { channel: 'timeclock-api-v1', bridgeId: win.crypto.randomUUID(), ...packet }, source: google, origin, ...overrides });
  }
  const ready = () => emit({ type: 'ready' });
  return { bridge, frames, sent, emit, ready, google, origin };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('bridge shares its frame, correlates replies and never puts credentials into URLs', async () => {
  const f = fixture();
  try {
    const a = f.bridge.request({ action: 'getAll', adminToken: 'fixture-token' });
    const b = f.bridge.request({ action: 'adminLogin', adminPassword: 'fixture-password' });
    assert.equal(f.frames.length, 1);
    assert.doesNotMatch(f.frames[0].src, /fixture-token|fixture-password/);
    f.ready(); await tick();
    assert.equal(f.sent.length, 2);
    assert.ok(f.sent.every(message => message.origin === f.origin));
    f.emit({ type: 'result', requestId: '2', data: { ok: true, token: 'result-token' } });
    f.emit({ type: 'result', requestId: '1', data: { ok: true, values: { employees: '[]' } } });
    assert.equal((await b).token, 'result-token');
    assert.equal((await a).values.employees, '[]');
  } finally { f.bridge.dispose(); }
});

test('bridge rejects forged readiness and replies from unrelated windows', async () => {
  const f = fixture();
  try {
    const a = f.bridge.request({ action: 'get' });
    f.emit({ type: 'ready' }, { origin: 'https://evil.example' }); await tick();
    assert.equal(f.sent.length, 0);
    f.ready(); await tick();
    let settled = false; a.then(() => { settled = true; });
    f.emit({ type: 'result', requestId: '1', data: { ok: true, value: 'forged' } }, { source: {} });
    f.emit({ type: 'result', requestId: '1', data: { ok: true, value: 'forged' } }, { origin: 'https://evil.example' });
    await tick(); assert.equal(settled, false);
    f.emit({ type: 'result', requestId: '1', data: { ok: true, value: 'actual' } });
    assert.equal((await a).value, 'actual');
  } finally { f.bridge.dispose(); }
});

test('aborting a cold bridge never sends a delayed mutation after its deadline', async () => {
  const f = fixture();
  try {
    const controller = new AbortController();
    const a = f.bridge.request({ action: 'set', key: 'salary' }, controller.signal);
    controller.abort();
    await assert.rejects(a, { code: 'TIMEOUT' });
    f.ready(); await tick();
    assert.equal(f.sent.length, 0);
  } finally { f.bridge.dispose(); }
});

test('aborted requests ignore late replies and a subsequent request can still finish', async () => {
  const f = fixture();
  try {
    const controller = new AbortController();
    const a = f.bridge.request({ action: 'get' }, controller.signal);
    f.ready(); await tick(); controller.abort();
    await assert.rejects(a, { code: 'TIMEOUT' });
    f.emit({ type: 'result', requestId: '1', data: { ok: true, value: 'late' } });
    const b = f.bridge.request({ action: 'get' }); await tick();
    f.emit({ type: 'result', requestId: '2', data: { ok: true, value: 'new' } });
    assert.equal((await b).value, 'new');
  } finally { f.bridge.dispose(); }
});
