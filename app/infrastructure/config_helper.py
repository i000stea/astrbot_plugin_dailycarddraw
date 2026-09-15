from __future__ import annotations

from typing import Any

from astrbot.api import AstrBotConfig


class ConfigHelper:
    """插件配置读取工具。"""

    def __init__(self, config: AstrBotConfig):
        self.config = config

    def is_enabled(self) -> bool:
        return bool(self.config.get("plugin_enabled", True))

    def is_group_enabled(self) -> bool:
        return bool(self.config.get("enable_group_usage", True))

    def is_private_enabled(self) -> bool:
        return bool(self.config.get("enable_private_usage", True))

    def get_default_pool_key(self) -> str:
        return str(self.config.get("default_pool_key", "normal_pool"))

    def get_api_base_url(self) -> str:
        return str(self.config.get("api_base_url", "")).rstrip("/")

    def get_api_token(self) -> str:
        return str(self.config.get("api_token", "")).strip()

    def get_request_timeout_seconds(self) -> float:
        raw_value: Any = self.config.get("request_timeout_seconds", 10)
        try:
            timeout = float(raw_value)
        except (TypeError, ValueError):
            timeout = 10.0
        return max(timeout, 1.0)

    def get_admin_qq_list(self) -> list[str]:
        values = self.config.get("admin_qq_list", [])
        if not isinstance(values, list):
            return []
        return [str(item).strip() for item in values if str(item).strip()]

    def is_debug_log_enabled(self) -> bool:
        """是否输出【抽卡诊断】日志（排查「命令没反应」时使用）。"""
        return bool(self.config.get("debug_log_enabled", True))
