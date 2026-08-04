# -*- coding: utf-8 -*-
"""
遊戲交易自動精靈 —— 主程式

流程（對應你的需求）：
  1. 偵測右邊「道具」背包裡哪幾格有綠色球（S.EXP）。
  2. 左鍵點一下那顆球（拿起來）。
  3. 移到左邊「交易」視窗的空格，左鍵點一下（放上去）。
  4. 重複，最多放 8 個（可在 config.json 調整）。

熱鍵（系統級，焦點在遊戲上也有效）：
  F1 = 左鍵依序點兩個位置（第一次按會請你設定，之後記住）；Shift+F1 重新設定
  F2 = 連點右鍵開／關（在滑鼠當前位置一直點右鍵，再按一次停止）
  F3 = 立刻開始搬運
  F4 = 停止所有（停搬運＋停連點右鍵；都沒在跑時再按一次離開程式）

偵測方式：用顏色判斷。綠色球是偏黃綠／橄欖綠，空格是深藍色，
兩者差很多，所以用 HSV 色相範圍就能分辨哪格有球。

其他安全機制：
  - pyautogui 內建 failsafe：把滑鼠快速甩到螢幕「左上角」會立刻中止。
  - 終端機按 Ctrl + C 也能結束程式。

用法：
  python trade_bot.py            開啟熱鍵待命（F3 開始搬運 / F4 停止所有）
  python trade_bot.py --now      不等熱鍵，倒數後直接執行一次搬運
  python trade_bot.py --dry-run  只偵測、不點擊（滑鼠會移過去給你看，驗證有沒有抓對）
  python trade_bot.py --debug    另外存一張 debug 圖，畫出每格有沒有抓到球
"""

import argparse
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
    import keyboard  # 系統級熱鍵（F1/F2）
except ImportError:
    keyboard = None


HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.json")

# 執行控制用的旗標
stop_event = threading.Event()     # 被設定 = 立刻停止目前這次搬運
exit_event = threading.Event()     # 被設定 = 整個程式結束
busy_lock = threading.Lock()       # 確保同時只跑一次搬運
rightclick_active = threading.Event()  # 被設定 = 連點右鍵(F2)進行中


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


def detect_items(img_bgr, cells, det):
    """回傳每格是否有球的清單：[(有無, 比例), ...]。"""
    return [(cell_fill_ratio(img_bgr, c, det) >= det["fill_ratio"],
             cell_fill_ratio(img_bgr, c, det)) for c in cells]


def find_first_item(img_bgr, cells, det):
    """找出第一個有球的格子中心座標；沒有就回傳 None。"""
    for c in cells:
        if cell_fill_ratio(img_bgr, c, det) >= det["fill_ratio"]:
            return c
    return None


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
    pyautogui.click()


# ---------------------------------------------------------------------------
# 核心搬運流程（會頻繁檢查 stop_event，讓 F2 立刻生效）
# ---------------------------------------------------------------------------
def run_sequence(cfg, dry_run=False, debug=False):
    inv_cells = grid_cells(cfg["inventory"])
    trade_cells = grid_cells(cfg["trade"])
    det = cfg["detection"]
    timing = cfg["timing"]
    max_items = min(int(cfg.get("max_items", 8)), len(trade_cells))

    pyautogui.FAILSAFE = True  # 滑鼠甩到左上角 = 緊急停止
    pyautogui.PAUSE = 0.0

    with mss.mss() as sct:
        img = grab_screen(sct)

        if debug:
            save_debug(img, inv_cells, trade_cells, det, os.path.join(HERE, "debug_view.png"))

        detected = sum(1 for c in inv_cells if cell_fill_ratio(img, c, det) >= det["fill_ratio"])
        print(f"目前背包偵測到 {detected} 顆球，本次最多搬 {max_items} 顆。")
        if detected == 0:
            print("沒有偵測到任何球。若確定畫面上有球，請調整 config.json 的 detection，"
                  "或先跑 python trade_bot.py --debug 看抓取情形。")
            return

        placed = 0
        for slot_index in range(max_items):
            if stop_event.is_set():
                print("收到停止指令，中斷搬運。")
                break

            img = grab_screen(sct)  # 每次搬運前重新抓畫面（球會越搬越少）
            item = find_first_item(img, inv_cells, det)
            if item is None:
                print("背包已經沒有球了，提前結束。")
                break

            target = trade_cells[slot_index]
            print(f"[{placed + 1}/{max_items}] 拿球 {item} → 放到交易格 {target}")

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


def do_run(cfg, dry_run=False, debug=False):
    """包一層：避免重複觸發、處理 failsafe，跑完自動解除忙碌狀態。"""
    if not busy_lock.acquire(blocking=False):
        print("（正在搬運中，忽略這次 F1）")
        return
    try:
        stop_event.clear()
        run_sequence(cfg, dry_run=dry_run, debug=debug)
    except pyautogui.FailSafeException:
        print("\n偵測到滑鼠移到左上角，已緊急中止。")
    finally:
        stop_event.clear()
        busy_lock.release()


# ---------------------------------------------------------------------------
# 熱鍵設定（新版對應）
#   F1 = 左鍵依序點兩個位置（Shift+F1 重新設定）
#   F2 = 連點右鍵 開／關
#   F3 = 立刻開始搬運
#   F4 = 停止所有（停搬運＋停連點右鍵；都沒在跑時再按一次離開程式）
# ---------------------------------------------------------------------------

# 讀取設定（相容舊 config 的鍵名）
def two_click_cfg(cfg):
    return cfg.get("two_click") or cfg.get("f4") or {}


