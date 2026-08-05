# -*- coding: utf-8 -*-
"""
晶能融合自動腳本（Angels Online 裝扮融合／晶能）—— 主程式

流程（一直循環）：
  1. 點「能量晶化」。
  2. 等一下，下面 3×4 格會有一格亮燈。
  3. 若亮的是【最大HP／攻擊力／魔攻／精準】其中之一 → 點「我要晶能加倍」，
     再點跳出來的確認視窗「確定(✓)」。
     若不是 → 直接再回到步驟 1（跳過）。

怎麼判斷「哪一格亮燈」：
  亮燈的那格整體變亮（有亮框）。校正時會記下這 4 格「沒亮」的基準亮度，
  執行時比對——某格亮度超過『基準 + 邊界值』就判定為亮燈。

熱鍵（系統級，焦點在遊戲上也有效）：
  F1 = 開始／停止 循環
  F2 = 離開程式
  F3 = 即時測試：印出 4 個目標格目前的亮度（用來微調/確認）
  F4 = 設定「確定(✓)」按鈕位置（滑鼠移到✓上按 F4）

安全：滑鼠甩到螢幕左上角 = 緊急中止；終端機 Ctrl+C 也能結束。
"""

import json
import os
import sys
import threading
import time
import warnings

warnings.filterwarnings("ignore")  # 隱藏 mss 等套件的 Deprecation 提示

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


def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


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


def target_brightness(img, cfg):
    """回傳 [(名稱, 亮度), ...]，由亮到暗排序。"""
    det = cfg["detect"]
    w, h = det["sample_w"], det["sample_h"]
    vals = [(name, cell_brightness(img, cfg["positions"]["targets"][name], w, h))
            for name in TARGETS]
    vals.sort(key=lambda x: x[1], reverse=True)
    return vals


def baseline_of(vals):
    """用『最暗的兩格』平均當基準——這兩格通常沒亮、也沒被隔壁亮框牽連。"""
    lows = [v for _, v in vals[-2:]]
    return sum(lows) / len(lows) if lows else 0.0


def which_target_lit(img, cfg):
    """用『相對亮度』判斷：亮燈那格會比『沒被牽連的暗格』突出一大截。
    （不跟第二亮比，因為亮燈格的鄰格會被亮框牽連而變亮。）
    回傳目前亮燈的目標名稱；沒有就回 None。"""
    margin = cfg["detect"].get("lit_rel_margin", 25)
    vals = target_brightness(img, cfg)   # 由亮到暗
    if len(vals) < 3:
        return None
    top_name, top_val = vals[0]
    if top_val - baseline_of(vals) >= margin:
        return top_name
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
# 加倍 + 確認視窗偵測（比對確定鈕附近前後畫面差異，判斷視窗有沒有跳出來）
# ---------------------------------------------------------------------------
def _region(center, w, h, shape):
    x, y = center
    hw, hh = w // 2, h // 2
    H, W = shape[:2]
    return (max(0, x - hw), max(0, y - hh), min(W, x + hw), min(H, y + hh))


def _crop(img, box):
    x0, y0, x1, y1 = box
    return img[y0:y1, x0:x1]


def _mean_abs_diff(a, b):
    if a.shape != b.shape or a.size == 0:
        return 999.0
    return float(np.abs(a.astype(np.int16) - b.astype(np.int16)).mean())


