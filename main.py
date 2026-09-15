"""
AstrBot 每日抽卡插件
基于文档规划实现的插件侧最小 MVC 骨架。

约定：所有命令处理函数在回复后都会调用 `event.stop_event()`。
AstrBot 的管道是「按优先级依次调用所有被唤醒的 handler，再把事件交给默认 LLM 请求」，
不终止事件时，同一条 `/抽卡` 会继续被其他插件（多机器人路由、防抖、群聊上下文等）和
大模型各自回答一遍。这里的做法与 AstrBot 内置插件一致：先 `yield` 让回复进入
RespondStage 正常发送（保留引用/At 等发送装饰），发送后再终止事件传播。
"""

from __future__ import annotations

from astrbot.api import AstrBotConfig, logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Context, Star

from .app.controllers.admin_controller import AdminController
from .app.controllers.draw_controller import DrawController
from .app.controllers.query_controller import QueryController
from .app.infrastructure.api_client import ApiClientError, DailyCardDrawApiClient
from .app.infrastructure.auth import AdminAuthService
from .app.infrastructure.config_helper import ConfigHelper
from .app.models.enums import DrawMode
from .app.services.draw_service import DrawService
from .app.services.pool_service import PoolService
from .app.services.query_service import QueryService


class DailyCardDrawPlugin(Star):
    """每日抽卡插件入口。"""

    def __init__(self, context: Context, config: AstrBotConfig):
        super().__init__(context)
        self.config = config

        self.config_helper = ConfigHelper(config)
        self.admin_auth_service = AdminAuthService(self.config_helper)
        self.api_client = DailyCardDrawApiClient(self.config_helper)

        self.draw_service = DrawService(self.api_client)
        self.query_service = QueryService(self.api_client)
        self.pool_service = PoolService(self.api_client)

        self.draw_controller = DrawController(
            self.config_helper,
            self.admin_auth_service,
            draw_service=self.draw_service,
        )
        self.query_controller = QueryController(
            self.config_helper,
            self.admin_auth_service,
            query_service=self.query_service,
        )
        self.admin_controller = AdminController(
            self.config_helper,
            self.admin_auth_service,
            pool_service=self.pool_service,
        )

        # 在实例化时打印，作为「插件已被 AstrBot 成功加载」的可靠标志：
        # 通过 WebUI 重载/启用插件也会走到这里，而 on_astrbot_loaded 只在 AstrBot 启动时触发一次。
        logger.info("每日抽卡插件已加载完成。")

    @filter.on_astrbot_loaded()
    async def on_astrbot_loaded(self):
        """AstrBot 初始化完成后的提示。"""
        logger.info("每日抽卡插件已就绪，等待抽卡指令。")

    def _parse_pool_and_mode(self, *segments: str) -> tuple[str, DrawMode]:
        clean_segments = [segment.strip() for segment in segments if str(segment).strip()]
        if not clean_segments:
            return self.config_helper.get_default_pool_key(), DrawMode.SINGLE

        draw_mode = DrawMode.SINGLE
        if clean_segments[-1] in {"十连", "10连", "ten"}:
            draw_mode = DrawMode.TEN
            clean_segments = clean_segments[:-1]

        pool_key = clean_segments[0] if clean_segments else self.config_helper.get_default_pool_key()
        return pool_key, draw_mode

    def _build_context(self, event: AstrMessageEvent):
        return self.draw_controller.build_context(event)

    @filter.command("抽卡")
    async def draw(self, event: AstrMessageEvent, arg1: str = "", arg2: str = ""):
        """执行单抽或十连。"""
        context = self._build_context(event)
        pool_key, draw_mode = self._parse_pool_and_mode(arg1, arg2)
        try:
            message = await self.draw_controller.handle_draw(
                context=context,
                pool_key=pool_key,
                draw_mode=draw_mode,
            )
        except ApiClientError as exc:
            message = f"抽卡失败：{exc}"
        except ValueError as exc:
            message = f"抽卡参数异常：{exc}"
        # 回复后终止事件传播：避免同一个命令再被其他插件的 handler 或默认 LLM 请求回答一遍。
        yield event.plain_result(message)
        event.stop_event()

    @filter.command("今日抽卡")
    async def today(self, event: AstrMessageEvent, pool_key: str = ""):
        """查询今日抽卡结果。"""
        context = self._build_context(event)
        target_pool_key = pool_key.strip() or self.config_helper.get_default_pool_key()
        try:
            message = await self.query_controller.handle_today(
                context=context,
                pool_key=target_pool_key,
            )
        except ApiClientError as exc:
            message = f"查询今日记录失败：{exc}"
        yield event.plain_result(message)
        event.stop_event()

    @filter.command("抽卡历史")
    async def history(self, event: AstrMessageEvent, page: int = 1, page_size: int = 10):
        """查询抽卡历史。"""
        context = self._build_context(event)
        try:
            message = await self.query_controller.handle_history(
                context=context,
                page=page,
                page_size=page_size,
            )
        except ApiClientError as exc:
            message = f"查询历史失败：{exc}"
        yield event.plain_result(message)
        event.stop_event()

    @filter.command("抽卡统计")
    async def stats(self, event: AstrMessageEvent):
        """查询累计统计。"""
        context = self._build_context(event)
        try:
            message = await self.query_controller.handle_stats(context=context)
        except ApiClientError as exc:
            message = f"查询统计失败：{exc}"
        yield event.plain_result(message)
        event.stop_event()

    @filter.command("卡池列表")
    async def pool_list(self, event: AstrMessageEvent):
        """管理员查看卡池列表。"""
        context = self._build_context(event)
        try:
            message = await self.admin_controller.handle_pool_list(context=context)
        except ApiClientError as exc:
            message = f"查询卡池失败：{exc}"
        yield event.plain_result(message)
        event.stop_event()

    @filter.command("重置抽卡次数")
    async def reset_quota(self, event: AstrMessageEvent, target_qq_id: str, pool_id: str):
        """管理员重置指定 QQ 的当日次数。"""
        context = self._build_context(event)
        try:
            message = await self.admin_controller.handle_reset_quota(
                context=context,
                target_qq_id=target_qq_id,
                pool_id=pool_id,
            )
        except ApiClientError as exc:
            message = f"重置次数失败：{exc}"
        yield event.plain_result(message)
        event.stop_event()

    @filter.command("抽卡帮助", alias={"抽卡help", "carddraw_help"})
    async def help(self, event: AstrMessageEvent):
        """查看帮助。"""
        message = "\n".join(
            [
                "【每日抽卡插件帮助】",
                "1. /抽卡 —— 默认卡池单抽",
                "2. /抽卡 十连 —— 默认卡池十连（10连、ten 等效）",
                "3. /抽卡 <卡池Key> —— 指定卡池单抽，例如 /抽卡 normal_pool",
                "4. /抽卡 <卡池Key> 十连 —— 指定卡池十连",
                "5. /今日抽卡 [卡池Key] —— 今日次数与最近结果",
                "6. /抽卡历史 [页码] [每页数量] —— 历史记录，默认 1 10",
                "7. /抽卡统计 —— 累计统计",
                "8. /抽卡帮助 —— 本帮助（别名：/抽卡help、/carddraw_help）",
                "管理员命令：/卡池列表、/重置抽卡次数 <QQ号> <卡池ID>（两个参数必填）",
            ]
        )
        yield event.plain_result(message)
        event.stop_event()

    async def terminate(self):
        """插件卸载时清理。"""
        logger.info("每日抽卡插件已卸载。")
