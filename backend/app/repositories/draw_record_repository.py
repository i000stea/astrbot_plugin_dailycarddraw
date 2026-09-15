from __future__ import annotations

from datetime import datetime


class DrawRecordRepository:
    """抽卡记录仓储骨架。"""

    def build_record_no(self) -> str:
        return datetime.now().strftime("DR%Y%m%d%H%M%S")

    def build_today_quota(self) -> dict:
        return {
            "single_used": 1,
            "single_limit": 1,
            "ten_used": 0,
            "ten_limit": 1,
        }

    def list_history(self, qq_id: str, page: int, page_size: int) -> tuple[list[dict], int]:
        item = {
            "record_no": self.build_record_no(),
            "pool_name": "常驻卡池",
            "draw_mode": "single",
            "total_score": 12,
            "highest_rarity": "SSR",
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        return [item], 1

    def get_today_summary(self, qq_id: str, pool_key: str) -> dict:
        return {
            "pool_name": "常驻卡池",
            "quota": self.build_today_quota(),
            "latest_cards": [
                {"card_name": "星穹旅人", "rarity": "SSR", "score": 12},
            ],
        }

    def get_user_stats(self, qq_id: str) -> dict:
        return {
            "qq_id": qq_id,
            "nickname": "",
            "total_draw_count": 1,
            "total_single_draw_count": 1,
            "total_ten_draw_count": 0,
            "total_score": 12,
            "total_ssr_count": 1,
            "total_ur_count": 0,
        }

    def reset_quota(self, qq_id: str, pool_id: str) -> dict:
        return {"qq_id": qq_id, "pool_id": pool_id, "reset": True}
