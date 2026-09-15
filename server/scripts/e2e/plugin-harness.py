"""插件侧端到端测试脚手架。

用途：在 AstrBot 之外，用真实插件代码去请求真实的 Node 后端，
验证「插件 DTO 解析 ↔ Node 返回结构」完全对齐。

它做了三件事：
  1. 注入 astrbot.api / astrbot.api.event / astrbot.api.star 的最小替身；
  2. 把仓库根目录注册成 data.plugins.astrbot_plugin_dailycarddraw 包
     （与 AstrBot star_manager 的加载路径完全一致），从而让 main.py 里的相对导入生效；
  3. 用 urllib 实现一个 httpx 兼容层（AttributeError-free 的最小实现），
     这样即使当前解释器没装 httpx，插件代码也能发出真实 HTTP 请求。

用法（由 server/scripts/smoke-plugin.js 调用）：
    python plugin-harness.py <repo_root> <base_url> <api_token> <qq_id>
"""

from __future__ import annotations

import asyncio
import json
import sys
import types
import urllib.error
import urllib.parse
import urllib.request

PLUGIN_PACKAGE = "data.plugins.astrbot_plugin_dailycarddraw"


# --------------------------------------------------------------------------- httpx 兼容层


class HTTPError(Exception):
    """对应 httpx.HTTPError。"""


class _Response:
    def __init__(self, status_code: int, text: str) -> None:
        self.status_code = status_code
        self.text = text

    def json(self):
        return json.loads(self.text)


class AsyncClient:
    """只实现插件用到的 httpx.AsyncClient 子集。"""

    def __init__(self, timeout: float | None = None, **_: object) -> None:
        self.timeout = timeout

    async def __aenter__(self) -> "AsyncClient":
        return self

    async def __aexit__(self, *exc_info: object) -> bool:
        return False

    async def request(
        self,
        method: str,
        url: str,
        params: dict | None = None,
        json: dict | None = None,
        headers: dict | None = None,
    ) -> _Response:
        if params:
            query = urllib.parse.urlencode({k: str(v) for k, v in params.items()})
            url = f"{url}?{query}"

        body = None
        prepared_headers = dict(headers or {})
        if json is not None:
            body = json_dumps(json).encode("utf-8")
            prepared_headers.setdefault("Content-Type", "application/json")

        request = urllib.request.Request(
            url, data=body, headers=prepared_headers, method=method.upper()
        )

        def send() -> _Response:
            try:
                with urllib.request.urlopen(request, timeout=self.timeout or 10) as response:
                    return _Response(response.status, response.read().decode("utf-8"))
            except urllib.error.HTTPError as error:
                return _Response(error.code, error.read().decode("utf-8"))
            except urllib.error.URLError as error:
                raise HTTPError(f"请求后端失败：{error}") from error

        return await asyncio.to_thread(send)


def json_dumps(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False)


def install_httpx_stub() -> str:
    try:
        import httpx  # noqa: F401

        return "real httpx"
    except ImportError:
        module = types.ModuleType("httpx")
        module.HTTPError = HTTPError
        module.AsyncClient = AsyncClient
        sys.modules["httpx"] = module
        return "stub"


# --------------------------------------------------------------------------- astrbot 替身


class _Logger:
    def info(self, *args, **kwargs):
        print("[plugin:info]", *args)

    def warning(self, *args, **kwargs):
        print("[plugin:warn]", *args)

    def error(self, *args, **kwargs):
        print("[plugin:error]", *args)


class AstrBotConfig(dict):
    """插件只用到了 dict 接口（.get）。"""


class Context:
    pass


class Star:
    def __init__(self, context):
        self.context = context


class _AnyFilter:
    """任何装饰器调用都原样返回被装饰函数。"""

    def __call__(self, *args, **kwargs):
        def decorator(func):
            return func

        return decorator

    def __getattr__(self, name):
        return self


def install_astrbot_stub() -> None:
    astrbot = types.ModuleType("astrbot")
    api = types.ModuleType("astrbot.api")
    api.AstrBotConfig = AstrBotConfig
    api.logger = _Logger()

    event = types.ModuleType("astrbot.api.event")
    event.AstrMessageEvent = object
    event.filter = _AnyFilter()

    star = types.ModuleType("astrbot.api.star")
    star.Context = Context
    star.Star = Star

    astrbot.api = api
    api.event = event
    api.star = star

    sys.modules["astrbot"] = astrbot
    sys.modules["astrbot.api"] = api
    sys.modules["astrbot.api.event"] = event
    sys.modules["astrbot.api.star"] = star