def rightclick_interval(cfg):
    t = cfg["timing"]
    return t.get("rightclick_interval", t.get("f3_interval", 0.1))


def two_click_gap(cfg):
    t = cfg["timing"]
    return t.get("two_click_gap", t.get("f4_gap", 0.15))


# ---------- F3：立刻開始搬運 ----------
def on_start_trade(cfg, dry_run, debug):
    if busy_lock.locked():
        print("（正在搬運中，忽略這次 F3）")
        return
    threading.Thread(target=do_run, args=(cfg, dry_run, debug), daemon=True).start()


# ---------- F4：停止所有 ----------
def on_stop_all():
    stopped = False
    if busy_lock.locked():
        stop_event.set()
        stopped = True
    if rightclick_active.is_set():
        rightclick_active.clear()
        stopped = True
    if stopped:
        print("F4：停止所有動作。")
    else:
        print("F4：目前沒有進行中的動作，離開程式。")
        exit_event.set()


# ---------- F2：連點右鍵（開關） ----------
def rightclick_loop(cfg):
    interval = rightclick_interval(cfg)
    try:
        while rightclick_active.is_set() and not exit_event.is_set():
            pyautogui.click(button="right")
            end = time.time() + interval
            while time.time() < end:
                if not rightclick_active.is_set() or exit_event.is_set():
                    return
                time.sleep(0.01)
    except pyautogui.FailSafeException:
        print("F2：偵測到滑鼠到左上角，已停止連點右鍵。")
        rightclick_active.clear()


def on_toggle_rightclick(cfg):
    if rightclick_active.is_set():
        rightclick_active.clear()
        print("F2：停止連點右鍵。")
    else:
        rightclick_active.set()
        print("F2：開始連點右鍵（滑鼠停在要點的地方；再按 F2 或 F4 停止）。")
        threading.Thread(target=rightclick_loop, args=(cfg,), daemon=True).start()


# ---------- F1：左鍵依序點兩個位置 ----------
def wait_enter_press():
    """輪詢等一次新的 Enter 按下（給設定用，不與熱鍵衝突）。回傳 False 代表程式要結束。"""
    while keyboard.is_pressed("enter"):        # 先等放開
        if exit_event.is_set():
            return False
        time.sleep(0.01)
    while not keyboard.is_pressed("enter"):    # 再等按下
        if exit_event.is_set():
            return False
        time.sleep(0.01)
    while keyboard.is_pressed("enter"):        # 去彈跳
        time.sleep(0.01)
    return True


def record_two_click(cfg):
    if keyboard is None:
        print("F1 兩點設定需要 keyboard 套件。")
        return
    print("\n== 設定 F1 的兩個左鍵位置 ==")
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
    cfg.pop("f4", None)  # 清掉舊鍵名
    save_config(cfg)
    print("F1 兩點設定完成並已記住。之後按 F1 就會左鍵依序點這兩個位置；要重設按 Shift+F1。\n")


def do_two_click(cfg):
    pos = two_click_cfg(cfg)
    a, b = pos["pos_a"], pos["pos_b"]
    d = cfg["timing"].get("move_duration", 0.15)
    gap = two_click_gap(cfg)
    try:
        pyautogui.moveTo(a[0], a[1], duration=d)
        pyautogui.click()
        time.sleep(gap)
        pyautogui.moveTo(b[0], b[1], duration=d)
        pyautogui.click()
        print(f"F1：已左鍵點 {a} → {b}")
    except pyautogui.FailSafeException:
        print("F1：偵測到滑鼠到左上角，已中止。")


def on_two_click(cfg):
    pos = two_click_cfg(cfg)
    if not pos.get("pos_a") or not pos.get("pos_b"):
        threading.Thread(target=record_two_click, args=(cfg,), daemon=True).start()
    else:
        threading.Thread(target=do_two_click, args=(cfg,), daemon=True).start()


def on_reset_two_click(cfg):
    threading.Thread(target=record_two_click, args=(cfg,), daemon=True).start()


def hotkey_loop(cfg, dry_run, debug):
    keyboard.add_hotkey("f1", lambda: on_two_click(cfg))
    keyboard.add_hotkey("shift+f1", lambda: on_reset_two_click(cfg))
    keyboard.add_hotkey("f2", lambda: on_toggle_rightclick(cfg))
    keyboard.add_hotkey("f3", lambda: on_start_trade(cfg, dry_run, debug))
    keyboard.add_hotkey("f4", on_stop_all)
    two_set = bool(two_click_cfg(cfg).get("pos_a"))
    print("=" * 52)
    print("  熱鍵待命中：")
    print("    F1 = 左鍵依序點兩個位置" + ("" if two_set else "（第一次按會先請你設定）"))
    print("    Shift+F1 = 重新設定 F1 的兩個位置")
    print("    F2 = 連點右鍵開／關（滑鼠停在要點的位置）")
    print("    F3 = 立刻開始搬運")
    print("    F4 = 停止所有（都沒在跑時，再按 F4 離開程式）")
    print("    （滑鼠甩到螢幕左上角 = 緊急停止；Ctrl+C 也能結束）")
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


def main():
    parser = argparse.ArgumentParser(description="遊戲交易自動精靈")
    parser.add_argument("--now", action="store_true", help="不等 F1，倒數後直接執行一次")
    parser.add_argument("--dry-run", action="store_true", help="只偵測並移動滑鼠示範，不真的點擊")
    parser.add_argument("--debug", action="store_true", help="另存 debug_view.png，畫出偵測結果")
    args = parser.parse_args()

    cfg = load_config()

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
