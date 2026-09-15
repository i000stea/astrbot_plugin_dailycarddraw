from __future__ import annotations

import os


class Settings:
    """后端配置。"""

    app_name: str = "daily-carddraw-backend"
    api_prefix: str = "/api/daily-carddraw"
    environment: str = os.getenv("APP_ENV", "development")
    host: str = os.getenv("APP_HOST", "0.0.0.0")
    port: int = int(os.getenv("APP_PORT", "8000"))

    mysql_host: str = os.getenv("MYSQL_HOST", "127.0.0.1")
    mysql_port: int = int(os.getenv("MYSQL_PORT", "3306"))
    mysql_user: str = os.getenv("MYSQL_USER", "root")
    mysql_password: str = os.getenv("MYSQL_PASSWORD", "")
    mysql_database: str = os.getenv("MYSQL_DATABASE", "daily_carddraw")

    admin_api_token: str = os.getenv("ADMIN_API_TOKEN", "")


settings = Settings()
