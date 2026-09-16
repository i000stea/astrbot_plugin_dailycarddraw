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
class DrawReply:
    """抽卡回复：文本 + 可选的图片地址。"""

    text: str
    image_url: str = ""


@dataclass
class HistoryPageViewModel:
    """历史记录分页视图。"""

    records: list[str] = field(default_factory=list)
    page: int = 1
    page_size: int = 10
    total: int = 0
