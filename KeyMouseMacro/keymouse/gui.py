"""tkinter 圖形介面。

提供一個最小但實用的操作面板：錄製、存檔、讀檔、播放、設定速度與迴圈。
也註冊了全域熱鍵，讓你在其他視窗操作時也能開始/停止：

    F6  ── 開始 / 停止錄製
    F7  ── 開始 / 停止播放
"""

from __future__ import annotations

import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from pynput import keyboard

from . import events as ev
from .player import Player
from .recorder import Recorder


class App:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        root.title("按鍵精靈 KeyMouseMacro")
        root.geometry("420x340")
        root.resizable(False, False)

        self.recorder = Recorder(on_event=self._on_recorded)
        self.player = Player(on_progress=self._on_progress)
        self.script: list[ev.Event] = []

        self._build_ui()
        self._install_hotkeys()

    # -- UI ---------------------------------------------------------------
    def _build_ui(self) -> None:
        pad = {"padx": 8, "pady": 6}

        top = ttk.Frame(self.root)
        top.pack(fill="x", **pad)
        self.record_btn = ttk.Button(top, text="● 開始錄製 (F6)", command=self.toggle_record)
        self.record_btn.pack(side="left", expand=True, fill="x", padx=4)
        self.play_btn = ttk.Button(top, text="▶ 播放 (F7)", command=self.toggle_play)
        self.play_btn.pack(side="left", expand=True, fill="x", padx=4)

        io = ttk.Frame(self.root)
        io.pack(fill="x", **pad)
        ttk.Button(io, text="開啟腳本…", command=self.load).pack(side="left", expand=True, fill="x", padx=4)
        ttk.Button(io, text="另存腳本…", command=self.save).pack(side="left", expand=True, fill="x", padx=4)

        opt = ttk.LabelFrame(self.root, text="播放設定")
        opt.pack(fill="x", **pad)

        ttk.Label(opt, text="速度倍率").grid(row=0, column=0, sticky="w", padx=6, pady=4)
        self.speed_var = tk.DoubleVar(value=1.0)
        ttk.Spinbox(opt, from_=0.1, to=10.0, increment=0.1, width=8,
                    textvariable=self.speed_var).grid(row=0, column=1, padx=6, pady=4)

        ttk.Label(opt, text="迴圈次數 (0=無限)").grid(row=1, column=0, sticky="w", padx=6, pady=4)
        self.loops_var = tk.IntVar(value=1)
        ttk.Spinbox(opt, from_=0, to=999999, width=8,
                    textvariable=self.loops_var).grid(row=1, column=1, padx=6, pady=4)

        self.move_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(opt, text="錄製滑鼠移動軌跡", variable=self.move_var,
                        command=self._toggle_move).grid(row=0, column=2, sticky="w", padx=12)
        self.humanize_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(opt, text="擬人化時間抖動", variable=self.humanize_var,
                        command=self._toggle_humanize).grid(row=1, column=2, sticky="w", padx=12)

        self.status = tk.StringVar(value="就緒。")
        ttk.Label(self.root, textvariable=self.status, anchor="w",
                  relief="sunken").pack(fill="x", side="bottom", ipady=3)

    # -- 錄製 -------------------------------------------------------------
    def _toggle_move(self) -> None:
        self.recorder.record_move = self.move_var.get()

    def _toggle_humanize(self) -> None:
        self.player.humanize = self.humanize_var.get()

    def toggle_record(self) -> None:
        if self.player.running:
            return
        if not self.recorder.running:
            self.recorder.start()
            self.record_btn.config(text="■ 停止錄製 (F6)")
            self._set_status("錄製中…")
        else:
            self.script = list(self.recorder.stop())
            self.record_btn.config(text="● 開始錄製 (F6)")
            self._set_status(f"錄製完成，共 {len(self.script)} 筆事件。")

    def _on_recorded(self, _event: ev.Event) -> None:
        self._set_status(f"錄製中… {len(self.recorder.events)} 筆")

    # -- 播放 -------------------------------------------------------------
    def toggle_play(self) -> None:
        if self.recorder.running:
            return
        if self.player.running:
            self.player.stop()
            return
        if not self.script:
            messagebox.showinfo("提示", "目前沒有可播放的腳本，請先錄製或開啟檔案。")
            return
        self.player.speed = self.speed_var.get()
        self.player.humanize = self.humanize_var.get()
        self.play_btn.config(text="■ 停止 (F7)")
        self._set_status("播放中…")

        def worker():
            self.player.play(self.script, loops=self.loops_var.get(), block=True)
            self.root.after(0, self._on_play_done)

        threading.Thread(target=worker, daemon=True).start()

    def _on_play_done(self) -> None:
        self.play_btn.config(text="▶ 播放 (F7)")
        self._set_status("播放結束。")

    def _on_progress(self, i: int, n: int) -> None:
        self.root.after(0, lambda: self._set_status(f"播放中… {i}/{n}"))

    # -- 檔案 -------------------------------------------------------------
    def save(self) -> None:
        if not self.script:
            messagebox.showinfo("提示", "沒有可儲存的腳本。")
            return
        path = filedialog.asksaveasfilename(
            defaultextension=".json", filetypes=[("Macro", "*.json")]
        )
        if path:
            ev.save_script(self.script, path)
            self._set_status(f"已儲存：{path}")

    def load(self) -> None:
        path = filedialog.askopenfilename(filetypes=[("Macro", "*.json")])
        if path:
            self.script = ev.load_script(path)
            self._set_status(f"已載入 {len(self.script)} 筆事件：{path}")

    # -- 全域熱鍵 ----------------------------------------------------------
    def _install_hotkeys(self) -> None:
        def on_press(key):
            if key == keyboard.Key.f6:
                self.root.after(0, self.toggle_record)
            elif key == keyboard.Key.f7:
                self.root.after(0, self.toggle_play)

        self._hk = keyboard.Listener(on_press=on_press)
        self._hk.start()

    def _set_status(self, text: str) -> None:
        self.status.set(text)


def main() -> None:
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
