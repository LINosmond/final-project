import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { transformWithEsbuild } from 'vite';

// 照 salary.test.mjs 的方式把 App.jsx 轉成可 import 的模組（用獨立資料夾，避免與其他測試同時寫入衝突）
process.env.TZ = 'Asia/Taipei';
const source = await fs.readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'App.jsx', { loader: 'jsx', jsx: 'transform' });
const dir = resolve('node_modules/.cache/timeclock-test-clockin');
await fs.mkdir(dir, { recursive: true });
await fs.copyFile(new URL('../src/startupSnapshot.js', import.meta.url), resolve(dir, 'startupSnapshot.js'));
await fs.writeFile(resolve(dir, 'App.mjs'), code);
const { canPickEarlierSlot, CLOCK_IN_EARLIER_GRACE_MS } = await import(pathToFileURL(resolve(dir, 'App.mjs')));

const at = (h, m, s = 0, ms = 0) => new Date(2026, 9, 16, h, m, s, ms);
const slot = (h, m) => h * 60 + m;

test('寬限為 6 分鐘', () => {
  assert.equal(CLOCK_IN_EARLIER_GRACE_MS, 6 * 60 * 1000);
});

test('上班：6 分整可選前一個半點，6 分 1 秒不可', () => {
  assert.equal(canPickEarlierSlot('in', at(9, 6, 0), slot(9, 0)), true);
  assert.equal(canPickEarlierSlot('in', at(9, 6, 1), slot(9, 0)), false);
  assert.equal(canPickEarlierSlot('in', at(9, 6, 0, 1), slot(9, 0)), false);
  assert.equal(canPickEarlierSlot('in', at(9, 7), slot(9, 0)), false);
  assert.equal(canPickEarlierSlot('in', at(9, 36), slot(9, 30)), true);
  assert.equal(canPickEarlierSlot('in', at(9, 36, 1), slot(9, 30)), false);
});

test('上班：剛好在半點上維持原本行為，後一個半點永遠可選', () => {
  assert.equal(canPickEarlierSlot('in', at(9, 0), slot(9, 0)), true);
  assert.equal(canPickEarlierSlot('in', at(9, 0), slot(9, 30)), true);
  assert.equal(canPickEarlierSlot('in', at(9, 7), slot(9, 30)), true);
  assert.equal(canPickEarlierSlot('in', at(9, 29, 59), slot(9, 30)), true);
});

test('下班不限制', () => {
  assert.equal(canPickEarlierSlot('out', at(18, 29, 59), slot(18, 0)), true);
  assert.equal(canPickEarlierSlot('out', at(18, 7), slot(18, 0)), true);
  assert.equal(canPickEarlierSlot('out', at(23, 59), slot(23, 30)), true);
});

test('跨午夜：00:00 為前一個半點時照樣適用 6 分鐘', () => {
  assert.equal(canPickEarlierSlot('in', at(0, 0), slot(0, 0)), true);
  assert.equal(canPickEarlierSlot('in', at(0, 6), slot(0, 0)), true);
  assert.equal(canPickEarlierSlot('in', at(0, 6, 1), slot(0, 0)), false);
  assert.equal(canPickEarlierSlot('in', at(0, 7), slot(0, 30)), true);
  // 畫面停在前一天 23:30，過了午夜才按：23:30 視為前一天，已超過 6 分鐘
  assert.equal(canPickEarlierSlot('in', at(0, 5), slot(23, 30)), false);});

test('23:30 邊界：23:30~23:36 照常；之後只剩 23:30 一個選項，維持原本行為可選', () => {
  assert.equal(canPickEarlierSlot('in', at(23, 36), slot(23, 30)), true);
  assert.equal(canPickEarlierSlot('in', at(23, 36, 1), slot(23, 30)), true);
  assert.equal(canPickEarlierSlot('in', at(23, 59, 59), slot(23, 30)), true);
  // 其他半點沒有這個例外
  assert.equal(canPickEarlierSlot('in', at(23, 7), slot(23, 0)), false);
  assert.equal(canPickEarlierSlot('in', at(23, 36, 1), slot(23, 0)), false);
});

test('畫面停留太久：之前選的「後一個半點」變成過去超過 6 分鐘就不可', () => {
  assert.equal(canPickEarlierSlot('in', at(9, 40), slot(9, 30)), false);
  assert.equal(canPickEarlierSlot('in', at(10, 10), slot(9, 30)), false);
});
