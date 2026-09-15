from __future__ import annotations

from app.controllers.base_controller import BaseController
from app.models.enums import DrawMode
from app.services.draw_service import DrawService
from app.utils.message_formatter import format_draw_result


class DrawController(BaseController):
    """抽卡控制器。"""

    def __init__(self, *args, draw_service: DrawService, **kwargs):
        super().__init__(*args, **kwargs)
        self.draw_service = draw_service

    async def handle_draw(
        self,
        *,
        context,
        pool_key: str,
        draw_mode: DrawMode,
    ) -> str:
        error = self.ensure_usage_scope(context)
        if error:
            return error

        result = await self.draw_service.draw(
            qq_id=context.qq_id,
            nickname=context.nickname,
            group_id=context.group_id,
            pool_key=pool_key,
            draw_mode=draw_mode,
        )
        return format_draw_result(context.qq_id, result)
