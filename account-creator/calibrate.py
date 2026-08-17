# -*- coding: utf-8 -*-
"""
校正工具 —— 產生 config.json（記住每個欄位在畫面上的座標）

做法：把要註冊的網頁開好、擺到你打算固定的位置，
      然後依提示把滑鼠移到「帳號輸入框」「密碼輸入框」「信箱輸入框」…上面，
      直接按 Enter 就記下座標。之後 create_accounts.py 就照這些座標點擊填字。

記點方式：把滑鼠移到欄位中央，直接按 Enter 記錄（不用切回終端機）。
  ——這需要 keyboard 套件（requirements.txt 已含）。若按 Enter 沒反應，
    請用「系統管理員身分」執行，或它會自動退回「回終端機按 Enter」的舊方式。

用法：
  python calibrate.py
"""

import json
import os
import sys
import time

try:
    import pyautogui  # noqa: F401  只用來讀滑鼠座標
except ImportError:
    sys.exit("缺少套件 pyautogui，請先執行：pip install -r requirements.txt")

try:
    import keyboard  # 全域攔截 Enter，滑鼠放好直接按就記點
except ImportError:
    keyboard = None

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.json")


def capture_point(prompt):
    print(f"  → {prompt}")
    if keyboard is not None:
        print("    把滑鼠移到欄位中央後，直接按 Enter 記錄…")
        try:
            while keyboard.is_pressed("enter"):
                time.sleep(0.01)
            keyboard.wait("enter")
            x, y = pyautogui.position()
            while keyboard.is_pressed("enter"):
                time.sleep(0.01)
            time.sleep(0.15)  # 去彈跳，避免一次記到兩點
        except Exception:
            input("    （熱鍵無法使用）移好滑鼠後，回這裡按 Enter…")
            x, y = pyautogui.position()
    else:
        input("    移好滑鼠後，回這裡按 Enter…")
        x, y = pyautogui.position()
    print(f"    已記錄：({x}, {y})\n")
    return [x, y]


def ask_yes(prompt, default=False):
    hint = "Y/n" if default else "y/N"
    raw = input(f"  {prompt}（{hint}）：").strip().lower()
    if not raw:
        return default
    return raw in ("y", "yes", "是", "1")


def ask_int(prompt, default):
    raw = input(f"  {prompt}（預設 {default}）：").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        print("    輸入不是數字，改用預設值。")
        return default


def load_old():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
    return None


def main():
    print("=" * 60)
    print("  帳號自動建立器 —— 校正工具")
    print("=" * 60)
    if keyboard is None:
        print("（提醒：沒裝 keyboard 套件，記點要回終端機按 Enter。想放好滑鼠直接按 Enter，"
              "請先 pip install keyboard）")
    print("\n請先把『註冊網頁』開好、擺到你之後要固定的位置與大小，別再移動視窗。")
    print("重點：這是固定座標，之後每一組都會點同樣的位置，所以視窗不能跑掉。\n")

    old = load_old() or {}

    fill_mbpw = ask_yes("表單需要填『信箱密碼』這一欄嗎？", default=False)
    has_submit = ask_yes("填完要自動按『送出／註冊』按鈕嗎？", default=True)
    batch_size = ask_int("一次要填幾組", (old.get("options", {}) or {}).get("batch_size", 4))

    input("\n準備好後按 Enter 開始記點…")
    print("\n接下來只用『滑鼠 + Enter』。依提示把滑鼠移到欄位上按 Enter。\n")

    fields = {}
    fields["account"] = capture_point("『帳號』輸入框")
    fields["password"] = capture_point("『密碼』輸入框")
    fields["email"] = capture_point("『信箱 / 邮箱』輸入框")
    fields["mailbox_password"] = capture_point("『信箱密碼』輸入框") if fill_mbpw else None
    fields["submit"] = capture_point("『送出 / 註冊』按鈕") if has_submit else None

    options = old.get("options", {}) or {}
    options.update({
        "batch_size": batch_size,
        "fill_mailbox_password": fill_mbpw,
        "press_enter_to_submit": options.get("press_enter_to_submit", False),
        "clear_before_type": options.get("clear_before_type", True),
        "use_clipboard_paste": options.get("use_clipboard_paste", True),
    })

    timing = old.get("timing", {}) or {
        "start_countdown": 3,
        "move_duration": 0.2,
        "click_delay": 0.25,
        "type_interval": 0.02,
        "after_field": 0.15,
        "after_submit": 1.5,
        "between_accounts": 1.0,
    }

    config = {"fields": fields, "options": options, "timing": timing}
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    print("=" * 60)
    print(f"已存好設定：{CONFIG_PATH}")
    print("=" * 60)
    print(
        "\n建議先『空跑』確認會點哪裡、填什麼（不會真的動滑鼠鍵盤）：\n"
        "  python create_accounts.py --dry-run\n\n"
        "正式執行（會有倒數，按 Esc 可隨時中止）：\n"
        "  python create_accounts.py\n"
    )


if __name__ == "__main__":
    main()
