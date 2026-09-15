from __future__ import annotations

from app.controllers.base_controller import BaseController
from app.services.query_service import QueryService
from app.utils.message_formatter import (
    format_history,
    format_today_summary,
    format_user_stats,
)


class QueryController(BaseController):
    """查询控制器。"""

    def __init__(
        self,
        *args,
        query_service: QueryService,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self.query_service = query_service

    async def handle_today(self, *, context, pool_key: str) -> str:
        error = self.ensure_usage_scope(context)
        if error:
            return error

        summary = await self.query_service.get_today(context.qq_id, pool_key)
        return format_today_summary(summary)

    async def handle_history(self, *, context, page: int = 1, page_size: int = 10) -> str:
        error = self.ensure_usage_scope(context)
        if error:
            return error

        records, total = await self.query_service.get_history(context.qq_id, page, page_size)
        return format_history(records, page, page_size, total)

    async def handle_stats(self, *, context) -> str:
        error = self.ensure_usage_scope(context)
        if error:
            return error

        stats = await self.query_service.get_user_stats(context.qq_id)
        return format_user_stats(stats)
