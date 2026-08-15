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


def _save_grid(inventory, trade, max_items, offset, old):
    config = build_config(inventory, trade, max_items, offset, old)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    print("✅ 背包 + 交易格 已存檔。\n")
    return config


def run_full_grid(old):
    inv, tr, mx, off = do_full_calibration()
    return _save_grid(inv, tr, mx, off, old)


def run_quick_grid(old):
    if not (old and old.get("_quick", {}).get("offset_trade_from_inv")):
        print("（沒有舊的間距資料，改做一次完整校正。）")
        return run_full_grid(old)
    inv, tr, mx, off = do_quick_calibration(old)
    return _save_grid(inv, tr, mx, off, old)


def _load_trade_bot():
    """載入主程式模組（拿它的分區交易點位設定）。缺套件就回 None。"""
    try:
        import trade_bot
        return trade_bot
    except SystemExit as e:
        print(f"（交易點位設定需要的套件缺少：{e}）")
    except Exception as e:
        print(f"（載入交易點位設定失敗：{e}）")
    return None


def main():
    parser = argparse.ArgumentParser(description="校正工具")
    parser.add_argument("--full", action="store_true", help="直接做一次完整背包/交易格校正")
    args = parser.parse_args()

    print("=" * 60)
    print("  遊戲交易自動精靈 —— 校正工具（分區校正，做錯只重那一區）")
    print("=" * 60)
    if keyboard is None:
        print("（提醒：沒裝 keyboard 套件，記點要回終端機按 Enter。"
              "想放好滑鼠直接按 Enter，請先 pip install keyboard）")
    print("記點方式：把滑鼠移到定位 → 直接按 Enter 記錄。")

    tb = _load_trade_bot()

    if args.full:
        run_full_grid(load_old())

    while True:
        old = load_old()
        has_grid = bool(old and old.get("inventory") and old.get("trade"))
        f7 = (old or {}).get("f7", {}) if old else {}

        def mark(cond):
            return "✅" if cond else "⭕"

        print("\n" + "=" * 60)
        print("  要校正哪一區？（輸入數字，做錯只要重做那一區）")
        print("  —— 背包 / 交易格 ——")
        print(f"   [1] 完整校正 背包+交易格（第一次必做／換螢幕解析度）  {mark(has_grid)}")
        print("   [2] 快速對位 背包+交易格（沿用間距，只指兩個左上角）")
        print("  —— 交易點位（F7 收交易 / F8 提交易）——")
        print(f"   [3] 交易請求（接受鈕，F7 收交易；需有交易邀請視窗）   {mark(f7.get('accept_btn'))}")
        print(f"   [4] 前置點（F8 右鍵→左鍵）                          {mark(f7.get('preclick_rpos'))}")
        print(f"   [5] 準備交易鈕                                      {mark(f7.get('prepare_btn'))}")
        print(f"   [6] 確認鈕                                          {mark(f7.get('confirm_btn'))}")
        print(f"   [7] 對方橘燈                                        {mark(f7.get('orange_pos'))}")
        print("   [8] 交易點位 全部（3~7 一次做完）")
        print("  —— ——")
        print("   [0] 完成，離開")
        choice = input("選擇：").strip().lower()

        if choice in ("0", "q", "", "exit"):
            break
        if choice == "1":
            run_full_grid(old)
            continue
        if choice == "2":
            run_quick_grid(old)
            continue
        if choice in ("3", "4", "5", "6", "7", "8"):
            if not has_grid:
                print("⚠️ 還沒校正過背包/交易格，請先做 [1] 完整校正。")
                continue
            if tb is None:
                print("⚠️ 載入交易點位設定失敗（可能缺套件），無法設定這區。")
                continue
            cfg = load_old()
            try:
                if choice == "3":
                    tb.setup_accept(cfg)
                elif choice == "4":
                    tb.setup_preclick(cfg)
                elif choice == "5":
                    tb.setup_prepare(cfg)
                elif choice == "6":
                    tb.setup_confirm(cfg)
                elif choice == "7":
                    tb.setup_orange(cfg)
                elif choice == "8":
                    tb.setup_trade_points(cfg, include_accept=True)
            except Exception as e:
                print(f"（這區設定中途出錯，已跳過：{e}）")
            continue
        print("看不懂這個選項，請輸入 0~8。")

    print("\n" + "=" * 60)
    print("  校正結束。建議先確認有沒有抓對：")
    print("    python trade_bot.py --debug     # 看綠圈有沒有框到球")
    print("    python trade_bot.py --dry-run   # 只移動示範、不真的點")
    print("  正式執行：雙擊 執行.bat（F1~F3 搬球 / F7 收交易 / F8 提交易）")
    print("=" * 60)


if __name__ == "__main__":
    main()
