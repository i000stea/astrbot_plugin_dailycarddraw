from __future__ import annotations

from astrbot.api.event import AstrMessageEvent

from ..infrastructure.auth import AdminAuthService
from ..infrastructure.config_helper import ConfigHelper
from ..models.view_models import CommandContext


class BaseController:
    """控制器基类。"""

    def __init__(self, config_helper: ConfigHelper, admin_auth_service: AdminAuthService):
        self.config_helper = config_helper
        self.admin_auth_service = admin_auth_service

    def build_context(self, event: AstrMessageEvent) -> CommandContext:
        get_sender_id = getattr(event, "get_sender_id", None)
        qq_id = ""
        if callable(get_sender_id):
            qq_id = str(get_sender_id() or "")
        if not qq_id:
            sender = getattr(event.message_obj, "sender", None)
            qq_id = str(getattr(sender, "user_id", "") or "")

        nickname = ""
        get_sender_name = getattr(event, "get_sender_name", None)
        if callable(get_sender_name):
            nickname = str(get_sender_name() or "")

        group_id = str(event.get_group_id() or "")
        is_private = bool(event.is_private_chat())
        return CommandContext(
            qq_id=qq_id,
            nickname=nickname,
            group_id=group_id,
            is_private_chat=is_private,
        )

    def ensure_usage_scope(self, context: CommandContext) -> str | None:
        if not self.config_helper.is_enabled():
            return "插件当前已关闭。"
        if context.is_private_chat and not self.config_helper.is_private_enabled():
            return "插件当前未开启私聊使用。"
        if not context.is_private_chat and not self.config_helper.is_group_enabled():
            return "插件当前未开启群聊使用。"
        if not context.qq_id:
            return "未能识别当前消息对应的 QQ 号。"
        return None

    def ensure_admin(self, qq_id: str) -> str | None:
        if not self.admin_auth_service.is_admin(qq_id):
            return "你没有权限使用管理命令。"
        return None
