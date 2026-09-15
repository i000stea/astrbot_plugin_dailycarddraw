from __future__ import annotations

from fastapi import Header, HTTPException, status

from app.infrastructure.settings import settings


def verify_admin_token(authorization: str | None = Header(default=None)) -> None:
    """校验后端管理接口 Token。"""

    if not settings.admin_api_token:
        return

    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少 Authorization 请求头。",
        )

    expected = f"Bearer {settings.admin_api_token}"
    if authorization.strip() != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="管理接口鉴权失败。",
        )
