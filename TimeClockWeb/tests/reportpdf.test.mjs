// 網頁 App 列印改做 PDF：紙張方向、邊界與每頁圖片的擺放。
import test from 'node:test';
import assert from 'node:assert/strict';
import { paperOf, placeOnPaper } from '../src/reportPdf.js';

test('PDF 紙張：讀報表 @page 的方向與邊界', () => {
  assert.deepEqual(paperOf('@page { size: A4 portrait; margin: 6mm; } body{}'), { landscape: false, margin: 6, w: 210, h: 297 });
  assert.deepEqual(paperOf('@page { size: A4 landscape; margin: 8mm; }'), { landscape: true, margin: 8, w: 297, h: 210 });
});

test('PDF 擺放：寬度貼齊可印範圍，太高時等比例縮小並置中', () => {
  const paper = paperOf('@page { size: A4 portrait; margin: 6mm; }');
  const a = placeOnPaper(paper, 1980, 1000);
  assert.equal(a.w, 198); assert.equal(a.x, 6); assert.equal(a.y, 6);
  const b = placeOnPaper(paper, 1000, 5700);
  assert.ok(Math.abs(b.h - 285) < 1e-9 && b.w < 198 && Math.abs(b.x - (210 - b.w) / 2) < 1e-9);
});
