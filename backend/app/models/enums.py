from __future__ import annotations

from enum import Enum


class DrawMode(str, Enum):
    """抽卡模式。"""

    SINGLE = "single"
    TEN = "ten"
