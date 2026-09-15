from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.infrastructure.auth import verify_admin_token
from app.models.schemas import ApiResponse
from app.repositories.draw_record_repository import DrawRecordRepository
from app.services.pool_service import PoolService

router = APIRouter(dependencies=[Depends(verify_admin_token)])
pool_service = PoolService()
draw_record_repository = DrawRecordRepository()


@router.get("/admin/pools", response_model=ApiResponse)
async def list_pools():
    data = pool_service.list_pools()
    return ApiResponse(success=True, message="查询成功", data=data)


@router.post("/admin/reset-quota", response_model=ApiResponse)
async def reset_quota(payload: dict):
    qq_id = str(payload.get("qq_id", ""))
    pool_id = str(payload.get("pool_id", ""))
    data = draw_record_repository.reset_quota(qq_id, pool_id)
    return ApiResponse(success=True, message="重置成功", data=data)


@router.get("/admin/user-records", response_model=ApiResponse)
async def get_user_records(qq_id: str = Query(...)):
    items, total = draw_record_repository.list_history(qq_id, page=1, page_size=20)
    return ApiResponse(success=True, message="查询成功", data={"list": items, "total": total})
