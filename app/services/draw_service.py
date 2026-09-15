from __future__ import annotations

from app.infrastructure.api_client import DailyCardDrawApiClient
from app.models.dto import DrawResult
from app.models.enums import DrawMode


class DrawService:
    """抽卡业务服务。"""

    def __init__(self, api_client: DailyCardDrawApiClient):
        self.api_client = api_client

    async def draw(
        self,
        *,
        qq_id: str,
        nickname: str,
        group_id: str,
        pool_key: str,
        draw_mode: DrawMode,
    ) -> DrawResult:
        payload = {
            "qq_id": qq_id,
            "nickname": nickname,
            "group_id": group_id,
            "pool_key": pool_key,
            "draw_mode": draw_mode.value,
        }
        response = await self.api_client.draw(payload)
        data = response.get("data", response)
        return DrawResult.from_dict(data)
