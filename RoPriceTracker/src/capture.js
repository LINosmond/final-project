// 擷取模式：在你自己的電腦跑一次，登入後查一個商品，把「真實頁面」存下來。
// 用法：  npm run capture -- 商品名稱
// 例如：  npm run capture -- 藍色寶石
//
// 跑完會在專案資料夾產生：
//   capture.html   ← 查詢結果頁的原始 HTML
//   capture.png    ← 整頁截圖
//   capture.json   ← 攔截到的 API 回應 + 程式目前解析出來的結果
// 把這幾個檔案（尤其 capture.json）貼給我，我就能把爬蟲欄位對準。
import fs from 'node:fs';
import path from 'node:path';
import { captureRun } from './scraper.js';
import { config, ROOT } from './config.js';

const itemName = process.argv.slice(2).join(' ').trim() || '蘋果';

async function main() {
  console.log(`\n開始擷取：查詢「${itemName}」…`);
  console.log('（請先在 App 網頁上「登入 gnjoy」一次，擷取才查得到結果）');
  console.log(`（HEADLESS=${config.headless}；除錯想看畫面可在 .env 設 HEADLESS=false）\n`);

  const { html, png, result, responses, url } = await captureRun(itemName, {});

  fs.writeFileSync(path.join(ROOT, 'capture.html'), html, 'utf8');
  if (png) fs.writeFileSync(path.join(ROOT, 'capture.png'), png);
  fs.writeFileSync(
    path.join(ROOT, 'capture.json'),
    JSON.stringify({ url, item: itemName, result, responses }, null, 2),
    'utf8'
  );

  console.log('完成！已產生：');
  console.log('  capture.html');
  if (png) console.log('  capture.png');
  console.log('  capture.json');
  console.log(`\n目前程式解析到 ${result.listings?.length || 0} 筆結構化資料、` +
    `${result.rawRows?.length || 0} 列表格、攔截到 ${responses.length} 個 JSON 回應。`);
  console.log('把 capture.json（如果放心的話連同 capture.png）貼給我，我幫你把欄位對準。\n');
}

main().catch((err) => {
  console.error('\n擷取失敗：', err.message || err);
  console.error('常見原因：帳密沒填對、需要先改 .env、或頁面有驗證碼。');
  process.exit(1);
});
