from __future__ import annotations

import random

from app.models.enums import DrawMode
from app.repositories.draw_record_repository import DrawRecordRepository
from app.repositories.pool_repository import PoolRepository


class DrawService:
    """抽卡服务。"""

    def __init__(self):
        self.pool_repository = PoolRepository()
        self.draw_record_repository = DrawRecordRepository()

    def draw(self, qq_id: str, nickname: str, group_id: str, pool_key: str, draw_mode: str) -> dict:
        pool = self.pool_repository.get_pool_by_key(pool_key)
        cards = self.pool_repository.list_available_cards(pool.pool_id)

        parsed_mode = DrawMode(draw_mode)
        draw_count = 10 if parsed_mode is DrawMode.TEN else 1
        selected_cards = random.choices(
            population=cards,
            weights=[card.weight for card in cards],
            k=draw_count,
        )

        result_cards = [
            {
                "card_name": card.card_name,
                "rarity": card.rarity,
                "score": card.score_value,
            }
            for card in selected_cards
        ]
        total_score = sum(card["score"] for card in result_cards)

        quota = self.draw_record_repository.build_today_quota()
        if parsed_mode is DrawMode.TEN:
            quota["ten_used"] = 1
        else:
            quota["single_used"] = 1

        return {
            "record_no": self.draw_record_repository.build_record_no(),
            "pool_name": pool.pool_name,
            "draw_mode": parsed_mode.value,
            "total_score": total_score,
            "quota": quota,
            "cards": result_cards,
        }
