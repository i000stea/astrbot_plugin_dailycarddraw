from __future__ import annotations

from typing import Any

import httpx

from .config_helper import ConfigHelper


class ApiClientError(Exception):
    """远程 API 调用异常。"""


class DailyCardDrawApiClient:
    """每日抽卡后端 API 客户端。"""

    def __init__(self, config_helper: ConfigHelper):
        self.config_helper = config_helper

    def _build_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        token = self.config_helper.get_api_token()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        base_url = self.config_helper.get_api_base_url()
        if not base_url:
            raise ApiClientError("未配置 `api_base_url`，当前无法请求云端后端。")

        url = f"{base_url}{path}"
        timeout = self.config_helper.get_request_timeout_seconds()

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.request(
                    method=method,
                    url=url,
                    params=params,
                    json=json_body,
                    headers=self._build_headers(),
                )
        except httpx.HTTPError as exc:
            raise ApiClientError(f"请求云端接口失败：{exc}") from exc

        if response.status_code >= 400:
            raise ApiClientError(
                f"云端接口返回异常状态码：{response.status_code}，响应内容：{response.text}"
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise ApiClientError("云端接口未返回合法 JSON。") from exc

        if isinstance(payload, dict) and payload.get("success") is False:
            raise ApiClientError(str(payload.get("message", "云端接口返回失败。")))

        return payload

    async def draw(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/api/daily-carddraw/draw",
            json_body=payload,
        )

    async def get_today(self, qq_id: str, pool_key: str) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/api/daily-carddraw/today",
            params={"qq_id": qq_id, "pool_key": pool_key},
        )

    async def get_history(self, qq_id: str, page: int, page_size: int) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/api/daily-carddraw/history",
            params={"qq_id": qq_id, "page": page, "page_size": page_size},
        )

    async def get_user_stats(self, qq_id: str) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/api/daily-carddraw/stats",
            params={"qq_id": qq_id},
        )

    async def list_pools(self) -> dict[str, Any]:
        return await self._request("GET", "/api/daily-carddraw/admin/pools")

    async def reset_quota(self, qq_id: str, pool_id: str) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/api/daily-carddraw/admin/reset-quota",
            json_body={"qq_id": qq_id, "pool_id": pool_id},
        )

    async def get_user_records(self, qq_id: str) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/api/daily-carddraw/admin/user-records",
            params={"qq_id": qq_id},
        )
