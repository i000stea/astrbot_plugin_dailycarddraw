from __future__ import annotations

from app.repositories.draw_record_repository import DrawRecordRepository
from app.repositories.user_repository import UserRepository


class QueryService:
    """查询服务。"""

    def __init__(self):
        self.draw_record_repository = DrawRecordRepository()
        self.user_repository = UserRepository()

    def get_today(self, qq_id: str, pool_key: str) -> dict:
        return self.draw_record_repository.get_today_summary(qq_id, pool_key)

    def get_history(self, qq_id: str, page: int, page_size: int) -> dict:
        items, total = self.draw_record_repository.list_history(qq_id, page, page_size)
        return {"list": items, "total": total}

    def get_user_stats(self, qq_id: str) -> dict:
        return self.user_repository.get_user_stats(qq_id)
