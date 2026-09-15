from __future__ import annotations

from app.infrastructure.config_helper import ConfigHelper


class AdminAuthService:
    """管理员权限判断。"""

    def __init__(self, config_helper: ConfigHelper):
        self.config_helper = config_helper

    def is_admin(self, qq_id: str) -> bool:
        if not qq_id:
            return False
        return qq_id in self.config_helper.get_admin_qq_list()
