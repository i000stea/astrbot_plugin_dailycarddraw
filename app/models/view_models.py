from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CommandContext:
    """命令上下文。"""

    qq_id: str
    nickname: str
    group_id: str = ""
    is_private_chat: bool = False


@dataclass
class HistoryPageViewModel:
    """历史记录分页视图。"""

    records: list[str] = field(default_factory=list)
    page: int = 1
    page_size: int = 10
    total: int = 0
