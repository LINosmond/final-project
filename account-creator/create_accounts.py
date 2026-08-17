# -*- coding: utf-8 -*-
"""
帳號自動建立器 —— 依 config.json 的座標，自動把 accounts.txt 裡的帳號逐組填進網頁表單。

特色：
  * 固定座標：每一組都點同樣的欄位位置（先用 calibrate.py 記好）。
  * 一次只填一批（預設 4 組），下次再跑會自動接續填「還沒填過」的下一批。
  * 用剪貼簿貼上，@ 與各種符號都不會因輸入法／鍵盤配置而打錯。
  * 隨時可按 Esc 中止；把滑鼠猛甩到螢幕左上角也會觸發 pyautogui 緊急停止。

用法：
  python create_accounts.py --dry-run     只印出「會點哪裡、填什麼」，不動滑鼠鍵盤（強烈建議先跑這個）
  python create_accounts.py                填下一批（預設 4 組）
  python create_accounts.py --count 2      這次只填 2 組
  python create_accounts.py --all          一次把剩下的全部填完
  python create_accounts.py --reset        清掉進度，下次從第一組重新開始
  python create_accounts.py --file 帳號.txt 指定別的資料檔
"""

import argparse
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.json")
ACCOUNTS_PATH = os.path.join(HERE, "accounts.txt")
PROGRESS_PATH = os.path.join(HERE, "progress.json")

FIELD_ORDER = ["account", "password", "email", "mailbox_password"]
FIELD_LABEL = {
    "account": "帳號",
    "password": "密碼",
    "email": "信箱",
    "mailbox_password": "信箱密碼",
}


# ---------------------------------------------------------------------------
# 讀設定與資料
# ---------------------------------------------------------------------------
def load_config():
    if not os.path.exists(CONFIG_PATH):
        sys.exit("找不到 config.json，請先執行：python calibrate.py")
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def parse_mailbox_password(api_link):
    """從 API 連結尾端 ...----xxxx 取出信箱密碼；取不到回空字串。"""
    if not api_link:
        return ""
    m = re.search(r"----([^\s]+)$", api_link.strip())
    return m.group(1) if m else ""


def load_accounts(path):
    if not os.path.exists(path):
        sys.exit(f"找不到資料檔：{path}\n（可把 accounts.example.txt 另存成 accounts.txt 再填）")
    rows = []
    with open(path, "r", encoding="utf-8-sig") as f:
        for raw in f:
            line = raw.rstrip("\n").rstrip("\r")
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            # 欄位用 Tab 或多個空白分隔
            parts = re.split(r"\t+|\s{2,}", line.strip())
            if len(parts) < 3:
                parts = line.split()
            if len(parts) < 3:
                continue  # 欄位不足，跳過
            account, password, email = parts[0], parts[1], parts[2]
            # 標題列（第一行含「帳號」）自動略過
            if account == "帳號" or "帳號" in account and "密碼" in line:
                continue
            api_link = parts[3] if len(parts) >= 4 else ""
            rows.append({
                "account": account,
                "password": password,
                "email": email,
                "mailbox_password": parse_mailbox_password(api_link),
                "api_link": api_link,
            })
    return rows


