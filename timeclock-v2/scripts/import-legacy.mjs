// 從命令列匯入舊版（TimeClockWeb / Google 試算表版）備份檔到某家公司。用法：
//   npm run import-legacy -- --code mystore --file ./打卡系統備份_2026-01-01.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../server/db.js";
import { hashPassword } from "../server/auth.js";
import { importLegacy } from "../server/services.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] ?? ""]); return acc; }, []));
if (!args.code || !args.file) { console.error("用法：--code 公司代碼 --file 備份檔.json"); process.exit(1); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = openDb(path.join(path.resolve(root, process.env.DATA_DIR || "./data"), "timeclock.sqlite"));
try {
  const company = db.prepare("SELECT * FROM companies WHERE code = ?").get(String(args.code).toLowerCase());
  if (!company) throw new Error("找不到公司代碼 " + args.code);
  const data = JSON.parse(fs.readFileSync(path.resolve(args.file), "utf8"));
  const admin = db.prepare("SELECT id FROM users WHERE company_id = ? AND role = 'admin' ORDER BY created_at LIMIT 1").get(company.id);
  const r = importLegacy(db, company, admin?.id || null, data, hashPassword);
  console.log(`匯入完成：新增員工 ${r.employeesAdded}（已存在 ${r.employeesMatched}）、打卡 ${r.punchesAdded} 筆（略過 ${r.punchesSkipped}）、假日設定 ${r.holidays} 筆`);
  console.log("員工帳號＝手機號碼、初始密碼＝手機號碼，請提醒員工登入後更改。");
} catch (e) { console.error("匯入失敗：" + e.message); process.exit(1); } finally { db.close(); }
