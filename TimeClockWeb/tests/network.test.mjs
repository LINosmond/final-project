import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../src/storage.js', import.meta.url), 'utf8');

function client(fetchImpl, { deadlineMs = 1000, url = 'https://fixture.invalid/api' } = {}) {
  const requests = [];
  const delays = [];
  const local = new Map();
  const timers = new Set();
  const context = vm.createContext({
    AbortController,
    window: {
      localStorage: {
        getItem: key => local.get(key) ?? null,
        setItem: (key, value) => local.set(key, value),
        removeItem: key => local.delete(key),
      },
    },
    fetch: async (url, options) => {
      const request = { url, ...options, body: JSON.parse(options.body) };
      requests.push(request);
      return fetchImpl(request, requests.length);
    },
    setTimeout: (callback, milliseconds) => {
      delays.push(milliseconds);
      const timer = setTimeout(() => {
        timers.delete(timer);
        callback();
      }, milliseconds === 20000 ? deadlineMs : 0);
      timers.add(timer);
      return timer;
    },
    clearTimeout: timer => {
      timers.delete(timer);
      clearTimeout(timer);
    },
  });
  vm.runInContext(source
    .replace('import.meta.env.VITE_SHEETS_API_URL', JSON.stringify(url))
    .replace('import.meta.env.VITE_SHEETS_API_KEY', '"fixture-key"')
    .replace('export default storage;', ''), context);
  return { storage: context.window.storage, requests, delays, local, timers };
}

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

test('getAll accepts explicit missing values and rejects incomplete or malformed response data', async () => {
  const valid = client(() => response({ ok: true, values: { employees: '[]', punches: null } }));
  assert.deepEqual(await valid.storage.getAll(['employees', 'punches']), { employees: '[]', punches: null });
  assert.equal(valid.timers.size, 0);
  for (const data of [
    { ok: true },
    { ok: true, values: {} },
    { ok: true, values: [] },
    { ok: true, values: { employees: [] } },
    { ok: true, values: { employees: '[]' } },
    { values: { employees: '[]', punches: '[]' } },
  ]) {
    const c = client(() => response(data));
    await assert.rejects(c.storage.getAll(['employees', 'punches']), { code: 'INVALID_RESPONSE' });
    assert.equal(c.requests.length, 1);
    assert.equal(c.timers.size, 0);
  }
});

test('single-key compatibility reads also reject omitted values instead of inventing empty data', async () => {
  const c = client(() => response({ ok: true }));
  await assert.rejects(c.storage.get('employees', true), { code: 'INVALID_RESPONSE' });
  assert.equal(c.requests.length, 1);
});

test('unsupported actions and permanent server errors fail once with a distinct compatibility code', async () => {
  for (const [error, code] of [
    ['unknown action: getAll', 'UNSUPPORTED_ACTION'],
    ['unauthorized', 'API_ERROR'],
    ['missing key', 'API_ERROR'],
  ]) {
    const c = client(() => response({ ok: false, error }));
    await assert.rejects(c.storage.getAll(['employees']), { code });
    assert.equal(c.requests.length, 1);
  }
  for (const status of [400, 401, 403, 404]) {
    const c = client(() => response({}, status));
    await assert.rejects(c.storage.getAll(['employees']), { code: 'HTTP_ERROR', retryable: false });
    assert.equal(c.requests.length, 1);
  }
});

test('transient network, HTTP and lock failures may retry a read once', async () => {
  for (const firstAttempt of [
    () => { throw new TypeError('fixture network failure'); },
    () => response({}, 408),
    () => response({}, 429),
    () => response({}, 503),
    () => response({ ok: false, error: 'Exception: Lock timeout: another process was holding the lock for too long.' }),
  ]) {
    const c = client((_, attempt) => attempt === 1 ? firstAttempt() : response({ ok: true, values: { employees: '[]' } }));
    assert.deepEqual(await c.storage.getAll(['employees']), { employees: '[]' });
    assert.equal(c.requests.length, 2);
    assert.deepEqual(c.delays, [20000, 600, 20000]);
    assert.equal(c.timers.size, 0);
  }
});