def load_progress():
    if os.path.exists(PROGRESS_PATH):
        try:
            with open(PROGRESS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                return set(data.get("done", []))
        except Exception:
            return set()
    return set()


def save_progress(done):
    with open(PROGRESS_PATH, "w", encoding="utf-8") as f:
        json.dump({"done": sorted(done)}, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# 實際填字（真跑時才會 import pyautogui）
# ---------------------------------------------------------------------------
class Typer:
    def __init__(self, options, timing):
        import pyautogui
        self.pg = pyautogui
        self.pg.FAILSAFE = True  # 滑鼠甩到左上角=緊急停止
        self.opt = options
        self.t = timing
        try:
            import pyperclip
            self.clip = pyperclip
        except ImportError:
            self.clip = None

    def click(self, xy):
        self.pg.moveTo(xy[0], xy[1], duration=self.t.get("move_duration", 0.2))
        self.pg.click()
        time.sleep(self.t.get("click_delay", 0.25))

    def type_text(self, text):
        if self.opt.get("clear_before_type", True):
            self.pg.hotkey("ctrl", "a")
            self.pg.press("delete")
            time.sleep(0.05)
        if self.opt.get("use_clipboard_paste", True) and self.clip is not None:
            self.clip.copy(text)
            time.sleep(0.05)
            self.pg.hotkey("ctrl", "v")
        else:
            # 沒有 pyperclip 就直接敲鍵（@ 等符號在部分輸入法可能出錯）
            self.pg.typewrite(text, interval=self.t.get("type_interval", 0.02))
        time.sleep(self.t.get("after_field", 0.15))


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def build_plan(row, fields, options):
    """回傳這一組要做的動作清單：[(欄位標籤, 座標, 值), ...]，供空跑列印與實跑共用。"""
    steps = []
    for key in FIELD_ORDER:
        if key == "mailbox_password" and not options.get("fill_mailbox_password", False):
            continue
        coord = fields.get(key)
        if not coord:
            continue
        value = row.get(key, "")
        if key == "mailbox_password" and not value:
            continue
        steps.append((FIELD_LABEL[key], coord, value))
    return steps


def main():
    parser = argparse.ArgumentParser(description="帳號自動建立器")
    parser.add_argument("--dry-run", action="store_true", help="只印出會做什麼，不動滑鼠鍵盤")
    parser.add_argument("--count", type=int, default=None, help="這次要填幾組（預設用 config 的 batch_size）")
    parser.add_argument("--all", action="store_true", help="一次把剩下的全部填完")
    parser.add_argument("--reset", action="store_true", help="清掉進度，從第一組重新開始")
    parser.add_argument("--file", default=ACCOUNTS_PATH, help="資料檔路徑（預設 accounts.txt）")
    args = parser.parse_args()

    if args.reset:
        if os.path.exists(PROGRESS_PATH):
            os.remove(PROGRESS_PATH)
        print("已清除進度，下次從第一組開始。")
        return

    config = load_config()
    fields = config.get("fields", {})
    options = config.get("options", {})
    timing = config.get("timing", {})

    accounts = load_accounts(args.file)
    if not accounts:
        sys.exit("資料檔沒有讀到任何帳號。")

    done = load_progress()
    pending = [r for r in accounts if r["account"] not in done]
    if not pending:
        print(f"全部 {len(accounts)} 組都填過了。若要重來請跑：python create_accounts.py --reset")
        return

    if args.all:
        batch = pending
    else:
        n = args.count if args.count is not None else options.get("batch_size", 4)
        batch = pending[:max(0, n)]

    print("=" * 60)
    print(f"  帳號自動建立器　共 {len(accounts)} 組，已填 {len(done)} 組，"
          f"剩 {len(pending)} 組，這次填 {len(batch)} 組")
    print("=" * 60)
    for i, row in enumerate(batch, 1):
        plan = build_plan(row, fields, options)
        shown = "　".join(f"{label}={value}" for label, _coord, value in plan)
        print(f"  {i}. {shown}")
    print()

    if args.dry_run:
        print("（--dry-run 空跑，不會真的動作。確認沒問題後，拿掉 --dry-run 再跑一次。）")
        for i, row in enumerate(batch, 1):
            print(f"\n第 {i} 組：{row['account']}")
            for label, coord, value in build_plan(row, fields, options):
                print(f"   點 {coord} 填「{label}」= {value}")
            if fields.get("submit"):
                extra = " 並按 Enter" if options.get("press_enter_to_submit") else ""
                print(f"   點 {fields['submit']} 按【送出】{extra}")
            elif options.get("press_enter_to_submit"):
                print("   按 Enter 送出")
        return

    # ---- 真跑：倒數、可按 Esc 中止 ----
    try:
        import keyboard
    except ImportError:
        keyboard = None

    typer = Typer(options, timing)

    countdown = timing.get("start_countdown", 3)
    print(f"切到註冊網頁… {countdown} 秒後開始（按 Esc 可隨時中止；滑鼠甩到左上角=緊急停止）")
    for s in range(countdown, 0, -1):
        print(f"  {s}…")
        time.sleep(1)

    def aborted():
        return keyboard is not None and keyboard.is_pressed("esc")

    filled = 0
    try:
        for i, row in enumerate(batch, 1):
            if aborted():
                print("偵測到 Esc，中止。")
                break
            print(f"\n第 {i}/{len(batch)} 組：{row['account']}")
            for label, coord, value in build_plan(row, fields, options):
                if aborted():
                    raise KeyboardInterrupt
                print(f"   填「{label}」= {value}")
                typer.click(coord)
                typer.type_text(value)

            if fields.get("submit"):
                typer.click(fields["submit"])
            if options.get("press_enter_to_submit"):
                typer.pg.press("enter")
            time.sleep(timing.get("after_submit", 1.5))

            done.add(row["account"])
            save_progress(done)
            filled += 1
            time.sleep(timing.get("between_accounts", 1.0))
    except KeyboardInterrupt:
        print("\n已中止。")
    finally:
        save_progress(done)

    remaining = len([r for r in accounts if r["account"] not in done])
    print("\n" + "=" * 60)
    print(f"這次完成 {filled} 組，累積已填 {len(done)} 組，還剩 {remaining} 組。")
    if remaining:
        print("再跑一次 python create_accounts.py 就會接著填下一批。")
    print("=" * 60)


if __name__ == "__main__":
    main()
