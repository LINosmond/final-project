# -*- coding: utf-8 -*-
"""
晶能融合腳本 —— 校正工具（產生 config.json）

會請你用滑鼠指出幾個位置（滑鼠移好後直接按 Enter 記錄）：
  1. 「能量晶化」按鈕
  2. 「我要晶能加倍」按鈕
  3. 4 個目標格：最大HP、攻擊力、魔攻、精準（指格子正中央）

最後會記下這 4 格「沒亮」時的基準亮度，執行時用來比對是否亮燈。

用法：python calibrate.py
"""

import json
import os
import sys
import time

import numpy as np

try:
    import cv2
except ImportError:
    sys.exit("缺少套件 opencv-python，請先執行：pip install -r requirements.txt")
try:
    import mss
except ImportError:
    sys.exit("缺少套件 mss，請先執行：pip install -r requirements.txt")
try:
    import pyautogui
except ImportError:
    sys.exit("缺少套件 pyautogui，請先執行：pip install -r requirements.txt")
try:
    import keyboard
except ImportError:
    keyboard = None

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.json")
TARGETS = ["最大HP", "攻擊力", "魔攻", "精準"]

DEFAULT_DETECT = {"sample_w": 90, "sample_h": 34, "lit_rel_margin": 25}
DEFAULT_TIMING = {"after_crystallize": 0.5, "after_double": 0.5, "after_confirm": 0.4,
                  "loop_gap": 0.15, "move_duration": 0.05, "click_hold": 0.03}


def capture_point(prompt):
    print(f"  → {prompt}")
    if keyboard is not None:
        print("    把滑鼠移到定位後，直接按 Enter 記錄…")
        try:
            while keyboard.is_pressed("enter"):
                time.sleep(0.01)
            keyboard.wait("enter")
            x, y = pyautogui.position()
            while keyboard.is_pressed("enter"):
                time.sleep(0.01)
            time.sleep(0.15)
        except Exception:
            input("    （熱鍵無法使用）移好滑鼠後回這裡按 Enter…")
            x, y = pyautogui.position()
    else:
        input("    移好滑鼠後回這裡按 Enter…")
        x, y = pyautogui.position()
    print(f"    已記錄：({x}, {y})\n")
    return [x, y]


def wait_enter():
    if keyboard is None:
        input("    按 Enter…")
        return
    while keyboard.is_pressed("enter"):
        time.sleep(0.01)
    keyboard.wait("enter")
    while keyboard.is_pressed("enter"):
        time.sleep(0.01)
    time.sleep(0.15)


def grab():
    with mss.mss() as sct:
        shot = sct.grab(sct.monitors[1])
    return cv2.cvtColor(np.array(shot), cv2.COLOR_BGRA2BGR)


def cell_brightness(img, center, w, h):
    x, y = center
    hw, hh = w // 2, h // 2
    gray = cv2.cvtColor(img[max(0, y - hh):y + hh, max(0, x - hw):x + hw], cv2.COLOR_BGR2GRAY)
    return float(gray.mean())


def main():
    print("=" * 56)
    print("  晶能融合腳本 —— 校正")
    print("=" * 56)
    print("請先把遊戲切到『裝扮 融合 / 晶能』視窗，並確定下面 3×4 格【目前都沒有亮燈】。")
    print("準備好後按 Enter 開始…")
    wait_enter()

    print("\n只用滑鼠 + Enter：把滑鼠移到指定位置後按 Enter。\n")
    crystallize = capture_point("「能量晶化」按鈕 的中央")
    double = capture_point("「我要晶能加倍」按鈕 的中央")

    print("— 接著指 4 個目標格（格子正中央）—")
    targets = {}
    for name in TARGETS:
        targets[name] = capture_point(f"目標格【{name}】的正中央")

    # 確認視窗的「確定(✓)」按鈕：需要視窗先跳出來才能指
    print("\n— 設定確認視窗的「確定(✓)」按鈕 —")
    print("請先【手動點一次『我要晶能加倍』】讓確認視窗跳出來（會消耗 1 個秘藥）。")
    confirm = capture_point("把滑鼠移到確認視窗左邊的 ✓ 打勾鈕，按 Enter")

    config = {
        "positions": {"crystallize": crystallize, "double": double,
                      "targets": targets, "confirm": confirm},
        "detect": dict(DEFAULT_DETECT,
                       _說明="lit_rel_margin：亮燈那格會比其他格突出。最亮的比第二亮的高過此值才算亮燈。"
                             "誤判就調大、漏抓就調小。可用 F3 即時測試觀察。"),
        "timing": dict(DEFAULT_TIMING,
                       _說明="after_crystallize：按晶化後等多久才判斷亮燈（遊戲勾『跳過動畫』才快又準）。"),
    }
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 56)
    print(f"已存好設定：{CONFIG_PATH}")
    print("=" * 56)
    print(
        "\n建議先開主程式、用 F3 測試判斷對不對：\n"
        "  python fusion_bot.py\n"
        "  → 讓某個目標格亮燈時按 F3，看是不是只標到那一格。\n"
        "  → 不準就調 config.json 的 detect.lit_rel_margin（誤判調大、漏抓調小）。\n"
        "沒問題後按 F1 開始循環。\n"
    )


if __name__ == "__main__":
    main()
