# -*- coding: utf-8 -*-
"""
遊戲交易自動精靈 —— 主程式

流程（對應你的需求）：
  1. 偵測右邊「道具」背包裡哪幾格有綠色球（S.EXP）。
  2. 左鍵點一下那顆球（拿起來）。
  3. 移到左邊「交易」視窗的空格，左鍵點一下（放上去）。
  4. 重複，最多放 8 個（可在 config.json 調整）。

偵測方式：用顏色判斷。綠色球是偏黃綠／橄欖綠，空格是深藍色，
兩者差很多，所以用 HSV 色相範圍就能分辨哪格有球。

安全機制：
  - 開始前有倒數，來得及切到遊戲視窗。
  - pyautogui 內建 failsafe：把滑鼠快速甩到螢幕「左上角」會立刻中止。
  - 終端機按 Ctrl + C 也能停。

用法：
  python trade_bot.py            正式執行
  python trade_bot.py --dry-run  只偵測、不點擊（滑鼠會移過去給你看，驗證有沒有抓對）
  python trade_bot.py --debug    另外存一張 debug 圖，畫出每格有沒有抓到球
"""

import argparse
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


HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.json")


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
    return cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR), monitor


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
    out = []
    for c in cells:
        ratio = cell_fill_ratio(img_bgr, c, det)
        out.append((ratio >= det["fill_ratio"], ratio))
    return out


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
        has, ratio = detect_items(img_bgr, [c], det)[0]
        color = (0, 255, 0) if has else (0, 0, 255)
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
# 點擊流程
# ---------------------------------------------------------------------------
def click(x, y, cfg):
    pyautogui.moveTo(x, y, duration=cfg["timing"]["move_duration"])
    pyautogui.click()


def run(cfg, dry_run=False, debug=False):
    inv_cells = grid_cells(cfg["inventory"])
    trade_cells = grid_cells(cfg["trade"])
    det = cfg["detection"]
    timing = cfg["timing"]
    max_items = int(cfg.get("max_items", 8))
    max_items = min(max_items, len(trade_cells))

    pyautogui.FAILSAFE = True  # 滑鼠甩到左上角 = 緊急停止
    pyautogui.PAUSE = 0.0

    with mss.mss() as sct:
        img, _ = grab_screen(sct)

        if debug:
            save_debug(img, inv_cells, trade_cells, det, os.path.join(HERE, "debug_view.png"))

        detected = [c for c, (has, _) in zip(inv_cells, detect_items(img, inv_cells, det)) if has]
        print(f"目前背包偵測到 {len(detected)} 顆球，本次最多搬 {max_items} 顆。")
        if not detected:
            print("沒有偵測到任何球。若確定畫面上有球，請調整 config.json 的 detection，"
                  "或先跑 python trade_bot.py --debug 看抓取情形。")
            return

        # 開始前倒數，讓你切回遊戲視窗
        for i in range(int(timing["start_countdown"]), 0, -1):
            print(f"{i} 秒後開始…（把滑鼠甩到螢幕左上角可隨時中止）")
            time.sleep(1)

        placed = 0
        for slot_index in range(max_items):
            img, _ = grab_screen(sct)  # 每次搬運前重新抓畫面（球會越搬越少）
            item = find_first_item(img, inv_cells, det)
            if item is None:
                print("背包已經沒有球了，提前結束。")
                break

            target = trade_cells[slot_index]
            print(f"[{placed + 1}/{max_items}] 拿球 {item} → 放到交易格 {target}")

            if dry_run:
                # 只移動滑鼠讓你看，不真的點
                pyautogui.moveTo(item[0], item[1], duration=timing["move_duration"])
                time.sleep(0.25)
                pyautogui.moveTo(target[0], target[1], duration=timing["move_duration"])
                time.sleep(timing["between_items"])
                placed += 1
                continue

            # 1) 點背包的球（拿起）
            click(item[0], item[1], cfg)
            time.sleep(timing["click_delay"])

            # 2) 若有數量視窗，可選擇按 Enter 確認
            if cfg["quantity"]["confirm_with_enter"]:
                time.sleep(cfg["quantity"]["enter_delay"])
                pyautogui.press("enter")
                time.sleep(cfg["quantity"]["enter_delay"])

            # 3) 點交易視窗空格（放上）
            click(target[0], target[1], cfg)
            time.sleep(timing["between_items"])
            placed += 1

        print(f"完成，共搬了 {placed} 顆。")


def main():
    parser = argparse.ArgumentParser(description="遊戲交易自動精靈")
    parser.add_argument("--dry-run", action="store_true", help="只偵測並移動滑鼠示範，不真的點擊")
    parser.add_argument("--debug", action="store_true", help="另存 debug_view.png，畫出偵測結果")
    args = parser.parse_args()

    cfg = load_config()
    try:
        run(cfg, dry_run=args.dry_run, debug=args.debug)
    except pyautogui.FailSafeException:
        print("\n偵測到滑鼠移到左上角，已緊急中止。")
    except KeyboardInterrupt:
        print("\n已手動中止（Ctrl + C）。")


if __name__ == "__main__":
    main()
