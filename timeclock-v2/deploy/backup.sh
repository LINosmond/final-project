#!/usr/bin/env bash
# 每日備份 SQLite（使用 sqlite3 的線上備份，不會卡住正在運作的服務）。
# crontab 範例：  30 3 * * * /opt/timeclock-v2/deploy/backup.sh
set -euo pipefail
DATA_DIR="${DATA_DIR:-/var/lib/timeclock}"
OUT_DIR="${OUT_DIR:-/var/backups/timeclock}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M)"
if command -v sqlite3 >/dev/null; then
  sqlite3 "$DATA_DIR/timeclock.sqlite" ".backup '$OUT_DIR/timeclock-$STAMP.sqlite'"
else
  node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync(process.argv[1]).exec(\"VACUUM INTO '\"+process.argv[2]+\"'\")" "$DATA_DIR/timeclock.sqlite" "$OUT_DIR/timeclock-$STAMP.sqlite"
fi
gzip -f "$OUT_DIR/timeclock-$STAMP.sqlite"
find "$OUT_DIR" -name 'timeclock-*.sqlite.gz' -mtime +60 -delete
echo "backup written: $OUT_DIR/timeclock-$STAMP.sqlite.gz"
