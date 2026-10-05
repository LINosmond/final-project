import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { SNAPSHOT_KEY, SNAPSHOT_TTL_MS, readAdminSnapshot, writeAdminSnapshot, clearAdminSnapshot } from '../src/startupSnapshot.js';

const token = 'fixture-admin-token';
const data = {
  employees: [{ id: 'fixture', name: 'Fixture', status: 'active', phone: 'private-phone', extraSecret: 'private-extra' }],
  punches: [{ id: 'p1', employeeId: 'fixture', employeeName: 'Fixture', type: 'in', ts: 1000, privateNote: 'private-note' }],
  holidays: {}, otMultiplier: 2, salary: 'private-salary', declaration: 'private-declaration', companyLocation: 'private-location',
};
function store() {
  const map = new Map();
  return { getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v), removeItem: k => map.delete(k) };
}

test('preview contains only attendance and never credentials, payroll or phones', async () => {
  const storage = store();
  await writeAdminSnapshot(storage, webcrypto, token, data);
  const raw = storage.getItem(SNAPSHOT_KEY);
  assert.ok(raw);
  for (const secret of [token, 'private-phone', 'private-extra', 'private-note', 'private-salary', 'private-declaration', 'private-location']) assert.ok(!raw.includes(secret));
  const preview = await readAdminSnapshot(storage, webcrypto, token);
  assert.equal(preview.data.punches.length, 1);
  assert.equal(preview.data.employees[0].phone, undefined);
});

test('preview is rejected for another admin session, expiry, corrupt data and denied storage', async () => {
  const storage = store();
  await writeAdminSnapshot(storage, webcrypto, token, data);
  assert.equal(await readAdminSnapshot(storage, webcrypto, 'other-token'), null);
  const saved = JSON.parse(storage.getItem(SNAPSHOT_KEY));
  assert.equal(await readAdminSnapshot(storage, webcrypto, token, saved.at + SNAPSHOT_TTL_MS + 1), null);
  saved.data.punches = [{ id: 'invalid' }]; storage.setItem(SNAPSHOT_KEY, JSON.stringify(saved));
  assert.equal(await readAdminSnapshot(storage, webcrypto, token), null);
  storage.setItem(SNAPSHOT_KEY, '{broken');
  assert.equal(await readAdminSnapshot(storage, webcrypto, token), null);
  assert.equal(await readAdminSnapshot({ getItem() { throw Error('denied'); } }, webcrypto, token), null);
});

test('logout clears previews and an async save from the old account cannot restore them', async () => {
  const storage = store();
  await writeAdminSnapshot(storage, webcrypto, token, data);
  const pending = writeAdminSnapshot(storage, webcrypto, token, data, () => false);
  clearAdminSnapshot(storage);
  await pending;
  assert.equal(storage.getItem(SNAPSHOT_KEY), null);
});
