"""打包成執行檔時的進入點：直接開啟圖形介面。

PyInstaller 需要一個實體的 .py 檔當入口（不能用 `python -m keymouse`），
這個檔案就是那個入口。
"""

from keymouse.gui import main

if __name__ == "__main__":
    main()
