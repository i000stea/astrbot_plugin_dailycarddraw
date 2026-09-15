from __future__ import annotations

from fastapi import FastAPI

from app.controllers.admin_controller import router as admin_router
from app.controllers.draw_controller import router as draw_router
from app.controllers.query_controller import router as query_router
from app.infrastructure.db import get_mysql_dsn
from app.infrastructure.settings import settings

app = FastAPI(title="Daily CardDraw Backend")

app.include_router(draw_router, prefix=settings.api_prefix, tags=["draw"])
app.include_router(query_router, prefix=settings.api_prefix, tags=["query"])
app.include_router(admin_router, prefix=settings.api_prefix, tags=["admin"])


@app.get("/")
async def root():
    return {
        "success": True,
        "message": "daily-carddraw-backend is running",
        "data": {
            "environment": settings.environment,
            "api_prefix": settings.api_prefix,
            "mysql_dsn": get_mysql_dsn(mask_password=True),
        },
    }
