"""按鍵精靈 KeyMouseMacro：跨平台鍵盤與滑鼠錄製 / 重播工具。"""

from .player import Player
from .recorder import Recorder

__all__ = ["Recorder", "Player"]
__version__ = "1.0.0"
