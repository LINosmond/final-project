# -*- coding: utf-8 -*-
"""
晶能融合自動腳本（Angels Online 裝扮融合／晶能）—— 主程式

流程（一直循環）：
  1. 點「能量晶化」。
  2. 等一下，下面 3×4 格會有一格亮燈。
  3. 若亮的是【最大HP／攻擊力／魔攻／精準】其中之一 → 點「我要晶能加倍」。
     若不是 → 直接再回到步驟 1（跳過）。

怎麼判斷「哪一格亮燈」：
  亮燈的那格整體變亮（有亮框）。校正時會記下這 4 格「沒亮」的基準亮度，
  執行時比對——某格亮度超過『基準 + 邊界值』就判定為亮燈。

熱鍵（系統級，焦點在遊戲上也有效）：
  F1 = 開始／停止 循環
  F2 = 離開程式
  F3 = 即時測試：印出 4 個目標格目前的亮度與基準（用來微調/確認）

安全：滑鼠甩到螢幕左上角 = 緊急中止；終端機 Ctrl+C 也能結束。
"""

import json
import os
import sys
import threading
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

TARGETS = ["最大HP", "攻擊力", "魔攻", "精準"]  # 亮這幾個才按加倍

running = threading.Event()   # 被設定 = 循環進行中
exit_event = threading.Event()


# ---------------------------------------------------------------------------
# 底層點擊：Windows SendInput（比 pyautogui 更能被遊戲接受），非 Windows 退回 pyautogui
# ---------------------------------------------------------------------------
_USE_SENDINPUT = False
if sys.platform == "win32":
    try:
        import ctypes
        _ULONG_PTR = ctypes.POINTER(ctypes.c_ulong)

        class _MOUSEINPUT(ctypes.Structure):
            _fields_ = [("dx", ctypes.c_long), ("dy", ctypes.c_long),
                        ("mouseData", ctypes.c_ulong), ("dwFlags", ctypes.c_ulong),
                        ("time", ctypes.c_ulong), ("dwExtraInfo", _ULONG_PTR)]

        class _INPUT(ctypes.Structure):
            class _I(ctypes.Union):
                _fields_ = [("mi", _MOUSEINPUT)]
            _anonymous_ = ("i",)
            _fields_ = [("type", ctypes.c_ulong), ("i", _I)]

        _EVT = {"ldown": 0x0002, "lup": 0x0004}

        def _send_mouse(flag):
            extra = ctypes.c_ulong(0)
            mi = _MOUSEINPUT(0, 0, 0, flag, 0, ctypes.pointer(extra))
            inp = _INPUT(0, _INPUT._I(mi))
            ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))
        _USE_SENDINPUT = True
    except Exception:
        _USE_SENDINPUT = False


def left_click(hold=0.03):
    if _USE_SENDINPUT:
        _send_mouse(_EVT["ldown"])
        time.sleep(hold)
        _send_mouse(_EVT["lup"])
    else:
        pyautogui.click()


# ---------------------------------------------------------------------------
# 設定檔
# ---------------------------------------------------------------------------
def load_config():
    if not os.path.exists(CONFIG_PATH):
        sys.exit("找不到 config.json，請先執行校正：python calibrate.py")
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# 畫面與亮度
# ---------------------------------------------------------------------------
def grab(sct):
    shot = sct.grab(sct.monitors[1])
    return cv2.cvtColor(np.array(shot), cv2.COLOR_BGRA2BGR)


def cell_brightness(img, center, w, h):
    """回傳某格取樣區的平均亮度（0~255）。"""
    x, y = center
    hw, hh = int(w) // 2, int(h) // 2
    H, W = img.shape[:2]
    x0, x1 = max(0, x - hw), min(W, x + hw)
    y0, y1 = max(0, y - hh), min(H, y + hh)
    if x1 <= x0 or y1 <= y0:
        return 0.0
    gray = cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
    return float(gray.mean())


def which_target_lit(img, cfg):
    """回傳目前亮燈的目標名稱；沒有就回 None。"""
    det = cfg["detect"]
    w, h, margin = det["sample_w"], det["sample_h"], det["lit_margin"]
    for name in TARGETS:
        pos = cfg["positions"]["targets"][name]
        base = cfg["baseline"][name]
        if cell_brightness(img, pos, w, h) >= base + margin:
            return name
    return None


