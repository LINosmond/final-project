# -*- coding: utf-8 -*-
"""
修正顏色偵測範圍 —— 一鍵把 config.json 的 detection 調成適合 S.EXP 球。

用途：Angels Online 這類遊戲的背包「空格是青綠色」，會被舊的寬顏色範圍
誤判成球。跑這支就把範圍收窄（只抓橄欖黃綠色的球、排除青綠空格），
不用自己手動改 config.json。

用法：
  python fix_color.py

改完建議跑 python trade_bot.py --debug 確認：
  空格應該變 ~0.00（紅圈）、S.EXP 球 ~0.2 以上（綠圈）。
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.json")

# 適合 S.EXP 球（橄欖黃綠）、排除青綠色空格的範圍
NEW = {
    "hue_min": 15,
    "hue_max": 50,
    "sat_min": 60,
    "val_min": 60,
    "fill_ratio": 0.12,
    "sample_size": 40,
}


def main():
    if not os.path.exists(CONFIG_PATH):
        print("找不到 config.json，請先跑 python calibrate.py 校正。")
        return
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    det = cfg.get("detection", {})
    old = {k: det.get(k) for k in NEW}
    det.update(NEW)
    det["_說明"] = ("抓 S.EXP 球的橄欖黃綠色，排除青綠色空格。"
                    "hue_max 太大會把青綠空格也當成球。")
    cfg["detection"] = det

    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

    print("已更新顏色偵測範圍：")
    print(f"  舊：{old}")
    print(f"  新：{NEW}")
    print("\n請跑：python trade_bot.py --debug")
    print("確認空格變 ~0.00（紅圈）、S.EXP 球 ~0.2 以上（綠圈）。")


if __name__ == "__main__":
    main()
