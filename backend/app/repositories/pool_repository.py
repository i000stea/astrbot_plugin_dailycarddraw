from __future__ import annotations

from app.models.entities import CardEntity, PoolEntity


class PoolRepository:
    """卡池仓储。

    当前为最小骨架版本，先使用内存假数据。
    后续应替换为真实 MySQL 查询。
    """

    def get_pool_by_key(self, pool_key: str) -> PoolEntity:
        return PoolEntity(
            pool_id=1,
            pool_key=pool_key,
            pool_name="常驻卡池",
            daily_single_quota=1,
            daily_ten_draw_quota=1,
        )

    def list_available_cards(self, pool_id: int) -> list[CardEntity]:
        return [
            CardEntity(card_id=1, card_name="星穹旅人", rarity="SSR", score_value=12, weight=5),
            CardEntity(card_id=2, card_name="巡星学徒", rarity="SR", score_value=5, weight=20),
            CardEntity(card_id=3, card_name="荒野旅者", rarity="R", score_value=2, weight=40),
            CardEntity(card_id=4, card_name="晨光记录员", rarity="N", score_value=1, weight=60),
        ]

    def list_pools(self) -> list[dict]:
        return [
            {
                "id": 1,
                "pool_key": "normal_pool",
                "pool_name": "常驻卡池",
                "is_enabled": True,
                "allow_single_draw": True,
                "allow_ten_draw": True,
            }
        ]
