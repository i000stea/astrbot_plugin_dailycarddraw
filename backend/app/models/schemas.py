from __future__ import annotations

from pydantic import BaseModel, Field


class DrawRequest(BaseModel):
    """抽卡请求。"""

    qq_id: str = Field(..., min_length=1)
    group_id: str = ""
    pool_key: str = Field(..., min_length=1)
    draw_mode: str = Field(..., min_length=1)
    nickname: str = ""


class CardResultSchema(BaseModel):
    """单张卡片返回。"""

    card_name: str
    rarity: str
    score: int


class QuotaSchema(BaseModel):
    """配额返回。"""

    single_used: int
    single_limit: int
    ten_used: int
    ten_limit: int


class DrawResponseData(BaseModel):
    """抽卡响应数据。"""

    record_no: str
    pool_name: str
    draw_mode: str
    total_score: int
    quota: QuotaSchema
    cards: list[CardResultSchema]


class ApiResponse(BaseModel):
    """统一 API 响应。"""

    success: bool = True
    message: str = "ok"
    data: dict | list | DrawResponseData | None = None
