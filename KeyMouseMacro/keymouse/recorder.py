"""錄製鍵盤與滑鼠事件。

透過 pynput 的全域監聽器攔截作業系統層級的鍵鼠事件，
把它們連同精確的時間戳記錄下來。這些事件之後可以被 player 忠實重播。
"""

from __future__ import annotations

import time
from typing import Callable, List, Optional

from pynput import keyboard, mouse

from . import events as ev


class Recorder:
    """開始 / 停止錄製，收集事件清單。

    參數
    ----
    record_move:
        是否錄製滑鼠移動軌跡。開啟後可還原滑鼠的移動路徑，
        但檔案會變大；關閉則只記錄點擊位置。
    move_min_interval:
        兩筆滑鼠移動事件之間至少間隔多少秒，用來抽稀（節流），
        避免高頻移動塞爆檔案。預設約 60fps。
    on_event:
        每收到一筆事件就呼叫一次的 callback（可選），方便 GUI 即時顯示筆數。
    """

    def __init__(
        self,
        record_move: bool = True,
        move_min_interval: float = 0.016,
        on_event: Optional[Callable[[ev.Event], None]] = None,
    ) -> None:
        self.record_move = record_move
        self.move_min_interval = move_min_interval
        self.on_event = on_event

        self.events: List[ev.Event] = []
        self._start_t: float = 0.0
        self._last_move_t: float = 0.0
        self._kb_listener: Optional[keyboard.Listener] = None
        self._ms_listener: Optional[mouse.Listener] = None
        self._running = False

    # -- 對外介面 ----------------------------------------------------------
    @property
    def running(self) -> bool:
        return self._running

    def start(self) -> None:
        if self._running:
            return
        self.events = []
        self._start_t = time.perf_counter()
        self._last_move_t = 0.0
        self._running = True

        self._kb_listener = keyboard.Listener(
            on_press=self._on_press, on_release=self._on_release
        )
        self._ms_listener = mouse.Listener(
            on_click=self._on_click,
            on_scroll=self._on_scroll,
            on_move=self._on_move if self.record_move else None,
        )
        self._kb_listener.start()
        self._ms_listener.start()

    def stop(self) -> List[ev.Event]:
        if not self._running:
            return self.events
        self._running = False
        if self._kb_listener is not None:
            self._kb_listener.stop()
            self._kb_listener = None
        if self._ms_listener is not None:
            self._ms_listener.stop()
            self._ms_listener = None
        return self.events

    # -- 內部：時間戳與收錄 -------------------------------------------------
    def _now(self) -> float:
        return time.perf_counter() - self._start_t

    def _add(self, event: ev.Event) -> None:
        self.events.append(event)
        if self.on_event is not None:
            self.on_event(event)

    # -- 鍵盤 callback -----------------------------------------------------
    def _on_press(self, key) -> None:
        self._add({"t": self._now(), "kind": ev.KEY_PRESS, "key": ev.key_to_dict(key)})

    def _on_release(self, key) -> None:
        self._add(
            {"t": self._now(), "kind": ev.KEY_RELEASE, "key": ev.key_to_dict(key)}
        )

    # -- 滑鼠 callback -----------------------------------------------------
    def _on_move(self, x: int, y: int) -> None:
        now = self._now()
        if now - self._last_move_t < self.move_min_interval:
            return  # 節流，丟掉太密集的移動
        self._last_move_t = now
        self._add({"t": now, "kind": ev.MOUSE_MOVE, "x": x, "y": y})

    def _on_click(self, x: int, y: int, button, pressed: bool) -> None:
        self._add(
            {
                "t": self._now(),
                "kind": ev.MOUSE_CLICK,
                "x": x,
                "y": y,
                "button": ev.button_to_str(button),
                "pressed": pressed,
            }
        )

    def _on_scroll(self, x: int, y: int, dx: int, dy: int) -> None:
        self._add(
            {
                "t": self._now(),
                "kind": ev.MOUSE_SCROLL,
                "x": x,
                "y": y,
                "dx": dx,
                "dy": dy,
            }
        )
