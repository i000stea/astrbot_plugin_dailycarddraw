from __future__ import annotations

from app.repositories.pool_repository import PoolRepository


class PoolService:
    """卡池管理服务。"""

    def __init__(self):
        self.pool_repository = PoolRepository()

    def list_pools(self) -> dict:
        return {"list": self.pool_repository.list_pools()}
