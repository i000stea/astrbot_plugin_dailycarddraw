from __future__ import annotations

from fastapi import APIRouter, Query

from app.models.schemas import ApiResponse
from app.services.query_service import QueryService

router = APIRouter()
query_service = QueryService()


@router.get("/today", response_model=ApiResponse)
async def get_today(qq_id: str = Query(...), pool_key: str = Query(...)):
    data = query_service.get_today(qq_id, pool_key)
    return ApiResponse(success=True, message="查询成功", data=data)


@router.get("/history", response_model=ApiResponse)
async def get_history(qq_id: str = Query(...), page: int = Query(1), page_size: int = Query(10)):
    data = query_service.get_history(qq_id, page, page_size)
    return ApiResponse(success=True, message="查询成功", data=data)


@router.get("/stats", response_model=ApiResponse)
async def get_stats(qq_id: str = Query(...)):
    data = query_service.get_user_stats(qq_id)
    return ApiResponse(success=True, message="查询成功", data=data)
