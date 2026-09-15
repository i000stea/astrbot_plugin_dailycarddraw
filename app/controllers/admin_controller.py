from __future__ import annotations

from app.controllers.base_controller import BaseController
from app.services.pool_service import PoolService
from app.utils.message_formatter import format_pool_list, format_reset_quota


class AdminController(BaseController):
    """管理控制器。"""

    def __init__(self, *args, pool_service: PoolService, **kwargs):
        super().__init__(*args, **kwargs)
        self.pool_service = pool_service

    async def handle_pool_list(self, *, context) -> str:
        error = self.ensure_usage_scope(context)
        if error:
            return error
        admin_error = self.ensure_admin(context.qq_id)
        if admin_error:
            return admin_error

        pools = await self.pool_service.list_pools()
        return format_pool_list(pools)

    async def handle_reset_quota(self, *, context, target_qq_id: str, pool_id: str) -> str:
        error = self.ensure_usage_scope(context)
        if error:
            return error
        admin_error = self.ensure_admin(context.qq_id)
        if admin_error:
            return admin_error

        await self.pool_service.api_client.reset_quota(target_qq_id, pool_id)
        return format_reset_quota(target_qq_id, pool_id)
