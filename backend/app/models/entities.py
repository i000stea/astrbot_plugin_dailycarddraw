from __future__ import annotations

from dataclasses import dataclass


@dataclass
class CardEntity:
    """卡牌实体。"""

    card_id: int
    card_name: str
    rarity: str
    score_value: int
    weight: int


@dataclass
class PoolEntity:
    """卡池实体。"""

    pool_id: int
    pool_key: str
    pool_name: str
    daily_single_quota: int
    daily_ten_draw_quota: int
