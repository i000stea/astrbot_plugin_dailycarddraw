from __future__ import annotations

from datetime import datetime


def now_text() -> str:
    """生成当前时间文本。"""

    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
