# -*- coding: utf-8 -*-
"""
遊戲交易自動精靈 —— 主程式

流程（對應你的需求）：
  1. 拍照找出右邊「道具」背包裡有球（顏色）的格子，也偵測左邊交易視窗哪幾格是空的。
  2. 只往「空格」放：拿一顆還沒用過的球 → 放到第一個空格。
  3. 每放一個都重新偵測，確認有放上去；漏擺的格子下一輪會自動補放，
     直到放滿 N 格（F1=7、F2=8，可在程式頂端 F1_COUNT/F2_COUNT 調整）或沒球為止。

熱鍵（系統級，焦點在遊戲上也有效）：
  F1 = 開始搬運 綠球（7 顆）；搬運中再按一次 = 停止
  F2 = 開始搬運 綠球（8 顆）；搬運中再按一次 = 停止
  F3 = 開始搬運 粉紅道具（8 顆，另一種顏色辨識）；搬運中再按一次 = 停止
  F4 = 連點右鍵開／關（在滑鼠當前位置一直點右鍵，再按一次停止）
  F5 = 連續左鍵點兩個位置 開／關（第一次按會請你設定，之後記住）；Shift+F5 重新設定
  F6 = 在固定位置連點右鍵 開／關（第一次按會請你設定位置）；Shift+F6 重新設定

偵測方式：用顏色判斷。綠色球是偏黃綠／橄欖綠，空格是深藍色，
兩者差很多，所以用 HSV 色相範圍就能分辨哪格有球。

其他安全機制：
  - pyautogui 內建 failsafe：把滑鼠快速甩到螢幕「左上角」會立刻中止。
  - 終端機按 Ctrl + C 也能結束程式。

用法：
  python trade_bot.py            開啟熱鍵待命（F1 搬 7 顆 / F2 搬 8 顆 / F3 連點右鍵）
  python trade_bot.py --now      不等熱鍵，倒數後直接執行一次搬運
  python trade_bot.py --dry-run  只偵測、不點擊（滑鼠會移過去給你看，驗證有沒有抓對）
  python trade_bot.py --debug    另外存一張 debug 圖，畫出每格有沒有抓到球
"""

import argparse
import json
import os
import random
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
    import keyboard  # 系統級熱鍵（F1/F2）
except ImportError:
    keyboard = None


# ---------------------------------------------------------------------------
# 底層點擊：用 Windows SendInput 送滑鼠事件（比 pyautogui 更能被遊戲接受）
# 有些遊戲會忽略一般模擬點擊；SendInput + 真實按壓時間通常收得到。
# 非 Windows（或載入失敗）時自動退回 pyautogui。
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

        _MOUSEEVENTF = {
            "ldown": 0x0002, "lup": 0x0004,
            "rdown": 0x0008, "rup": 0x0010,
        }

        def _send_mouse(flag):
            extra = ctypes.c_ulong(0)
            mi = _MOUSEINPUT(0, 0, 0, flag, 0, ctypes.pointer(extra))
            inp = _INPUT(0, _INPUT._I(mi))  # type 0 = INPUT_MOUSE
            ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))

        def _set_cursor(x, y):
            ctypes.windll.user32.SetCursorPos(int(x), int(y))

        _USE_SENDINPUT = True
    except Exception:
        _USE_SENDINPUT = False


def press_click(button="left", hold=0.03):
    """在滑鼠目前位置按一下（按下→停 hold 秒→放開）。"""
    if _USE_SENDINPUT:
        down, up = ("ldown", "lup") if button == "left" else ("rdown", "rup")
        _send_mouse(_MOUSEEVENTF[down])
        time.sleep(hold)
        _send_mouse(_MOUSEEVENTF[up])
    else:
        pyautogui.click(button=button)


HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.json")

# 執行控制用的旗標
stop_event = threading.Event()     # 被設定 = 立刻停止目前這次搬運
exit_event = threading.Event()     # 被設定 = 整個程式結束
busy_lock = threading.Lock()       # 確保同時只跑一次搬運
rightclick_active = threading.Event()  # 被設定 = 連點右鍵(F4, 滑鼠當前位置)進行中
two_click_active = threading.Event()   # 被設定 = F5 連續兩點進行中
two_click_lock = threading.Lock()      # 避免 F5 兩點設定被重複觸發
f6_active = threading.Event()          # 被設定 = F6 固定位置連點右鍵進行中
f6_lock = threading.Lock()             # 避免 F6 位置設定被重複觸發


