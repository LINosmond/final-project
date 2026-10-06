import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { createApp } from "./app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
loadDotEnv(path.join(root, ".env"));

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(root, process.env.DATA_DIR || "./data");
const STATIC_DIR = path.join(root, "web", "dist");
const trustProxy = process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true";

const db = openDb(path.join(DATA_DIR, "timeclock.sqlite"));
const { server } = createApp({ db, staticDir: fs.existsSync(STATIC_DIR) ? STATIC_DIR : null, trustProxy });
server.listen(PORT, () => {
  console.log(`TimeClock v2 listening on http://localhost:${PORT}  data=${DATA_DIR}  static=${fs.existsSync(STATIC_DIR) ? "web/dist" : "(not built; run npm run build)"}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { server.close(() => { db.close(); process.exit(0); }); });

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
