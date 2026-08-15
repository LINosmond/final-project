# -*- coding: utf-8 -*-
"""
校正工具 —— 產生 config.json

兩種模式：

【完整校正】第一次用，或換了螢幕解析度／視窗位置時用。
  會請你指出每個區域的三個角落，算出整個格陣的間距。

【快速校正】做過一次完整校正後，程式會記住格子間距與兩個視窗的相對位置。
  之後只要指「道具背包左上角那一格」按一下 Enter，就能重新對位，開始使用。

記點方式：把滑鼠移到格子正中央，直接按 Enter 就記錄（不用切回終端機）。
  ——這需要 keyboard 套件（requirements.txt 已含）。若按 Enter 沒反應，
    請用「系統管理員身分」執行，或它會自動退回「回終端機按 Enter」的舊方式。

用法：
  python calibrate.py          有舊設定就問你要快速還是完整；沒有就直接完整校正
  python calibrate.py --full   強制完整校正
"""

import argparse
import json
import os
import sys
import time


# 先固定 DPI 感知（要在 import pyautogui / mss 之前），讓校正記的座標和執行時一致。
def _make_dpi_aware():
    if sys.platform != "win32":
        return
    try:
        import ctypes
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass


_make_dpi_aware()

try:
    import pyautogui
except ImportError:
    sys.exit("缺少套件 pyautogui，請先執行：pip install -r requirements.txt")

try:
    import keyboard  # 用來全域攔截 Enter，滑鼠放好直接按就記點
except ImportError:
    keyboard = None

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.json")


# ---------------------------------------------------------------------------
# 記點：滑鼠放好，按 Enter 就記錄（不用回終端機）
# ---------------------------------------------------------------------------
def capture_point(prompt):
    print(f"  → {prompt}")
    if keyboard is not None:
        print("    把滑鼠移到格子正中央後，直接按 Enter 記錄…")
        try:
            # 先等 Enter 放開，避免沿用上一個動作殘留的 Enter
            while keyboard.is_pressed("enter"):
                time.sleep(0.01)
            keyboard.wait("enter")           # 全域等待新的一次 Enter
            x, y = pyautogui.position()
            while keyboard.is_pressed("enter"):
                time.sleep(0.01)
            time.sleep(0.15)                 # 去彈跳，避免一次記到兩點
        except Exception:
            # keyboard 有問題（例如權限不足）就退回終端機方式
            input("    （熱鍵無法使用）移好滑鼠後，回這裡按 Enter…")
            x, y = pyautogui.position()
    else:
        input("    移好滑鼠後，回這裡按 Enter…")
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


# ---------------------------------------------------------------------------
# 完整校正：指三個角落，算出間距
# ---------------------------------------------------------------------------
def full_calibrate_grid(title, first_cell, tr, bl, cols, rows):
    col_step = (tr[0] - first_cell[0]) / (cols - 1) if cols > 1 else 0
    row_step = (bl[1] - first_cell[1]) / (rows - 1) if rows > 1 else 0
    grid = {
        "first_cell": first_cell,
        "cols": cols,
        "rows": rows,
        "col_step": round(col_step, 2),
        "row_step": round(row_step, 2),
    }
    print(f"  {title}：起點 {first_cell}，每欄間距 {grid['col_step']}，每列間距 {grid['row_step']}\n")
    return grid