# ---------------------------------------------------------------------------
# 設定檔
# ---------------------------------------------------------------------------
def load_config():
    if not os.path.exists(CONFIG_PATH):
        sys.exit(
            "找不到 config.json。\n"
            "請先執行校正工具產生設定：python calibrate.py"
        )
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def grid_cells(grid):
    """把一個格陣設定展開成每一格的中心座標 (x, y) 清單，順序為由左到右、由上到下。"""
    fx, fy = grid["first_cell"]
    cols, rows = int(grid["cols"]), int(grid["rows"])
    cs, rs = grid["col_step"], grid["row_step"]
    cells = []
    for r in range(rows):
        for c in range(cols):
            cells.append((int(round(fx + c * cs)), int(round(fy + r * rs))))
    return cells


# ---------------------------------------------------------------------------
# 畫面擷取與偵測
# ---------------------------------------------------------------------------
def grab_screen(sct):
    """抓整個主螢幕，回傳 BGR 影像（給 OpenCV 用）。"""
    monitor = sct.monitors[1]  # 1 = 主螢幕
    shot = sct.grab(monitor)
    frame = np.array(shot)  # BGRA
    return cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)


def cell_fill_ratio(img_bgr, center, det):
    """回傳某格中心一小塊區域裡「綠球顏色」佔的比例（0~1）。"""
    x, y = center
    half = int(det["sample_size"]) // 2
    h, w = img_bgr.shape[:2]
    x0, x1 = max(0, x - half), min(w, x + half)
    y0, y1 = max(0, y - half), min(h, y + half)
    if x1 <= x0 or y1 <= y0:
        return 0.0
    crop = img_bgr[y0:y1, x0:x1]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    lower = np.array([det["hue_min"], det["sat_min"], det["val_min"]], dtype=np.uint8)
    upper = np.array([det["hue_max"], 255, 255], dtype=np.uint8)
    mask = cv2.inRange(hsv, lower, upper)
    return float(mask.mean()) / 255.0


def detect_ball_cells(img_bgr, cells, det):
    """回傳所有『有球』的格子中心座標清單。"""
    return [c for c in cells if cell_fill_ratio(img_bgr, c, det) >= det["fill_ratio"]]


