# -*- coding: utf-8 -*-
"""
遊戲交易自動精靈 —— 主程式

流程（對應你的需求）：
  1. 啟動時拍一張照，找出右邊「道具」背包裡所有有綠色球（S.EXP）的格子。
  2. 從這些球裡「隨機挑」不重複的 N 顆（F1=7、F2=8，可在程式頂端 F1_COUNT/F2_COUNT 調整）。
  3. 依序：左鍵點該球（拿起）→ 左鍵點交易視窗空格（放上）。
  （因為放上交易後背包的球不會消失，所以用啟動時那張照的固定清單，途中不再重新偵測。）

熱鍵（系統級，焦點在遊戲上也有效）：
  F1 = 開始搬運（7 顆）；搬運中再按一次 = 停止
  F2 = 開始搬運（8 顆）；搬運中再按一次 = 停止
  F3 = 開始搬運（8 顆）；搬運中再按一次 = 停止
  F4 = 連點右鍵開／關（在滑鼠當前位置一直點右鍵，再按一次停止）

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
rightclick_active = threading.Event()  # 被設定 = 連點右鍵(F3)進行中


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
def run_sequence(cfg, dry_run=False, debug=False, count=None):
    inv_cells = grid_cells(cfg["inventory"])
    trade_cells = grid_cells(cfg["trade"])
    det = cfg["detection"]
    timing = cfg["timing"]
    want = count if count is not None else int(cfg.get("max_items", 8))
    max_items = min(int(want), len(trade_cells))

    pyautogui.FAILSAFE = True  # 滑鼠甩到左上角 = 緊急停止
    pyautogui.PAUSE = 0.0

    with mss.mss() as sct:
        img = grab_screen(sct)

        if debug:
            save_debug(img, inv_cells, trade_cells, det, os.path.join(HERE, "debug_view.png"))

        # 啟動時就拍這一張照，找出所有有球的格子。
        # （放上交易後背包的球不會消失，所以不再每次重新偵測，改用這份固定清單。）
        all_balls = detect_ball_cells(img, inv_cells, det)
        print(f"目前背包偵測到 {len(all_balls)} 顆球，本次最多搬 {max_items} 顆。")
        if not all_balls:
            print("沒有偵測到任何球。若確定畫面上有球，請調整 config.json 的 detection，"
                  "或先跑 python trade_bot.py --debug 看抓取情形。")
            return

        # 從偵測到的球裡「隨機挑」不重複的 max_items 顆，一開始就固定下來。
        chosen = random.sample(all_balls, min(max_items, len(all_balls)))
        print(f"隨機挑了 {len(chosen)} 顆來搬。")

        placed = 0
        for slot_index, item in enumerate(chosen):
            if stop_event.is_set():
                print("收到停止指令，中斷搬運。")
                break

            target = trade_cells[slot_index]
            print(f"[{placed + 1}/{len(chosen)}] 拿球 {item} → 放到交易格 {target}")

            if dry_run:
                pyautogui.moveTo(item[0], item[1], duration=timing["move_duration"])
                if sleep_interruptible(0.25):
                    break
                pyautogui.moveTo(target[0], target[1], duration=timing["move_duration"])
                if sleep_interruptible(timing["between_items"]):
                    break
                placed += 1
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
            placed += 1
            if sleep_interruptible(timing["between_items"]):
                break

        print(f"本次結束，共搬了 {placed} 顆。")


def do_run(cfg, dry_run=False, debug=False, count=None):
    """包一層：避免重複觸發、處理 failsafe，跑完自動解除忙碌狀態。"""
    if not busy_lock.acquire(blocking=False):
        print("（正在搬運中，忽略這次）")
        return
    try:
        stop_event.clear()
        run_sequence(cfg, dry_run=dry_run, debug=debug, count=count)
    except pyautogui.FailSafeException:
        print("\n偵測到滑鼠移到左上角，已緊急中止。")
    finally:
        stop_event.clear()
        busy_lock.release()


# ---------------------------------------------------------------------------
# 熱鍵設定（v2）
#   F1 = 立刻開始搬運（F1_COUNT 顆）；搬運中再按一次 = 停止
#   F2 = 立刻開始搬運（F2_COUNT 顆）；搬運中再按一次 = 停止
#   F3 = 立刻開始搬運（F3_COUNT 顆）；搬運中再按一次 = 停止
#   F4 = 連點右鍵 開／關（單鍵開關）
# ---------------------------------------------------------------------------
F1_COUNT = 7   # F1 一次搬幾顆
F2_COUNT = 8   # F2 一次搬幾顆
F3_COUNT = 8   # F3 一次搬幾顆


def rightclick_interval(cfg):
    t = cfg["timing"]
    return t.get("rightclick_interval", t.get("f3_interval", 0.1))


# ---------- F1 / F2：開始搬運（不同顆數）；搬運中再按一次就停 ----------
def on_start_trade(cfg, dry_run, debug, count):
    if busy_lock.locked():
        stop_event.set()
        print("停止搬運。")
        return
    threading.Thread(target=do_run, args=(cfg, dry_run, debug, count), daemon=True).start()


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
        print("F4：停止連點右鍵。")
    else:
        rightclick_active.set()
        print("F4：開始連點右鍵（滑鼠停在要點的地方；再按 F4 停止）。")
        threading.Thread(target=rightclick_loop, args=(cfg,), daemon=True).start()


def hotkey_loop(cfg, dry_run, debug):
    keyboard.add_hotkey("f1", lambda: on_start_trade(cfg, dry_run, debug, F1_COUNT))
    keyboard.add_hotkey("f2", lambda: on_start_trade(cfg, dry_run, debug, F2_COUNT))
    keyboard.add_hotkey("f3", lambda: on_start_trade(cfg, dry_run, debug, F3_COUNT))
    keyboard.add_hotkey("f4", lambda: on_toggle_rightclick(cfg))
    print("=" * 52)
    print("  點擊方式：" + ("Windows SendInput（遊戲相容）" if _USE_SENDINPUT else "pyautogui"))
    print("  熱鍵待命中：")
    print(f"    F1 = 開始搬運（{F1_COUNT} 顆）；搬運中再按一次 = 停止")
    print(f"    F2 = 開始搬運（{F2_COUNT} 顆）；搬運中再按一次 = 停止")
    print(f"    F3 = 開始搬運（{F3_COUNT} 顆）；搬運中再按一次 = 停止")
    print("    F4 = 連點右鍵開／關（滑鼠停在要點的位置）")
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
