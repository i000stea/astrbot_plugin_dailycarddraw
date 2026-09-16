from __future__ import annotations

from .base_controller import BaseController
from ..models.enums import DrawMode
from ..models.view_models import DrawReply
from ..services.draw_service import DrawService
from ..utils.message_formatter import format_draw_result


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
    ) -> DrawReply | str:
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
        image_url = result.image_url
        if image_url.startswith("/"):
            base_url = self.config_helper.get_api_base_url()
            if base_url:
                image_url = f"{base_url}{image_url}"

        return DrawReply(
            text=format_draw_result(context.qq_id, result, compact=bool(image_url)),
            image_url=image_url,
        )