# ---------------------------------------------------------------------------
# Debug 圖
# ---------------------------------------------------------------------------
def save_debug(img_bgr, inv_cells, trade_cells, det, path):
    vis = img_bgr.copy()
    for c in inv_cells:
        ratio = cell_fill_ratio(img_bgr, c, det)
        color = (0, 255, 0) if ratio >= det["fill_ratio"] else (0, 0, 255)
        cv2.circle(vis, c, int(det["sample_size"]) // 2, color, 2)
        cv2.putText(vis, f"{ratio:.2f}", (c[0] - 20, c[1] - int(det["sample_size"]) // 2 - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1, cv2.LINE_AA)
    for i, c in enumerate(trade_cells):
        cv2.rectangle(vis, (c[0] - 20, c[1] - 20), (c[0] + 20, c[1] + 20), (255, 200, 0), 2)
        cv2.putText(vis, str(i + 1), (c[0] - 6, c[1] + 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 200, 0), 2, cv2.LINE_AA)
    cv2.imwrite(path, vis)
    print(f"已存 debug 圖：{path}")


# ---------------------------------------------------------------------------
# 可中斷的等待與點擊
# ---------------------------------------------------------------------------
def sleep_interruptible(seconds):
    """睡覺時每 20ms 檢查一次停止旗標，讓 F2 能即時中斷。回傳 True 表示被要求停止。"""
    end = time.time() + seconds
    while time.time() < end:
        if stop_event.is_set():
            return True
        time.sleep(0.02)
    return stop_event.is_set()


def click(x, y, cfg):
    pyautogui.moveTo(x, y, duration=cfg["timing"]["move_duration"])
    time.sleep(0.02)
    press_click("left", cfg["timing"].get("click_hold", 0.03))


# ---------------------------------------------------------------------------
# 核心搬運流程（會頻繁檢查 stop_event，讓 F2 立刻生效）
# ---------------------------------------------------------------------------
def run_sequence(cfg, dry_run=False, debug=False, count=None, det=None):
    inv_cells = grid_cells(cfg["inventory"])
    trade_cells = grid_cells(cfg["trade"])
    det = det if det is not None else cfg["detection"]
    timing = cfg["timing"]
    want = count if count is not None else int(cfg.get("max_items", 8))
    max_items = min(int(want), len(trade_cells))

    pyautogui.FAILSAFE = True  # 滑鼠甩到左上角 = 緊急停止
    pyautogui.PAUSE = 0.0

    def is_filled(image, center):
        return cell_fill_ratio(image, center, det) >= det["fill_ratio"]

    with mss.mss() as sct:
        img = grab_screen(sct)

        if debug:
            save_debug(img, inv_cells, trade_cells, det, os.path.join(HERE, "debug_view.png"))

        all_balls = detect_ball_cells(img, inv_cells, det)
        if not all_balls:
            print("沒有偵測到任何球。若確定畫面上有球，請調整 config.json 的 detection，"
                  "或先跑 python trade_bot.py --debug 看抓取情形。")
            return
        print(f"背包偵測到 {len(all_balls)} 顆球，目標填滿 {max_items} 個交易格。")

        # 每放一個都重新偵測「交易視窗哪幾格是空的」，只往空格放；漏擺的格子下輪會自動補放。
        used = set()                       # 已成功放上去的背包球（避免重複拿同一顆）
        attempts = 0
        max_attempts = max_items * 4 + 6   # 防呆：避免一直漏擺時無限迴圈
        while not stop_event.is_set():
            img = grab_screen(sct)
            filled = sum(1 for s in trade_cells if is_filled(img, s))
            empty_slots = [s for s in trade_cells if not is_filled(img, s)]
            if filled >= max_items or not empty_slots:
                break
            target = empty_slots[0]        # 下一個空格

            balls = detect_ball_cells(img, inv_cells, det)
            available = [b for b in balls if tuple(b) not in used]
            if not available:
                print("背包沒有可用的球了，停止。")
                break

            attempts += 1
            if attempts > max_attempts:
                print(f"嘗試 {attempts} 次仍無法填滿（已填 {filled}/{max_items}），停止。")
                break

            item = random.choice(available)
            print(f"[{filled + 1}/{max_items}] 空格 {target} ← 拿球 {item}")

            if dry_run:
                pyautogui.moveTo(item[0], item[1], duration=timing["move_duration"])
                if sleep_interruptible(0.2):
                    break
                pyautogui.moveTo(target[0], target[1], duration=timing["move_duration"])
                used.add(tuple(item))      # 空跑：假裝成功，才會往下一格示範
                if sleep_interruptible(timing["between_items"]):
                    break
                continue

            # 1) 點背包的球（拿起）
            click(item[0], item[1], cfg)
            if sleep_interruptible(timing["click_delay"]):
                break
            # 2) 若有數量視窗，可選擇按 Enter 確認
            if cfg["quantity"]["confirm_with_enter"]:
                if sleep_interruptible(cfg["quantity"]["enter_delay"]):
                    break
                pyautogui.press("enter")
                if sleep_interruptible(cfg["quantity"]["enter_delay"]):
                    break
            # 3) 點交易視窗空格（放上）
            if stop_event.is_set():
                break
            click(target[0], target[1], cfg)
            if sleep_interruptible(timing["between_items"]):
                break

            # 4) 確認這格真的放上去了；有放上去才把這顆球記為已用，否則下輪會再補放
            if is_filled(grab_screen(sct), target):
                used.add(tuple(item))
            else:
                print("    這格好像沒放到，下一輪會再補放。")

        img = grab_screen(sct)
        done = sum(1 for s in trade_cells if is_filled(img, s))
        print(f"本次結束，交易格已放上 {done} 個（目標 {max_items}）。")


def do_run(cfg, dry_run=False, debug=False, count=None, det=None):
    """包一層：避免重複觸發、處理 failsafe，跑完自動解除忙碌狀態。"""
    if not busy_lock.acquire(blocking=False):
        print("（正在搬運中，忽略這次）")
        return
    try:
        stop_event.clear()
        run_sequence(cfg, dry_run=dry_run, debug=debug, count=count, det=det)
    except pyautogui.FailSafeException:
        print("\n偵測到滑鼠移到左上角，已緊急中止。")
    finally:
        stop_event.clear()
        busy_lock.release()


# ---------------------------------------------------------------------------
# 熱鍵設定（v2）
#   F1 = 立刻開始搬運 綠球（F1_COUNT 顆）；搬運中再按一次 = 停止
#   F2 = 立刻開始搬運 綠球（F2_COUNT 顆）；搬運中再按一次 = 停止
#   F3 = 立刻開始搬運 粉紅道具（F3_COUNT 顆）；搬運中再按一次 = 停止
#   F4 = 連點右鍵 開／關（單鍵開關）
#   F5 = 連續左鍵點兩個位置 開／關（Shift+F5 設定/重設位置）
#   F6 = 在固定位置連點右鍵 開／關（Shift+F6 設定/重設位置）
# ---------------------------------------------------------------------------
F1_COUNT = 7   # F1 一次搬幾顆
F2_COUNT = 8   # F2 一次搬幾顆
F3_COUNT = 8   # F3 一次搬幾顆

# F3 用「另一種道具」的顏色辨識（粉紅色道具，hue 0~15）；F1/F2 沿用 config 的綠球辨識。
F3_COLOR = {"hue_min": 0, "hue_max": 15, "sat_min": 45, "val_min": 60}


def f3_detection(cfg):
    """F3 的偵測設定 = config 的偵測（取 sample_size/fill_ratio）+ 覆蓋成粉紅色範圍。"""
    det = dict(cfg["detection"])
    det.update(F3_COLOR)
    return det


def rightclick_interval(cfg):
    t = cfg["timing"]
    return t.get("rightclick_interval", t.get("f3_interval", 0.1))


# ---------- F1 / F2 / F3：開始搬運（不同顆數/辨識）；搬運中再按一次就停 ----------
def on_start_trade(cfg, dry_run, debug, count, det=None):
    if busy_lock.locked():
        stop_event.set()
        print("停止搬運。")
        return
    threading.Thread(target=do_run, args=(cfg, dry_run, debug, count, det), daemon=True).start()


# ---------- F4：連點右鍵（單鍵開關） ----------
def rightclick_loop(cfg):
    interval = rightclick_interval(cfg)
    try:
        while rightclick_active.is_set() and not exit_event.is_set():
            press_click("right", cfg["timing"].get("click_hold", 0.03))
            end = time.time() + interval
            while time.time() < end:
                if not rightclick_active.is_set() or exit_event.is_set():
                    return
                time.sleep(0.01)
    except pyautogui.FailSafeException:
        print("F4：偵測到滑鼠到左上角，已停止連點右鍵。")
        rightclick_active.clear()


def on_toggle_rightclick(cfg):
    if rightclick_active.is_set():
        rightclick_active.clear()
        print("連點右鍵：停止。")
    else:
        rightclick_active.set()
        print("連點右鍵：開始（滑鼠停在要點的地方；再按一次停止）。")
        threading.Thread(target=rightclick_loop, args=(cfg,), daemon=True).start()


# ---------- F5：連續左鍵點兩個位置（開關；Shift+F5 設定位置）----------
def two_click_cfg(cfg):
    return cfg.get("two_click") or {}


def two_click_gap(cfg):
    return cfg["timing"].get("two_click_gap", 0.15)


def wait_enter_press():
    """輪詢等一次新的 Enter 按下（給設定用，不與熱鍵衝突）。回傳 False 代表程式要結束。"""
    while keyboard.is_pressed("enter"):
        if exit_event.is_set():
            return False
        time.sleep(0.01)
    while not keyboard.is_pressed("enter"):
        if exit_event.is_set():
            return False
        time.sleep(0.01)
    while keyboard.is_pressed("enter"):
        time.sleep(0.01)
    return True


def record_two_click(cfg):
    if keyboard is None:
        print("F5 兩點設定需要 keyboard 套件。")
        return
    if not two_click_lock.acquire(blocking=False):
        return
    try:
        print("\n== 設定 F5 的兩個左鍵位置 ==")
        print("把滑鼠移到【位置1】後按 Enter…")
        if not wait_enter_press():
            return
        a = list(pyautogui.position())
        print(f"  位置1 = {a}")
        time.sleep(0.25)
        print("把滑鼠移到【位置2】後按 Enter…")
        if not wait_enter_press():
            return
        b = list(pyautogui.position())
        print(f"  位置2 = {b}")
        cfg["two_click"] = {"pos_a": a, "pos_b": b}
        save_config(cfg)
        print("F5 兩點設定完成並已記住。按 F5 就會『連續』左鍵點這兩個位置，再按 F5 停止；要重設按 Shift+F5。\n")
    finally:
        two_click_lock.release()


def _sleep_flag(flag, seconds):
    end = time.time() + seconds
    while time.time() < end:
        if not flag.is_set() or exit_event.is_set():
            return False
        time.sleep(0.01)
    return flag.is_set() and not exit_event.is_set()


def two_click_loop(cfg):
    pos = two_click_cfg(cfg)
    a, b = pos["pos_a"], pos["pos_b"]
    d = cfg["timing"].get("move_duration", 0.15)
    gap = two_click_gap(cfg)
    cyclegap = cfg["timing"].get("two_click_loop_gap", gap)
    hold = cfg["timing"].get("click_hold", 0.03)
    try:
        while two_click_active.is_set() and not exit_event.is_set():
            pyautogui.moveTo(a[0], a[1], duration=d)
            time.sleep(0.02)
            press_click("left", hold)
            if not _sleep_flag(two_click_active, gap):
                break
            pyautogui.moveTo(b[0], b[1], duration=d)
            time.sleep(0.02)
            press_click("left", hold)
            if not _sleep_flag(two_click_active, cyclegap):
                break
    except pyautogui.FailSafeException:
        print("F5：偵測到滑鼠到左上角，已停止。")
        two_click_active.clear()


def on_two_click(cfg):
    pos = two_click_cfg(cfg)
    if not pos.get("pos_a") or not pos.get("pos_b"):
        threading.Thread(target=record_two_click, args=(cfg,), daemon=True).start()
        return
    if two_click_active.is_set():
        two_click_active.clear()
        print("F5：停止連續兩點。")
    else:
        two_click_active.set()
        print("F5：開始連續左鍵點兩個位置（再按 F5 停止）。")
        threading.Thread(target=two_click_loop, args=(cfg,), daemon=True).start()


def on_reset_two_click(cfg):
    two_click_active.clear()
    threading.Thread(target=record_two_click, args=(cfg,), daemon=True).start()


# ---------- F6：在固定位置連點右鍵（開關；Shift+F6 設定位置）----------
def f6_pos(cfg):
    return cfg.get("f6_pos")


def record_f6(cfg):
    if keyboard is None:
        print("F6 位置設定需要 keyboard 套件。")
        return
    if not f6_lock.acquire(blocking=False):
        return
    try:
        print("\n== 設定 F6 連點右鍵的位置 ==")
        print("把滑鼠移到要一直點右鍵的位置後按 Enter…")
        if not wait_enter_press():
            return
        p = list(pyautogui.position())
        print(f"  位置 = {p}")
        cfg["f6_pos"] = p
        save_config(cfg)
        print("F6 位置設定完成並已記住。按 F6 就會在這個位置連點右鍵，再按 F6 停止；要重設按 Shift+F6。\n")
    finally:
        f6_lock.release()


def f6_loop(cfg):
    p = f6_pos(cfg)
    interval = rightclick_interval(cfg)
    d = cfg["timing"].get("move_duration", 0.15)
    hold = cfg["timing"].get("click_hold", 0.03)
    try:
        while f6_active.is_set() and not exit_event.is_set():
            pyautogui.moveTo(p[0], p[1], duration=d)
            time.sleep(0.02)
            press_click("right", hold)
            end = time.time() + interval
            while time.time() < end:
                if not f6_active.is_set() or exit_event.is_set():
                    return
                time.sleep(0.01)
    except pyautogui.FailSafeException:
        print("F6：偵測到滑鼠到左上角，已停止。")
        f6_active.clear()


def on_f6(cfg):
    if not f6_pos(cfg):
        threading.Thread(target=record_f6, args=(cfg,), daemon=True).start()
        return
    if f6_active.is_set():
        f6_active.clear()
        print("F6：停止連點右鍵。")
    else:
        f6_active.set()
        print(f"F6：開始在固定位置 {f6_pos(cfg)} 連點右鍵（再按 F6 停止）。")
        threading.Thread(target=f6_loop, args=(cfg,), daemon=True).start()


def on_reset_f6(cfg):
    f6_active.clear()
    threading.Thread(target=record_f6, args=(cfg,), daemon=True).start()


def hotkey_loop(cfg, dry_run, debug):
    keyboard.add_hotkey("f1", lambda: on_start_trade(cfg, dry_run, debug, F1_COUNT))
    keyboard.add_hotkey("f2", lambda: on_start_trade(cfg, dry_run, debug, F2_COUNT))
    keyboard.add_hotkey("f3", lambda: on_start_trade(cfg, dry_run, debug, F3_COUNT, f3_detection(cfg)))
    keyboard.add_hotkey("f4", lambda: on_toggle_rightclick(cfg))
    keyboard.add_hotkey("f5", lambda: on_two_click(cfg))
    keyboard.add_hotkey("shift+f5", lambda: on_reset_two_click(cfg))
    keyboard.add_hotkey("f6", lambda: on_f6(cfg))
    keyboard.add_hotkey("shift+f6", lambda: on_reset_f6(cfg))
    two_set = bool(two_click_cfg(cfg).get("pos_a"))
    f6_set = bool(f6_pos(cfg))
    print("=" * 52)
    print("  點擊方式：" + ("Windows SendInput（遊戲相容）" if _USE_SENDINPUT else "pyautogui"))
    print("  熱鍵待命中：")
    print(f"    F1 = 開始搬運 綠球（{F1_COUNT} 顆）；搬運中再按一次 = 停止")
    print(f"    F2 = 開始搬運 綠球（{F2_COUNT} 顆）；搬運中再按一次 = 停止")
    print(f"    F3 = 開始搬運 粉紅道具（{F3_COUNT} 顆）；搬運中再按一次 = 停止")
    print("    F4 = 連點右鍵開／關（滑鼠停在要點的位置）")
    print("    F5 = 連續左鍵點兩個位置 開／關" + ("" if two_set else "（第一次按會先請你設定）"))
    print("    Shift+F5 = 重新設定 F5 的兩個位置")
    print("    F6 = 在固定位置連點右鍵 開／關" + ("" if f6_set else "（第一次按會先請你設定位置）"))
    print("    Shift+F6 = 重新設定 F6 的位置")
    print("    （滑鼠甩到螢幕左上角 = 緊急停止；要結束程式關掉視窗或 Ctrl+C）")
    print("=" * 52)
    try:
        while not exit_event.wait(0.2):
            pass
    except KeyboardInterrupt:
        pass
    finally:
        stop_event.set()
        rightclick_active.clear()
        two_click_active.clear()
        f6_active.clear()
        try:
            keyboard.clear_all_hotkeys()
        except Exception:
            pass
    print("程式結束。")


# ---------------------------------------------------------------------------
# 立即執行模式（--now）：保留原本的倒數行為，不靠熱鍵
# ---------------------------------------------------------------------------
def run_now(cfg, dry_run, debug):
    for i in range(int(cfg["timing"]["start_countdown"]), 0, -1):
        print(f"{i} 秒後開始…（把滑鼠甩到螢幕左上角可隨時中止）")
        time.sleep(1)
    do_run(cfg, dry_run=dry_run, debug=debug)


# 加速預設：覆蓋搬運相關的等待時間（不動 config 檔）
SPEED_PRESETS = {
    "fast":  {"move_duration": 0.05, "click_delay": 0.12, "between_items": 0.10, "click_hold": 0.03},
    "turbo": {"move_duration": 0.0,  "click_delay": 0.05, "between_items": 0.05, "click_hold": 0.02},
}


def apply_speed(cfg, level):
    preset = SPEED_PRESETS.get(level)
    if not preset:
        return
    cfg["timing"].update(preset)
    print(f"已套用加速：{level}（move={preset['move_duration']}, "
          f"拿起後等={preset['click_delay']}, 每顆間隔={preset['between_items']} 秒）")


def main():
    parser = argparse.ArgumentParser(description="遊戲交易自動精靈")
    parser.add_argument("--now", action="store_true", help="不等 F3，倒數後直接執行一次")
    parser.add_argument("--dry-run", action="store_true", help="只偵測並移動滑鼠示範，不真的點擊")
    parser.add_argument("--debug", action="store_true", help="另存 debug_view.png，畫出偵測結果")
    parser.add_argument("--fast", action="store_true", help="加速搬運（較快，通常仍穩）")
    parser.add_argument("--turbo", action="store_true", help="極速搬運（最快，太快可能有些沒點到）")
    parser.add_argument("--count", type=int, default=None, help="這次搬幾顆（覆蓋 config 的 max_items）")
    args = parser.parse_args()

    cfg = load_config()
    if args.turbo:
        apply_speed(cfg, "turbo")
    elif args.fast:
        apply_speed(cfg, "fast")
    if args.count is not None:
        cfg["max_items"] = args.count
        print(f"這次最多搬 {args.count} 顆。")

    if args.now or keyboard is None:
        if keyboard is None and not args.now:
            print("提醒：沒安裝 keyboard 套件，無法用 F1/F2 熱鍵，改用倒數模式執行一次。")
            print("      想用熱鍵請執行：pip install keyboard")
        try:
            run_now(cfg, dry_run=args.dry_run, debug=args.debug)
        except KeyboardInterrupt:
            print("\n已手動中止（Ctrl + C）。")
        return

    hotkey_loop(cfg, args.dry_run, args.debug)


if __name__ == "__main__":
    main()
