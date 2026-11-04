// 網頁 App 列印：報表壓縮進網址再交給 Safari，解回來要一字不差，且加上列印按鈕。
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeReport, decodeReport, withPrintBar } from '../src/printLink.js';

test('報表網址：壓縮後解回來一字不差，網址只用安全字元', async () => {
  const html = '<!doctype html><html><head><style>@page{size:A4}</style></head><body>' + '薪資總表 許嘉晏 37438.5 '.repeat(500) + '</body></html>';
  const data = await encodeReport(html);
  assert.match(data, /^[A-Za-z0-9_-]+$/);
  assert.ok(data.length < html.length / 3, `壓縮後 ${data.length} 字`);
  assert.equal(await decodeReport(data), html);
});

test('報表網址：在 body 開頭加上列印按鈕，列印時隱藏', () => {
  const out = withPrintBar('<html><body class="x"><p>表</p></body></html>');
  assert.ok(out.startsWith('<html><body class="x"><style>@media print{.tc-safari-bar'));
  assert.ok(out.includes('window.print()') && out.endsWith('<p>表</p></body></html>'));
});