def do_full_calibration():
    print("\n===== 完整校正 =====")
    print("先在終端機回答幾個數字，等一下就只用『滑鼠 + Enter』指角落。\n")

    inv_cols = ask_int("右邊【道具背包】綠球區有幾『欄』(直排)", 10)
    inv_rows = ask_int("右邊【道具背包】綠球區有幾『列』(橫排，只算有球的，不算最底下禮物格)", 4)
    tr_cols = ask_int("左邊【交易視窗】自己空格區有幾『欄』", 4)
    tr_rows = ask_int("左邊【交易視窗】自己空格區有幾『列』", 2)
    max_items = ask_int("一次最多搬幾個", 7)

    print("\n接下來只用滑鼠 + Enter（不用回終端機）。請依提示把滑鼠移到格子正中央後按 Enter。\n")

    print("— 右邊【道具背包】—")
    inv_tl = capture_point("道具背包：左上角第一格 的正中央")
    inv_tr = capture_point("道具背包：第一列最右邊那格 的正中央")
    inv_bl = capture_point("道具背包：第一欄最下面那格 的正中央")

    print("— 左邊【交易視窗】自己的空格 —")
    tr_tl = capture_point("交易視窗：左上角第一格 的正中央")
    tr_tr = capture_point("交易視窗：第一列最右邊那格 的正中央")
    tr_bl = capture_point("交易視窗：第一欄最下面那格 的正中央")

    inventory = full_calibrate_grid("道具背包", inv_tl, inv_tr, inv_bl, inv_cols, inv_rows)
    trade = full_calibrate_grid("交易視窗", tr_tl, tr_tr, tr_bl, tr_cols, tr_rows)

    # 記住兩視窗左上角的相對位移，之後快速校正只要指一個點
    offset = [trade["first_cell"][0] - inventory["first_cell"][0],
              trade["first_cell"][1] - inventory["first_cell"][1]]

    return inventory, trade, max_items, offset


# ---------------------------------------------------------------------------
# 快速校正：只指道具背包左上角，其他沿用上次
# ---------------------------------------------------------------------------
def do_quick_calibration(old):
    print("\n===== 快速校正 =====")
    print("沿用上次的格子間距與欄列數，只要各指一個點重新對位：")
    print("  1) 道具背包 左上角那一格   2) 交易視窗 左上角那一格\n")

    inv_tl = capture_point("道具背包：左上角第一格 的正中央")
    tr_tl = capture_point("交易視窗：左上角第一格 的正中央")

    inventory = dict(old["inventory"])
    inventory["first_cell"] = inv_tl

    trade = dict(old["trade"])
    trade["first_cell"] = tr_tl

    max_items = old.get("max_items", 8)
    offset = [tr_tl[0] - inv_tl[0], tr_tl[1] - inv_tl[1]]  # 順便更新相對位移
    print(f"  已依上次間距重建格陣：道具起點 {inv_tl}、交易起點 {tr_tl}\n")
    return inventory, trade, max_items, offset


# ---------------------------------------------------------------------------
# 組裝並存檔
# ---------------------------------------------------------------------------
def build_config(inventory, trade, max_items, offset, old=None):
    detection = (old or {}).get("detection", {
        "_說明": "抓 S.EXP 球的橄欖黃綠色，排除青綠色空格。hue_max 太大會把青綠空格也當成球。"
                 "若抓不到或誤判，微調 hue/sat/val/fill_ratio，跑 trade_bot.py --debug 觀察。",
        "hue_min": 15, "hue_max": 50, "sat_min": 60, "val_min": 60,
        "fill_ratio": 0.12, "sample_size": 40,
    })
    timing = (old or {}).get("timing", {
        "start_countdown": 3, "move_duration": 0.15,
        "click_delay": 0.35, "between_items": 0.5,
        "rightclick_interval": 0.1, "two_click_gap": 0.15,
        "click_hold": 0.03,
    })
    timing.setdefault("rightclick_interval", timing.pop("f3_interval", 0.1))  # F2 連點右鍵間隔（秒）
    timing.setdefault("two_click_gap", timing.pop("f4_gap", 0.15))            # F1 兩點之間間隔（秒）
    timing.setdefault("two_click_loop_gap", timing.get("two_click_gap", 0.15))  # F1 每輪之間間隔（秒）
    timing.setdefault("click_hold", 0.03)  # 每次點擊「按下→放開」之間停留（秒），太快遊戲收不到就調大
    quantity = (old or {}).get("quantity", {
        "_說明": "若點道具後會跳『數量』視窗，把 confirm_with_enter 改成 true，會自動按 Enter 確認。",
        "confirm_with_enter": False, "enter_delay": 0.3,
    })
    # 相容舊鍵名 f4
    two_click = (old or {}).get("two_click") or (old or {}).get("f4") or {"pos_a": None, "pos_b": None}
    two_click.pop("_說明", None)
    return {
        "inventory": inventory,
        "trade": trade,
        "max_items": max_items,
        "_quick": {
            "_說明": "記住兩視窗左上角的相對位移，供『快速校正』只指一個點用。",
            "offset_trade_from_inv": offset,
        },
        "two_click": {
            "_說明": "F1 左鍵依序點的兩個位置；null 代表還沒設定，第一次按 F1 會請你設定。",
            "pos_a": two_click.get("pos_a"),
            "pos_b": two_click.get("pos_b"),
        },
        "detection": detection,
        "timing": timing,
        "quantity": quantity,
    }