test('persistent transient failure stops after two requests', async () => {
  const c = client(() => response({}, 503));
  await assert.rejects(c.storage.getAll(['employees']), { code: 'HTTP_ERROR' });
  assert.equal(c.requests.length, 2);
  assert.equal(c.timers.size, 0);
});

test('deadline bounds both fetch and response body even when the transport ignores abort', async () => {
  for (const fetchImpl of [
    () => new Promise(() => {}),
    () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }),
  ]) {
    const c = client(fetchImpl, { deadlineMs: 5 });
    await assert.rejects(c.storage.getAll(['employees']), { code: 'TIMEOUT' });
    assert.equal(c.requests.length, 2);
    assert.ok(c.requests.every(request => request.signal.aborted));
    assert.equal(c.timers.size, 0);
  }
});

test('malformed JSON is a permanent response error, not a network retry', async () => {
  const c = client(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('fixture invalid JSON'); } }));
  await assert.rejects(c.storage.getAll(['employees']), { code: 'INVALID_RESPONSE' });
  assert.equal(c.requests.length, 1);
});

test('overwrite, delete and review never replay an uncertain mutation', async () => {
  for (const operation of [
    storage => storage.set('salary', '{}', true),
    storage => storage.delete('salary', true),
    storage => storage.reviewEmployee('fixture-employee', 'approve'),
  ]) {
    const c = client(() => { throw new TypeError('fixture lost response'); });
    await assert.rejects(operation(c.storage), error => {
      assert.equal(error.code, 'NETWORK_ERROR');
      assert.equal(error.resultUnknown, true);
      assert.match(error.message, /重新整理核對/);
      return true;
    });
    assert.equal(c.requests.length, 1);
  }
  const timedOut = client(() => new Promise(() => {}), { deadlineMs: 5 });
  await assert.rejects(timedOut.storage.set('salary', '{}', true), { code: 'TIMEOUT', resultUnknown: true });
  assert.equal(timedOut.requests.length, 1);
});

test('idempotent punch and employee operations reuse the same identity for one retry', async () => {
  const entry = { id: 'fixture-punch', employeeId: 'fixture-employee', type: 'in', ts: 1234 };
  const punches = client((_, attempt) => {
    if (attempt === 1) throw new TypeError('fixture lost response');
    return response({ ok: true, punches: [entry] });
  });
  assert.deepEqual(await punches.storage.appendPunch(entry), [entry]);
  assert.equal(punches.requests.length, 2);
  assert.deepEqual(punches.requests[0].body, punches.requests[1].body);

  const employee = { id: 'fixture-employee', name: 'Fixture' };
  const employees = client((_, attempt) => attempt === 1
    ? response({}, 503)
    : response({ ok: true, employee, created: false, employees: [employee] }));
  assert.equal((await employees.storage.findOrCreateEmployee('Fixture', '00000000')).employee.id, employee.id);
  assert.equal(employees.requests.length, 2);
  assert.deepEqual(employees.requests[0].body, employees.requests[1].body);

  const unsafePunch = client(() => { throw new TypeError('fixture lost response'); });
  await assert.rejects(unsafePunch.storage.appendPunch({ employeeId: 'fixture-employee' }), { resultUnknown: true });
  assert.equal(unsafePunch.requests.length, 1);
});

test('missing API configuration fails locally and remembered login stays local', async () => {
  const c = client(() => { throw new Error('fetch must not run'); }, { url: '' });
  await assert.rejects(c.storage.getAll(['employees']), { code: 'CONFIG_ERROR' });
  const session = JSON.stringify({ id: 'fixture-employee', type: 'employee' });
  await c.storage.set('session', session, false);
  assert.equal((await c.storage.get('session', false)).value, session);
  await c.storage.delete('session', false);
  assert.equal(await c.storage.get('session', false), null);
  assert.equal(c.requests.length, 0);
});
