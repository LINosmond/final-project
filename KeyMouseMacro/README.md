# 按鍵精靈 KeyMouseMacro

跨平台（Windows / macOS / Linux）的鍵盤與滑鼠**錄製 / 重播**工具。

底層使用 [`pynput`](https://pynput.readthedocs.io/)，透過作業系統原生 API 送出事件
（Windows 的 `SendInput`、macOS 的 `CGEvent`、Linux 的 X11 / `uinput`），
所以送出的是**真正的系統層級鍵鼠輸入**，而不是只對某個視窗發送訊息——因此能被
遊戲、瀏覽器、任何應用程式一視同仁地接收，達到「深入模仿真實鍵鼠輸入」的效果。

## 功能

- 🎬 **錄製**鍵盤按鍵、滑鼠移動軌跡、點擊、滾輪，並記錄精確的時間節奏
- ▶️ **忠實重播**，還原當初的操作間隔（可調速度倍率）
- 🔁 **迴圈播放**：指定次數或無限循環
- 💾 腳本以 **JSON** 存檔 / 讀檔，方便分享與版本控管
- ⌨️ **全域熱鍵**：在任何視窗都能開始 / 停止（F6 錄製、F7 播放、Esc 中止）
- 🧍 **擬人化**選項：加入細微的隨機時間抖動，讓節奏不那麼機械
- 🖥️ 內建 **tkinter 圖形介面**，也支援純命令列

## 安裝

```bash
cd KeyMouseMacro
pip install -r requirements.txt
```

> **權限提醒**
> - **macOS**：需在「系統設定 → 隱私權與安全性 → 輔助使用 / 輸入監控」中授權你的終端機或 Python，否則無法錄製與送出事件。
> - **Linux**：需在 X11 環境下執行（Wayland 支援有限）。
> - **Windows**：若目標程式以系統管理員權限執行，本工具也需以系統管理員身分執行。

## 使用方式

### 圖形介面（推薦）

```bash
python -m keymouse gui
```

按 **F6** 開始錄製，操作你的鍵盤滑鼠，再按 **F6** 停止；接著設定速度與迴圈次數，
按 **F7** 播放（播放中再按 F7 或 Esc 即可中止）。可用「另存腳本 / 開啟腳本」保存重用。

### 命令列

```bash
# 錄製：按 F6 開始，再按一次停止並存檔
python -m keymouse record -o demo.json

# 只記錄點擊、不記錄滑鼠移動軌跡（檔案更小）
python -m keymouse record -o demo.json --no-move

# 播放：重複 3 次、1.5 倍速；播放中按 Esc 中止
python -m keymouse play demo.json --loops 3 --speed 1.5

# 無限循環，並加入擬人化抖動
python -m keymouse play demo.json --loops 0 --humanize
```

### 打包成獨立執行檔（Windows .exe）

想做成雙擊就能開、不用先裝 Python 的 `.exe`，用 [PyInstaller](https://pyinstaller.org/) 打包。
**注意：PyInstaller 只能產出與建置環境相同作業系統的執行檔**，所以要 Windows 的 `.exe`
就得在 Windows 上建。步驟：

1. 在 Windows 安裝 [Python 3](https://www.python.org/downloads/)（安裝時勾選 **Add Python to PATH**；官方版本已內建 tkinter）。
2. 下載本專案，在 `KeyMouseMacro` 資料夾裡把 `build.bat` 按兩下（或在命令列執行）。
3. 腳本會自動安裝相依套件並打包，完成後執行檔在 `dist\KeyMouseMacro.exe`。

手動指令（等同 `build.bat` 的內容）：

```bat
pip install -r requirements.txt pyinstaller
pyinstaller --noconfirm KeyMouseMacro.spec
```

> - `KeyMouseMacro.spec` 已把 pynput 各平台後端列入 `hiddenimports`，避免打包後找不到後端。
> - 產出的是**單一 exe、無主控台視窗**的 GUI 程式。
> - 部分防毒軟體會對 PyInstaller 打包的執行檔誤報，屬正常現象，可自行加入白名單。

### 當成函式庫使用

```python
from keymouse import Recorder, Player
from keymouse import events

rec = Recorder()
rec.start()
# … 你的操作 …
script = rec.stop()
events.save_script(script, "macro.json")

Player(speed=2.0).play(script, loops=5)
```

## 專案結構

```
KeyMouseMacro/
├── keymouse/
│   ├── events.py     # 事件資料模型與 JSON 序列化
│   ├── recorder.py   # 錄製鍵鼠事件（含滑鼠移動節流）
│   ├── player.py     # 重播（可調速、迴圈、可中斷、擬人化）
│   ├── cli.py        # 命令列介面
│   ├── gui.py        # tkinter 圖形介面
│   └── __main__.py   # python -m keymouse 進入點
├── app.py            # 打包成執行檔時的 GUI 進入點
├── KeyMouseMacro.spec# PyInstaller 打包設定
├── build.bat         # Windows 一鍵建置 .exe 腳本
├── requirements.txt
└── README.md
```

## 腳本格式

每份腳本是一個 JSON，`events` 陣列裡每筆事件都帶有 `t`（相對起始的秒數）與 `kind`：

```json
{
  "version": 1,
  "events": [
    {"t": 0.12, "kind": "key_press",   "key": {"type": "char", "char": "h"}},
    {"t": 0.20, "kind": "key_release", "key": {"type": "char", "char": "h"}},
    {"t": 0.55, "kind": "mouse_click", "x": 640, "y": 400, "button": "left", "pressed": true},
    {"t": 0.90, "kind": "mouse_scroll","x": 640, "y": 400, "dx": 0, "dy": -2}
  ]
}
```

## 使用倫理

本工具用於自動化重複性操作、軟體測試、無障礙輔助等**正當用途**。
請遵守你所使用之軟體 / 遊戲 / 網站的服務條款，勿用於作弊、洗排名或其他違規行為。
