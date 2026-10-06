// 新增第二家（以上）公司與其管理員。用法：
//   npm run create-company -- --name "店名" --code mystore --admin-name "老闆" --admin-login 0912345678 --admin-password 密碼
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../server/db.js";
import { hashPassword, validPassword } from "../server/auth.js";
import { createCompany } from "../server/services.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] ?? ""]); return acc; }, []));
const required = ["name", "code", "admin-login", "admin-password"];
const missing = required.filter((k) => !args[k]);
if (missing.length) { console.error("缺少參數：" + missing.map((k) => "--" + k).join(" ")); process.exit(1); }
if (!validPassword(args["admin-password"])) { console.error("管理員密碼至少 6 碼"); process.exit(1); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(root, process.env.DATA_DIR || "./data");
const db = openDb(path.join(dataDir, "timeclock.sqlite"));
try {
  const r = createCompany(db, { name: args.name, code: args.code, adminName: args["admin-name"] || "管理員", adminLogin: args["admin-login"], adminPasswordHash: hashPassword(args["admin-password"]) });
  console.log(`已建立公司「${args.name}」（代碼 ${args.code.toLowerCase()}），管理員帳號 ${args["admin-login"]}。company_id=${r.companyId}`);
} catch (e) { console.error("建立失敗：" + e.message); process.exit(1); } finally { db.close(); }
