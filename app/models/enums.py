from __future__ import annotations

from enum import Enum


class DrawMode(str, Enum):
    """抽卡模式。"""

    SINGLE = "single"
    TEN = "ten"

    @property
    def label(self) -> str:
        if self is DrawMode.TEN:
            return "十连"
        return "单抽"

    @property
    def command_label(self) -> str:
        """用于回复模板里的「寻访 / 十连寻访」文案。"""
        if self is DrawMode.TEN:
            return "十连寻访"
        return "寻访"
