from __future__ import annotations

from app.infrastructure.api_client import DailyCardDrawApiClient
from app.models.dto import PoolInfo


class PoolService:
    """卡池管理服务。"""

    def __init__(self, api_client: DailyCardDrawApiClient):
        self.api_client = api_client

    async def list_pools(self) -> list[PoolInfo]:
        response = await self.api_client.list_pools()
        data = response.get("data", {})
        items = data.get("list", data.get("items", data if isinstance(data, list) else []))
        return [PoolInfo.from_dict(item) for item in items]
