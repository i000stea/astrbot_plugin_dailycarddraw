from __future__ import annotations

from app.infrastructure.api_client import DailyCardDrawApiClient
from app.models.dto import HistoryRecord, TodaySummary, UserStats


class QueryService:
    """查询服务。"""

    def __init__(self, api_client: DailyCardDrawApiClient):
        self.api_client = api_client

    async def get_today(self, qq_id: str, pool_key: str) -> TodaySummary:
        response = await self.api_client.get_today(qq_id, pool_key)
        data = response.get("data", response)
        return TodaySummary.from_dict(data)

    async def get_history(
        self,
        qq_id: str,
        page: int,
        page_size: int,
    ) -> tuple[list[HistoryRecord], int]:
        response = await self.api_client.get_history(qq_id, page, page_size)
        data = response.get("data", {})
        items = data.get("list", data.get("items", []))
        total = int(data.get("total", len(items)) or 0)
        return [HistoryRecord.from_dict(item) for item in items], total

    async def get_user_stats(self, qq_id: str) -> UserStats:
        response = await self.api_client.get_user_stats(qq_id)
        data = response.get("data", response)
        return UserStats.from_dict(data)
