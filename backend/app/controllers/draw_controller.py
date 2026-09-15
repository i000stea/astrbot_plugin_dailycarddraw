from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import ApiResponse, DrawRequest
from app.services.draw_service import DrawService

router = APIRouter()
draw_service = DrawService()


@router.post("/draw", response_model=ApiResponse)
async def draw(payload: DrawRequest):
    data = draw_service.draw(
        qq_id=payload.qq_id,
        nickname=payload.nickname,
        group_id=payload.group_id,
        pool_key=payload.pool_key,
        draw_mode=payload.draw_mode,
    )
    return ApiResponse(success=True, message="抽卡成功", data=data)
