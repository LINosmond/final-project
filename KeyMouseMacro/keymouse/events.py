"""事件資料模型與序列化。

每一筆錄製下來的動作都被表示成一個 dict，欄位如下：

    t      : float   從錄製開始到此事件經過的秒數（用來還原真實節奏）
    kind   : str     事件種類，見下方常數
    ...    :         各種類專屬的欄位

這個模組只負責「資料長什麼樣子」與「如何存成 / 讀回 JSON」，
不牽涉任何實際的鍵鼠操作，方便單獨測試。
"""

from __future__ import annotations

import json
from typing import Any, Dict, List

from pynput import keyboard, mouse

# ---- 事件種類常數 --------------------------------------------------------
KEY_PRESS = "key_press"
KEY_RELEASE = "key_release"
MOUSE_MOVE = "mouse_move"
MOUSE_CLICK = "mouse_click"
MOUSE_SCROLL = "mouse_scroll"

Event = Dict[str, Any]


# ---- 按鍵 <-> 可序列化字典 ------------------------------------------------
def key_to_dict(key) -> Dict[str, Any]:
    """把 pynput 的 Key / KeyCode 轉成可存成 JSON 的字典。"""
    if isinstance(key, keyboard.KeyCode):
        # 一般可列印字元，例如 'a'、'1'、'中'
        if key.char is not None:
            return {"type": "char", "char": key.char}
        # 少數只有 virtual key code 的情況
        return {"type": "vk", "vk": key.vk}
    if isinstance(key, keyboard.Key):
        # 特殊鍵，例如 space、enter、ctrl_l …
        return {"type": "key", "name": key.name}
    # 理論上不會走到這裡，保底
    return {"type": "char", "char": str(key)}


def dict_to_key(data: Dict[str, Any]):
    """key_to_dict 的反向操作，還原成 pynput 可用的物件。"""
    kind = data.get("type")
    if kind == "char":
        return keyboard.KeyCode.from_char(data["char"])
    if kind == "vk":
        return keyboard.KeyCode.from_vk(data["vk"])
    if kind == "key":
        return getattr(keyboard.Key, data["name"])
    raise ValueError(f"無法解析的按鍵資料: {data!r}")


# ---- 滑鼠按鍵 <-> 字串 ----------------------------------------------------
def button_to_str(button) -> str:
    return button.name  # 'left' / 'right' / 'middle'


def str_to_button(name: str):
    return getattr(mouse.Button, name)


# ---- 整份腳本的存 / 讀 ---------------------------------------------------
def save_script(events: List[Event], path: str) -> None:
    payload = {"version": 1, "events": events}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def load_script(path: str) -> List[Event]:
    with open(path, "r", encoding="utf-8") as f:
        payload = json.load(f)
    if isinstance(payload, list):  # 容忍舊格式：直接是事件陣列
        return payload
    return payload.get("events", [])
