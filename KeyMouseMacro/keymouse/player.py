"""重播錄製下來的鍵鼠事件。

依照每筆事件記錄的時間戳，等待相同的間隔後再透過 pynput 的
Controller 送出真正的系統層級鍵鼠事件，藉此還原當初的操作節奏。
"""

from __future__ import annotations

import random
import threading
import time
from typing import Callable, List, Optional

from pynput import keyboard, mouse

from . import events as ev


class Player:
    """播放事件清單。

    參數
    ----
    speed:
        播放速度倍率。2.0 表示用一半的時間播完，0.5 表示放慢一倍。
    humanize:
        加入極小幅度的隨機時間抖動，讓節奏不那麼機械化（預設關閉）。
    on_progress:
        每播完一筆事件呼叫一次的 callback(index, total)，方便顯示進度。
    """

    def __init__(
        self,
        speed: float = 1.0,
        humanize: bool = False,
        on_progress: Optional[Callable[[int, int], None]] = None,
    ) -> None:
        self.speed = max(0.01, speed)
        self.humanize = humanize
        self.on_progress = on_progress

        self._kb = keyboard.Controller()
        self._ms = mouse.Controller()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # -- 對外介面 ----------------------------------------------------------
    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def play(
        self,
        script: List[ev.Event],
        loops: int = 1,
        loop_gap: float = 0.5,
        block: bool = True,
    ) -> None:
        """播放整份腳本。

        loops:
            重複次數；0 或負數代表無限重複（直到 stop()）。
        loop_gap:
            每一輪之間的間隔秒數。
        block:
            True 則在目前執行緒同步播放；False 則丟到背景執行緒。
        """
        self._stop.clear()
        if block:
            self._run(script, loops, loop_gap)
        else:
            self._thread = threading.Thread(
                target=self._run, args=(script, loops, loop_gap), daemon=True
            )
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def wait(self) -> None:
        if self._thread is not None:
            self._thread.join()

    # -- 內部核心 ----------------------------------------------------------
    def _run(self, script: List[ev.Event], loops: int, loop_gap: float) -> None:
        if not script:
            return
        total = len(script)
        loop_index = 0
        while not self._stop.is_set():
            prev_t = 0.0
            for i, event in enumerate(script):
                if self._stop.is_set():
                    break
                delay = (event["t"] - prev_t) / self.speed
                if self.humanize and delay > 0:
                    delay *= random.uniform(0.9, 1.1)
                prev_t = event["t"]
                self._sleep(delay)
                if self._stop.is_set():
                    break
                self._dispatch(event)
                if self.on_progress is not None:
                    self.on_progress(i + 1, total)

            loop_index += 1
            if loops > 0 and loop_index >= loops:
                break
            if not self._stop.is_set():
                self._sleep(loop_gap)

    def _sleep(self, seconds: float) -> None:
        """可被中斷的 sleep：切成小段，讓 stop() 能即時生效。"""
        if seconds <= 0:
            return
        end = time.perf_counter() + seconds
        while not self._stop.is_set():
            remaining = end - time.perf_counter()
            if remaining <= 0:
                return
            time.sleep(min(remaining, 0.02))

    def _dispatch(self, event: ev.Event) -> None:
        kind = event["kind"]
        if kind == ev.KEY_PRESS:
            self._kb.press(ev.dict_to_key(event["key"]))
        elif kind == ev.KEY_RELEASE:
            self._kb.release(ev.dict_to_key(event["key"]))
        elif kind == ev.MOUSE_MOVE:
            self._ms.position = (event["x"], event["y"])
        elif kind == ev.MOUSE_CLICK:
            self._ms.position = (event["x"], event["y"])
            button = ev.str_to_button(event["button"])
            if event["pressed"]:
                self._ms.press(button)
            else:
                self._ms.release(button)
        elif kind == ev.MOUSE_SCROLL:
            self._ms.position = (event["x"], event["y"])
            self._ms.scroll(event["dx"], event["dy"])
