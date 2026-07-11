"""命令列介面。

用法範例：

    # 錄製：按 F6 開始，再按 F6 停止並存檔
    python -m keymouse record -o demo.json

    # 播放：重複 3 次、1.5 倍速；播放中按 Esc 可中止
    python -m keymouse play demo.json --loops 3 --speed 1.5

    # 啟動圖形介面
    python -m keymouse gui
"""

from __future__ import annotations

import argparse
import sys
import threading

from pynput import keyboard

from . import events as ev
from .player import Player
from .recorder import Recorder


def _cmd_record(args) -> int:
    done = threading.Event()
    rec = Recorder(
        record_move=not args.no_move,
        on_event=lambda e: print(f"\r已錄製 {len(rec.events)} 筆事件", end="", flush=True),
    )

    print(f"按 [{args.hotkey.upper()}] 開始錄製，再按一次停止並存檔。")

    def on_hotkey():
        if not rec.running:
            print("\n▶ 開始錄製…")
            rec.start()
        else:
            rec.stop()
            print(f"\n■ 停止，共 {len(rec.events)} 筆事件。")
            done.set()

    hotkey_key = getattr(keyboard.Key, args.hotkey)

    def on_press(key):
        if key == hotkey_key:
            on_hotkey()

    listener = keyboard.Listener(on_press=on_press)
    listener.start()
    done.wait()
    listener.stop()

    ev.save_script(rec.events, args.output)
    print(f"已存檔至：{args.output}")
    return 0


def _cmd_play(args) -> int:
    script = ev.load_script(args.script)
    if not script:
        print("腳本是空的，沒有可播放的事件。")
        return 1

    player = Player(
        speed=args.speed,
        humanize=args.humanize,
        on_progress=lambda i, n: print(f"\r播放進度 {i}/{n}", end="", flush=True),
    )

    # 播放中按 Esc 中止
    def on_press(key):
        if key == keyboard.Key.esc:
            player.stop()
            return False

    stopper = keyboard.Listener(on_press=on_press)
    stopper.start()

    loops_desc = "無限" if args.loops <= 0 else str(args.loops)
    print(f"開始播放（速度 {args.speed}x，迴圈 {loops_desc}）。按 [Esc] 中止。")
    player.play(script, loops=args.loops, loop_gap=args.loop_gap, block=True)
    stopper.stop()
    print("\n播放結束。")
    return 0


def _cmd_gui(args) -> int:
    from . import gui

    gui.main()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="keymouse", description="按鍵精靈：錄製 / 重播鍵盤與滑鼠操作。"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_rec = sub.add_parser("record", help="錄製鍵鼠操作")
    p_rec.add_argument("-o", "--output", default="macro.json", help="輸出檔名")
    p_rec.add_argument("--no-move", action="store_true", help="不錄製滑鼠移動軌跡")
    p_rec.add_argument("--hotkey", default="f6", help="開始/停止的熱鍵（預設 f6）")
    p_rec.set_defaults(func=_cmd_record)

    p_play = sub.add_parser("play", help="播放腳本")
    p_play.add_argument("script", help="要播放的腳本檔")
    p_play.add_argument("--speed", type=float, default=1.0, help="播放速度倍率")
    p_play.add_argument("--loops", type=int, default=1, help="重複次數（0=無限）")
    p_play.add_argument("--loop-gap", type=float, default=0.5, help="每輪之間的間隔秒數")
    p_play.add_argument("--humanize", action="store_true", help="加入細微時間抖動")
    p_play.set_defaults(func=_cmd_play)

    p_gui = sub.add_parser("gui", help="開啟圖形介面")
    p_gui.set_defaults(func=_cmd_gui)

    return parser


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
