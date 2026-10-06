import { test } from "node:test";
import assert from "node:assert/strict";
import { createPunchQueue } from "../web/src/punchQueue.js";
import { normalizeRules } from "../shared/attendance.js";

function memStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; }
const err = (status) => Object.assign(new Error("x"), { status });

test("佇列：斷線保留並重送，成功後清除", async () => {
  let fail = true, calls = 0;
  const q = createPunchQueue({ storage: memStorage(), post: async () => { calls++; if (fail) throw err(0); return { state: { nextType: "out" } }; } });
  q.save("u1", { type: "in", ts: 1, clientId: "abcdefgh" });
  const r1 = await q.flush("u1");
  assert.deepEqual([r1.ok, r1.retry], [false, true]);
  assert.ok(q.load("u1"));
  fail = false;
  const r2 = await q.flush("u1");
  assert.equal(r2.ok, true);
  assert.equal(q.load("u1"), null);
  assert.equal(calls, 2);
});

test("佇列：伺服器明確拒絕就不再重送；別人的、過期的不送", async () => {
  const q = createPunchQueue({ storage: memStorage(), post: async () => { throw err(409); } });
  q.save("u1", { type: "in", ts: 1, clientId: "abcdefgh" });
  const r = await q.flush("u1");
  assert.deepEqual([r.ok, r.retry], [false, false]);
  assert.equal(q.load("u1"), null);

  const s = memStorage();
  const q2 = createPunchQueue({ storage: s, post: async () => ({}) });
  q2.save("u1", { type: "in", ts: 1, clientId: "abcdefgh" });
  assert.equal(q2.load("u2"), null);          // 換人登入，丟棄
  assert.equal(await q2.flush("u2"), null);

  let t = 0;
  const q3 = createPunchQueue({ storage: memStorage(), post: async () => ({}), now: () => t });
  q3.save("u1", { type: "in", ts: 1, clientId: "abcdefgh" });
  t = 13 * 3600 * 1000;
  assert.equal(q3.load("u1"), null);          // 超過 12 小時，丟棄
});

test("規則：punchMode 預設 slot，只接受 exact", () => {
  assert.equal(normalizeRules({}).punchMode, "slot");
  assert.equal(normalizeRules({ punchMode: "exact" }).punchMode, "exact");
  assert.equal(normalizeRules({ punchMode: "whatever" }).punchMode, "slot");
});
