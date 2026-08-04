# -*- coding: utf-8 -*-
"""
校正工具 —— 產生 config.json

因為每個人的螢幕解析度、遊戲視窗位置都不一樣，座標一定要先校正過，
自動精靈才點得準。這支工具用「滑鼠指位置 + 按 Enter」的方式，
只要指幾個角落，就會自動算出整個格陣，不用自己算座標。

用法：
  python calibrate.py

過程中會請你把滑鼠移到指定位置，然後回終端機按 Enter。
全部指完會存成 config.json，之後就能跑 trade_bot.py。
"""

import json
import os
import sys

try:
    import pyautogui
except ImportError:
    sys.exit("缺少套件 pyautogui，請先執行：pip install -r requirements.txt")

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.json")


def capture(prompt):
    """顯示提示，等使用者把滑鼠移到定位後按 Enter，回傳當下滑鼠座標。"""
    input(f"  → {prompt}\n    移好滑鼠後，回這裡按 Enter…")
    x, y = pyautogui.position()
    print(f"    已記錄：({x}, {y})\n")
    return [x, y]


def ask_int(prompt, default):
    raw = input(f"  {prompt}（預設 {default}）：").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        print("    輸入不是數字，改用預設值。")
        return default


def calibrate_grid(title, default_cols, default_rows):
    print(f"\n===== 校正：{title} =====")
    cols = ask_int("這個區域有幾『欄』(直排數量)", default_cols)
    rows = ask_int("這個區域有幾『列』(橫排數量)", default_rows)

    tl = capture(f"把滑鼠移到【左上角第一格】的正中央")
    tr = capture(f"把滑鼠移到【第一列最右邊那格】的正中央")
    bl = capture(f"把滑鼠移到【第一欄最下面那格】的正中央")

    col_step = (tr[0] - tl[0]) / (cols - 1) if cols > 1 else 0
    row_step = (bl[1] - tl[1]) / (rows - 1) if rows > 1 else 0

    grid = {
        "first_cell": tl,
        "cols": cols,
        "rows": rows,
        "col_step": round(col_step, 2),
        "row_step": round(row_step, 2),
    }
    print(f"  {title} 完成：起點 {tl}，每欄間距 {grid['col_step']}，每列間距 {grid['row_step']}")
    return grid


def main():
    print("=" * 60)
    print("  遊戲交易自動精靈 —— 校正工具")
    print("=" * 60)
    print(
        "\n請先把遊戲畫面切到『交易視窗 + 道具背包同時打開』的狀態，"
        "\n讓兩個視窗都不要被擋住。準備好後按 Enter 開始。"
    )
    input()

    print("提示：接下來每一步，先把滑鼠移到指定的『格子正中央』，再回終端機按 Enter。")

    # 右邊：道具背包（有綠球那一大片）
    inventory = calibrate_grid(
        "右邊【道具背包】綠球區（只框有球的那幾列，最底下的禮物格不用算）",
        default_cols=10, default_rows=4,
    )

    # 左邊：交易視窗自己這一側（要放球的 8 格）
    trade = calibrate_grid(
        "左邊【交易視窗】自己的空格區（你那個角色名字底下、要放球的格子）",
        default_cols=4, default_rows=2,
    )

    max_items = ask_int("\n一次最多搬幾個", 8)

    config = {
        "inventory": inventory,
        "trade": trade,
        "max_items": max_items,
        "detection": {
            "_說明": "用顏色抓綠球。若抓不到或誤判，微調 hue/sat/val/fill_ratio。可跑 trade_bot.py --debug 觀察。",
            "hue_min": 25,
            "hue_max": 95,
            "sat_min": 60,
            "val_min": 60,
            "fill_ratio": 0.12,
            "sample_size": 40
        },
        "timing": {
            "start_countdown": 3,
            "move_duration": 0.15,
            "click_delay": 0.35,
            "between_items": 0.5
        },
        "quantity": {
            "_說明": "若點道具後會跳『數量』視窗，把 confirm_with_enter 改成 true，會自動按 Enter 確認。",
            "confirm_with_enter": False,
            "enter_delay": 0.3
        }
    }

    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60)
    print(f"已存好設定：{CONFIG_PATH}")
    print("=" * 60)
    print(
        "\n下一步建議先『空跑』確認有沒有抓對，不會真的點：\n"
        "  python trade_bot.py --dry-run\n\n"
        "順便看偵測圖：\n"
        "  python trade_bot.py --debug\n\n"
        "都正常後，正式執行：\n"
        "  python trade_bot.py\n"
    )


if __name__ == "__main__":
    main()