def double_and_confirm(sct, cfg):
    """按加倍 → 確認『確認視窗』有跳出來（前後畫面差異夠大）→ 按確定；
    沒跳出來就再按一次加倍（最多重試幾次）。回傳 True 代表被要求停止。"""
    pos, t, det = cfg["positions"], cfg["timing"], cfg["detect"]
    confirm = pos.get("confirm")
    if not confirm:
        print("  （尚未設定『確定』按鈕位置，請按 F4 設定；這次先只點加倍）")
        click_at(pos["double"], cfg)
        return sleep_stoppable(t["after_double"])

    w = det.get("dialog_region_w", 160)
    h = det.get("dialog_region_h", 90)
    thresh = det.get("dialog_diff", 18)
    retries = det.get("double_retries", 3)

    before_full = grab(sct)
    box = _region(confirm, w, h, before_full.shape)
    before = _crop(before_full, box).copy()   # 沒有視窗時的樣子（基準）

    for attempt in range(retries + 1):
        click_at(pos["double"], cfg)
        if sleep_stoppable(t["after_double"]):
            return True
        d = _mean_abs_diff(before, _crop(grab(sct), box))
        if d >= thresh:                        # 視窗有跳出來
            click_at(confirm, cfg)             # 按確定(✓)
            print(f"    確認視窗已出現(差異 {d:.0f}) → 按確定")
            return sleep_stoppable(t.get("after_confirm", 0.4))
        print(f"    沒偵測到確認視窗(差異 {d:.0f} < {thresh})，再按一次加倍…")
        if not running.is_set() or exit_event.is_set():
            return True
    print("    重試多次仍沒出現確認視窗，跳過這次。")
    return False


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
                if lit:                                  # 3) 命中 → 加倍 →（確認視窗）→ 確定
                    doubled += 1
                    print(f"[{n}] 亮燈：{lit} → 加倍（累計加倍 {doubled}）")
                    if double_and_confirm(sct, cfg):
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
    """即時印出 4 個目標格的亮度，並顯示判定結果（用相對亮度）。"""
    margin = cfg["detect"].get("lit_rel_margin", 25)
    with mss.mss() as sct:
        img = grab(sct)
    vals = target_brightness(img, cfg)
    lit = which_target_lit(img, cfg)
    base = baseline_of(vals)
    diff = vals[0][1] - base if vals else 0
    print("--- 即時亮度測試（最亮的比『暗格基準』高過 %.0f 才算亮燈）---" % margin)
    for name, b in vals:
        mark = "★亮燈" if name == lit else ""
        print(f"  {name:>5}：{b:6.1f}  {mark}")
    print(f"  暗格基準 = {base:.1f}；最亮-基準 = {diff:.1f}（門檻 {margin}）"
          f"→ {'亮燈：' + lit if lit else '沒有目標亮燈'}")
    print("-------------------------------------------")


def on_set_confirm(cfg):
    """把滑鼠目前位置記成『確定(✓)』按鈕。先手動點一次加倍讓確認視窗跳出來，滑鼠移到✓上按 F4。"""
    p = list(pyautogui.position())
    cfg.setdefault("positions", {})["confirm"] = p
    save_config(cfg)
    print(f"F4：已把『確定(✓)』按鈕位置設為 {p}（之後加倍後會自動按這裡確認）。")


def main():
    cfg = load_config()
    if keyboard is None:
        sys.exit("需要 keyboard 套件才能用熱鍵：pip install keyboard")
    keyboard.add_hotkey("f1", lambda: on_toggle(cfg))
    keyboard.add_hotkey("f2", lambda: exit_event.set())
    keyboard.add_hotkey("f3", lambda: on_test(cfg))
    keyboard.add_hotkey("f4", lambda: on_set_confirm(cfg))
    confirm_set = bool(cfg.get("positions", {}).get("confirm"))
    print("=" * 52)
    print("  點擊方式：" + ("Windows SendInput（遊戲相容）" if _USE_SENDINPUT else "pyautogui"))
    print("  晶能融合自動腳本 —— 熱鍵待命中：")
    print("    F1 = 開始／停止 循環")
    print("    F2 = 離開程式")
    print("    F3 = 即時測試（印出 4 個目標格亮度，用來確認/微調）")
    print("    F4 = 設定『確定(✓)』按鈕位置" + ("（已設定）" if confirm_set else "（尚未設定，請設定！）"))
    print("    （滑鼠甩到螢幕左上角 = 緊急中止；Ctrl+C 也能結束）")
    if not confirm_set:
        print("  ⚠ 尚未設定『確定』鈕：先手動點一次『我要晶能加倍』讓確認視窗跳出，")
        print("     把滑鼠移到左邊的 ✓ 打勾鈕上，按 F4 記錄，之後才能自動確認。")
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