def load_old():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
    return None


def main():
    parser = argparse.ArgumentParser(description="校正工具")
    parser.add_argument("--full", action="store_true", help="強制完整校正")
    args = parser.parse_args()

    print("=" * 60)
    print("  遊戲交易自動精靈 —— 校正工具")
    print("=" * 60)
    if keyboard is None:
        print("（提醒：沒裝 keyboard 套件，記點要回終端機按 Enter。想要放好滑鼠直接按 Enter，"
              "請先 pip install keyboard）")
    print("\n請先把遊戲切到『交易視窗 + 道具背包同時打開、都沒被擋住』的狀態。")

    old = load_old()
    can_quick = bool(old and old.get("_quick", {}).get("offset_trade_from_inv"))

    if args.full or not can_quick:
        if not can_quick and old:
            print("（舊設定沒有間距資料，這次先做一次完整校正。）")
        input("\n準備好後按 Enter 開始…")
        inventory, trade, max_items, offset = do_full_calibration()
    else:
        print("\n偵測到上次的設定。要用哪一種？")
        print("  [Enter] 快速校正：只指『背包左上角』+『交易視窗左上角』兩個點，其他沿用上次（最快）")
        print("  [F]     完整校正：重新指所有角落（換了視窗位置或解析度時用）")
        choice = input("選擇（直接 Enter = 快速）：").strip().lower()
        if choice == "f":
            inventory, trade, max_items, offset = do_full_calibration()
        else:
            inventory, trade, max_items, offset = do_quick_calibration(old)

    config = build_config(inventory, trade, max_items, offset, old)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    print("=" * 60)
    print(f"已存好設定：{CONFIG_PATH}")
    print("=" * 60)

    # 順便設定交易點位（F7 收交易 / F8 提交易）
    ans = input(
        "\n要不要順便設定『交易點位』(F7 自動交易 / F8 提起交易端)？\n"
        "  需要現在把『交易視窗』打開、看得到準備/確認鈕。\n"
        "  設定（直接 Enter=設定 / n=跳過）："
    ).strip().lower()
    if ans != "n":
        try:
            import trade_bot  # 重用主程式的交易點位設定（含拍準備鈕樣板）
            trade_bot.setup_trade_points(config, include_accept=True)
        except SystemExit as e:
            print(f"（設定交易點位需要的套件缺少：{e}）")
        except Exception as e:
            print(f"（設定交易點位時發生問題，已跳過：{e}）")

    print(
        "\n建議先『空跑』確認有沒有抓對（不會真的點）：\n"
        "  python trade_bot.py --dry-run\n\n"
        "看偵測圖：\n"
        "  python trade_bot.py --debug\n\n"
        "正式執行（按 F1 開始 / F2 停止；F7 收交易；F8 提交易）：\n"
        "  python trade_bot.py\n"
    )


if __name__ == "__main__":
    main()