# ---------------------------------------------------------------------------
# 點擊
# ---------------------------------------------------------------------------
def click_at(pos, cfg):
    d = cfg["timing"].get("move_duration", 0.05)
    pyautogui.moveTo(pos[0], pos[1], duration=d)
    time.sleep(0.02)
    left_click(cfg["timing"].get("click_hold", 0.03))


def sleep_stoppable(seconds):
    """睡覺時檢查是否被要求停止/結束。回傳 True 表示要中斷。"""
    end = time.time() + seconds
    while time.time() < end:
        if not running.is_set() or exit_event.is_set():
            return True
        time.sleep(0.02)
    return not running.is_set() or exit_event.is_set()


# ---------------------------------------------------------------------------
# 主循環
# ---------------------------------------------------------------------------
def loop(cfg):
    t = cfg["timing"]
    pos = cfg["positions"]
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.0
    n = 0
    doubled = 0
    try:
        with mss.mss() as sct:
            while running.is_set() and not exit_event.is_set():
                click_at(pos["crystallize"], cfg)      # 1) 能量晶化
                if sleep_stoppable(t["after_crystallize"]):
                    break
                img = grab(sct)                          # 2) 看哪格亮
                lit = which_target_lit(img, cfg)
                n += 1
                if lit:                                  # 3) 命中 → 加倍
                    doubled += 1
                    print(f"[{n}] 亮燈：{lit} → 加倍（累計加倍 {doubled}）")
                    click_at(pos["double"], cfg)
                    if sleep_stoppable(t["after_double"]):
                        break
                else:
                    print(f"[{n}] 非目標，跳過")
                if sleep_stoppable(t["loop_gap"]):
                    break
    except pyautogui.FailSafeException:
        print("偵測到滑鼠到左上角，已緊急停止。")
    finally:
        running.clear()
        print(f"循環結束（共 {n} 次，命中加倍 {doubled} 次）。")


# ---------------------------------------------------------------------------
# 熱鍵
# ---------------------------------------------------------------------------
def on_toggle(cfg):
    if running.is_set():
        running.clear()
        print("F1：停止循環。")
    else:
        running.set()
        print("F1：開始循環（再按 F1 停止）。")
        threading.Thread(target=loop, args=(cfg,), daemon=True).start()


def on_test(cfg):
    """即時印出 4 個目標格的亮度 vs 基準，方便確認/微調。"""
    det = cfg["detect"]
    with mss.mss() as sct:
        img = grab(sct)
    print("--- 即時亮度測試（>= 基準+邊界 才算亮燈）---")
    for name in TARGETS:
        pos = cfg["positions"]["targets"][name]
        b = cell_brightness(img, pos, det["sample_w"], det["sample_h"])
        base = cfg["baseline"][name]
        lit = "★亮燈" if b >= base + det["lit_margin"] else "  暗"
        print(f"  {name:>5}：目前 {b:6.1f}  基準 {base:6.1f}  門檻 {base+det['lit_margin']:6.1f}  {lit}")
    print("-------------------------------------------")


def main():
    cfg = load_config()
    if keyboard is None:
        sys.exit("需要 keyboard 套件才能用熱鍵：pip install keyboard")
    keyboard.add_hotkey("f1", lambda: on_toggle(cfg))
    keyboard.add_hotkey("f2", lambda: exit_event.set())
    keyboard.add_hotkey("f3", lambda: on_test(cfg))
    print("=" * 52)
    print("  點擊方式：" + ("Windows SendInput（遊戲相容）" if _USE_SENDINPUT else "pyautogui"))
    print("  晶能融合自動腳本 —— 熱鍵待命中：")
    print("    F1 = 開始／停止 循環")
    print("    F2 = 離開程式")
    print("    F3 = 即時測試（印出 4 個目標格亮度，用來確認/微調）")
    print("    （滑鼠甩到螢幕左上角 = 緊急中止；Ctrl+C 也能結束）")
    print("=" * 52)
    try:
        while not exit_event.wait(0.2):
            pass
    except KeyboardInterrupt:
        pass
    finally:
        running.clear()
        try:
            keyboard.clear_all_hotkeys()
        except Exception:
            pass
    print("程式結束。")


if __name__ == "__main__":
    main()
