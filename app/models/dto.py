from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .enums import DrawMode


@dataclass
class DrawCardItem:
    """单张卡牌结果。"""

    card_name: str
    rarity: str
    score: int = 0

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DrawCardItem":
        return cls(
            card_name=str(data.get("card_name", "未知卡牌")),
            rarity=str(data.get("rarity", "?")),
            score=int(data.get("score", 0) or 0),
        )


@dataclass
class QuotaInfo:
    """每日配额信息。"""

    single_used: int = 0
    single_limit: int = 0
    ten_used: int = 0
    ten_limit: int = 0

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "QuotaInfo":
        source = data or {}
        return cls(
            single_used=int(source.get("single_used", 0) or 0),
            single_limit=int(source.get("single_limit", 0) or 0),
            ten_used=int(source.get("ten_used", 0) or 0),
            ten_limit=int(source.get("ten_limit", 0) or 0),
        )


@dataclass
class DrawResult:
    """抽卡响应。"""

    record_no: str
    pool_name: str
    draw_mode: DrawMode
    cards: list[DrawCardItem] = field(default_factory=list)
    quota: QuotaInfo = field(default_factory=QuotaInfo)
    total_score: int = 0

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DrawResult":
        draw_mode = DrawMode(str(data.get("draw_mode", DrawMode.SINGLE.value)))
        cards = [DrawCardItem.from_dict(item) for item in data.get("cards", [])]
        total_score = int(data.get("total_score", 0) or 0)
        if total_score <= 0:
            total_score = sum(card.score for card in cards)
        return cls(
            record_no=str(data.get("record_no", "")),
            pool_name=str(data.get("pool_name", "默认卡池")),
            draw_mode=draw_mode,
            cards=cards,
            quota=QuotaInfo.from_dict(data.get("quota")),
            total_score=total_score,
        )


@dataclass
class TodaySummary:
    """今日记录摘要。"""

    pool_name: str
    quota: QuotaInfo = field(default_factory=QuotaInfo)
    latest_cards: list[DrawCardItem] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TodaySummary":
        latest_cards = [
            DrawCardItem.from_dict(item)
            for item in data.get("latest_cards", data.get("cards", []))
        ]
        return cls(
            pool_name=str(data.get("pool_name", "默认卡池")),
            quota=QuotaInfo.from_dict(data.get("quota")),
            latest_cards=latest_cards,
        )


@dataclass
class HistoryRecord:
    """历史记录。"""

    record_no: str
    pool_name: str
    draw_mode: str
    total_score: int
    created_at: str
    highest_rarity: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "HistoryRecord":
        return cls(
            record_no=str(data.get("record_no", "")),
            pool_name=str(data.get("pool_name", "默认卡池")),
            draw_mode=str(data.get("draw_mode", DrawMode.SINGLE.value)),
            total_score=int(data.get("total_score", 0) or 0),
            created_at=str(data.get("created_at", "")),
            highest_rarity=str(data.get("highest_rarity", "")),
        )


@dataclass
class UserStats:
    """用户累计统计。"""

    qq_id: str
    nickname: str = ""
    total_draw_count: int = 0
    total_single_draw_count: int = 0
    total_ten_draw_count: int = 0
    total_score: int = 0
    total_ssr_count: int = 0
    total_ur_count: int = 0

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "UserStats":
        return cls(
            qq_id=str(data.get("qq_id", "")),
            nickname=str(data.get("nickname", "")),
            total_draw_count=int(data.get("total_draw_count", 0) or 0),
            total_single_draw_count=int(data.get("total_single_draw_count", 0) or 0),
            total_ten_draw_count=int(data.get("total_ten_draw_count", 0) or 0),
            total_score=int(data.get("total_score", 0) or 0),
            total_ssr_count=int(data.get("total_ssr_count", 0) or 0),
            total_ur_count=int(data.get("total_ur_count", 0) or 0),
        )


@dataclass
class PoolInfo:
    """卡池信息。"""

    pool_id: str
    pool_key: str
    pool_name: str
    is_enabled: bool = True
    allow_single_draw: bool = True
    allow_ten_draw: bool = True

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PoolInfo":
        return cls(
            pool_id=str(data.get("id", "")),
            pool_key=str(data.get("pool_key", "")),
            pool_name=str(data.get("pool_name", "未命名卡池")),
            is_enabled=bool(data.get("is_enabled", True)),
            allow_single_draw=bool(data.get("allow_single_draw", True)),
            allow_ten_draw=bool(data.get("allow_ten_draw", True)),
        )
