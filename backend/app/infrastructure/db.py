from __future__ import annotations

from app.infrastructure.settings import settings


def get_mysql_dsn(mask_password: bool = True) -> str:
    """生成 MySQL DSN。"""

    password = "***" if mask_password and settings.mysql_password else settings.mysql_password
    return (
        f"mysql+pymysql://{settings.mysql_user}:{password}"
        f"@{settings.mysql_host}:{settings.mysql_port}/{settings.mysql_database}"
    )
