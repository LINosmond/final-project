# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包設定。

用法：
    pyinstaller KeyMouseMacro.spec

pynput 會依平台「動態」匯入底層後端，PyInstaller 的靜態分析看不到，
所以這裡把三大平台的後端都列進 hiddenimports，確保打包後能正常運作
（用不到的平台模組會在執行時被略過，不影響）。
"""

block_cipher = None

hidden = [
    "pynput.keyboard._win32",
    "pynput.mouse._win32",
    "pynput.keyboard._darwin",
    "pynput.mouse._darwin",
    "pynput.keyboard._xorg",
    "pynput.mouse._xorg",
    "pynput._util._win32",
    "pynput._util._darwin",
    "pynput._util._xorg",
]

a = Analysis(
    ["app.py"],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="KeyMouseMacro",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # GUI 程式：不開黑色主控台視窗
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
