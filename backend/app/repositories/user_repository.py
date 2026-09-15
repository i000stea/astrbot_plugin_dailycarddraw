from __future__ import annotations

from app.repositories.draw_record_repository import DrawRecordRepository


class UserRepository:
    """用户仓储骨架。"""

    def __init__(self):
        self.draw_record_repository = DrawRecordRepository()

    def get_user_stats(self, qq_id: str) -> dict:
        return self.draw_record_repository.get_user_stats(qq_id)