def install_plugin_package(repo_root: str) -> None:
    """按 AstrBot 的方式注册包路径，让 main.py 的相对导入可用。"""
    data = types.ModuleType("data")
    data.__path__ = [repo_root]
    plugins = types.ModuleType("data.plugins")
    plugins.__path__ = [repo_root]
    package = types.ModuleType(PLUGIN_PACKAGE)
    package.__path__ = [repo_root]

    sys.modules["data"] = data
    sys.modules["data.plugins"] = plugins
    sys.modules[PLUGIN_PACKAGE] = package


# --------------------------------------------------------------------------- 事件替身


class FakeEvent:
    class _MessageObj:
        class sender:
            user_id = "0"

    message_obj = _MessageObj()

    def __init__(self, qq_id: str, nickname: str = "端到端测试", group_id: str = "999000") -> None:
        self._qq_id = qq_id
        self._nickname = nickname
        self._group_id = group_id

    def get_sender_id(self) -> str:
        return self._qq_id

    def get_sender_name(self) -> str:
        return self._nickname

    def get_group_id(self) -> str:
        return self._group_id

    def is_private_chat(self) -> bool:
        return False

    def plain_result(self, text: str) -> str:
        return text


# --------------------------------------------------------------------------- 主流程


async def collect(agen) -> list[str]:
    return [chunk async for chunk in agen]


async def run(repo_root: str, base_url: str, api_token: str, qq_id: str) -> dict:
    httpx_mode = install_httpx_stub()
    install_astrbot_stub()
    install_plugin_package(repo_root)

    import importlib

    main = importlib.import_module(f"{PLUGIN_PACKAGE}.main")

    config = {
        "plugin_enabled": True,
        "enable_group_usage": True,
        "enable_private_usage": True,
        "default_pool_key": "normal_pool",
        "api_base_url": base_url,
        "api_token": api_token,
        "request_timeout_seconds": 5,
        "admin_qq_list": [qq_id],
    }
    plugin = main.DailyCardDrawPlugin(Context(), config)
    event = FakeEvent(qq_id)

    results: dict[str, object] = {
        "httpx": httpx_mode,
        "package": main.__package__,
        "python": sys.version.split()[0],
    }

    results["help"] = await collect(plugin.help(event))
    results["draw_single"] = await collect(plugin.draw(event, "", ""))
    results["draw_single_again"] = await collect(plugin.draw(event, "", ""))
    results["draw_ten"] = await collect(plugin.draw(event, "十连", ""))
    results["today"] = await collect(plugin.today(event, ""))
    results["history"] = await collect(plugin.history(event, 1, 10))
    results["stats"] = await collect(plugin.stats(event))
    results["pool_list"] = await collect(plugin.pool_list(event))
    results["reset"] = await collect(plugin.reset_quota(event, qq_id, "1"))
    results["draw_after_reset"] = await collect(plugin.draw(event, "", ""))
    results["bad_pool"] = await collect(plugin.draw(event, "no_such_pool", ""))

    return results


def main() -> int:
    if len(sys.argv) < 5:
        print(
            "用法: plugin-harness.py <repo_root> <base_url> <api_token> <qq_id> [result_path]",
            file=sys.stderr,
        )
        return 2

    repo_root, base_url, api_token, qq_id = sys.argv[1:5]
    result_path = sys.argv[5] if len(sys.argv) > 5 else ""

    try:
        results = asyncio.run(run(repo_root, base_url, api_token, qq_id))
    except Exception as exc:  # noqa: BLE001
        import traceback

        traceback.print_exc()
        payload = json_dumps({"error": str(exc)})
        print(f"---RESULT---\n{payload}")
        if result_path:
            with open(result_path, "w", encoding="utf-8") as handle:
                handle.write(payload)
        return 3

    payload = json_dumps(results)
    print("---RESULT---")
    print(payload)
    if result_path:
        # 同时落盘：调用方（Node 测试脚本）在受限环境下无法通过管道读取 stdout。
        with open(result_path, "w", encoding="utf-8") as handle:
            handle.write(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
