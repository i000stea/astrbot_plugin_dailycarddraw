"""
AstrBot 每日抽卡插件
基于文档规划实现的插件侧最小 MVC 骨架。

约定一：所有命令处理函数在回复后都会调用 `event.stop_event()`。
AstrBot 的管道是「按优先级依次调用所有被唤醒的 handler，再把事件交给默认 LLM 请求」，
不终止事件时，同一条 `/抽卡` 会继续被其他插件（多机器人路由、防抖、群聊上下文等）和
大模型各自回答一遍。这里的做法与 AstrBot 内置插件一致：先 `yield` 让回复进入
RespondStage 正常发送（保留引用/At 等发送装饰），发送后再终止事件传播。

约定二：指令前面带 @ 提及时走 `command_after_mention` 兜底。
AstrBot 的指令过滤器要求 message_str 以指令名开头，而 aiocqhttp 适配器会把「非本机器人」
的提及以 ` @昵称(qq) ` 的形式拼进 message_str，因此「@A @机器人 /抽卡」这类消息匹配不到
`/抽卡`（现象：命令没反应，消息被丢给大模型）。

约定三：诊断日志（`debug_log_enabled`，默认开启）。
开启后，插件会在以下位置打印 `【抽卡诊断】` 开头的日志：
  1. `__init__`：插件加载 + 配置快照；
  2. 每条指令进入处理函数时：命中的指令与参数；
  3. `on_llm_request` 钩子：事件全量结构、指令匹配模拟、注册表快照、会话/全局开关。
第 3 条是排查「命令没反应」的关键：这条钩子能跑起来，就说明本插件的 handler 已经通过
了「插件已激活 + 在 plugin_set 白名单里」两道过滤；反之则说明没通过。
"""
from __future__ import annotations

import re

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

# 指令名按长度倒序，避免「抽卡」抢先匹配「抽卡历史」等。
_COMMAND_NAMES = (
    "重置抽卡次数",
    "抽卡历史",
    "抽卡统计",
    "抽卡帮助",
    "今日抽卡",
    "卡池列表",
    "抽卡",
)

# 「@提及 排在指令前面」的兜底匹配：提及必须在最前面，提及与指令之间必须有空白
# （aiocqhttp 会把非本机器人的提及写成 ` @昵称(qq) `，唤醒前缀跟在后面），
# 指令后面只允许跟空格分隔的参数或直接结束，避免把普通聊天误判成指令。
# (?s) 让 . 可以跨行，与插件里 re.compile 的结果保持一致。
_MENTION_COMMAND_PATTERN = (
    r"(?s)^\s*(?:@|\[At:).+?(?:\s+/\s*|\s+)"
    r"(?P<command>" + "|".join(_COMMAND_NAMES) + r")"
    r"(?:\s+(?P<args>.*))?$"
)

# 诊断日志里描述消息段时，按类型挑几个关键字段，避免把图片 base64 之类的东西打出来。
_COMPONENT_FIELDS = {
    "plain": ("text",),
    "at": ("qq", "name"),
    "atall": ("qq",),
    "reply": ("id", "sender_id", "sender_nickname", "message_str"),
    "image": ("file", "url"),
    "record": ("file", "url"),
    "video": ("file", "url"),
    "file": ("name", "url", "file_"),
    "face": ("id",),
    "poke": ("id",),
    "forward": ("id",),
    "json": ("data",),
}


def _truncate(value: object, limit: int = 400) -> str:
    """把任意对象转成字符串并截断，避免日志被超长内容淹没。"""
    text = str(value)
    if len(text) <= limit:
        return text
    return f"{text[:limit]}…(共 {len(text)} 字符)"


def _enum_text(value: object) -> str:
    """Enum 取 value/name，其它对象直接 str。"""
    inner = getattr(value, "value", None)
    if inner is not None:
        return str(inner)
    name = getattr(value, "name", None)
    if name is not None:
        return str(name)
    return str(value)


def _describe_component(component: object) -> str:
    """描述一个消息段：类型 + 关键字段（已截断）。"""
    comp_type = _enum_text(getattr(component, "type", type(component).__name__))
    fields = _COMPONENT_FIELDS.get(comp_type.lower(), ())
    parts = []
    for field_name in fields:
        if hasattr(component, field_name):
            parts.append(f"{field_name}={_truncate(getattr(component, field_name, None), 120)!r}")
    return f"{type(component).__name__}<{comp_type}>({', '.join(parts)})"


def _describe_chain(components: object) -> str:
    """描述整条消息链。"""
    if not components:
        return "[]"
    try:
        return "[" + ", ".join(_describe_component(item) for item in components) + "]"
    except Exception as exc:  # noqa: BLE001 - 诊断代码本身不允许影响主流程
        return f"（消息链解析失败：{exc!r}）"


class DailyCardDrawPlugin(Star):
    """每日抽卡插件入口。"""

    _MENTION_COMMAND_RE = re.compile(_MENTION_COMMAND_PATTERN)

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
        self._log_config_snapshot()

    @filter.on_astrbot_loaded()
    async def on_astrbot_loaded(self):
        """AstrBot 初始化完成后的提示。"""
        logger.info("每日抽卡插件已就绪，等待抽卡指令。")
        self._log_registry_snapshot("AstrBot 加载完成")

    # ------------------------------------------------------------------ 诊断日志

    def _log_config_snapshot(self) -> None:
        """打印插件配置快照（不包含任何密钥内容）。"""
        if not self.config_helper.is_debug_log_enabled():
            return
        try:
            logger.info(
                "【抽卡诊断】插件加载 + 配置快照："
                f"plugin_enabled={self.config_helper.is_enabled()} "
                f"enable_group_usage={self.config_helper.is_group_enabled()} "
                f"enable_private_usage={self.config_helper.is_private_enabled()} "
                f"api_base_url={'已配置' if self.config_helper.get_api_base_url() else '未配置'} "
                f"api_token={'已配置' if self.config_helper.get_api_token() else '未配置'} "
                f"default_pool_key={self.config_helper.get_default_pool_key()!r} "
                f"request_timeout_seconds={self.config_helper.get_request_timeout_seconds()} "
                f"admin_qq_list={len(self.config_helper.get_admin_qq_list())} 人"
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(f"【抽卡诊断】打印配置快照失败：{exc!r}")

    def _log_command_entry(self, command: str, **details: object) -> None:
        """指令处理函数被调用时的入口日志。"""
        if not self.config_helper.is_debug_log_enabled():
            return
        try:
            detail_text = " ".join(f"{key}={value!r}" for key, value in details.items())
            logger.info(f"【抽卡诊断】命中指令 /{command}：{detail_text}")
        except Exception as exc:  # noqa: BLE001
            logger.error(f"【抽卡诊断】打印指令入口日志失败：{exc!r}")

    def _dump_event(self, event: AstrMessageEvent) -> str:
        """把事件的完整结构摊平成多行文本。"""
        message_obj = getattr(event, "message_obj", None)
        sender = getattr(message_obj, "sender", None)
        lines = [
            f"  umo={event.unified_msg_origin!r}",
            f"  platform={event.get_platform_name()}/{event.get_platform_id()}",
            f"  message_type={_enum_text(event.get_message_type())} "
            f"is_private_chat={event.is_private_chat()} "
            f"self_id={event.get_self_id()!r} group_id={event.get_group_id()!r}",
            f"  sender={event.get_sender_name()!r}/{event.get_sender_id()!r} role={event.role!r}",
            "  message_obj: "
            f"message_id={getattr(message_obj, 'message_id', None)!r} "
            f"session_id={getattr(message_obj, 'session_id', None)!r} "
            f"timestamp={getattr(message_obj, 'timestamp', None)!r}",
            "  sender_obj: "
            f"user_id={getattr(sender, 'user_id', None)!r} "
            f"nickname={getattr(sender, 'nickname', None)!r} "
            f"card={getattr(sender, 'card', None)!r}",
            f"  message_str={event.message_str!r}",
            "  状态: "
            f"is_wake={event.is_wake} "
            f"is_at_or_wake_command={event.is_at_or_wake_command} "
            f"plugins_name={event.plugins_name!r}",
            f"  chain={_describe_chain(event.get_messages())}",
            f"  raw_message={_truncate(getattr(message_obj, 'raw_message', None), 900)}",
        ]
        return "\n".join(lines)

    @staticmethod
    def _dump_registry() -> str:
        """打印本插件在 AstrBot 注册表里的真实状态。"""
        try:
            from astrbot.core.star.star import star_map
            from astrbot.core.star.star_handler import star_handlers_registry
        except Exception as exc:  # noqa: BLE001
            return f"  （无法导入注册表：{exc!r}）"

        lines = []
        metadata = star_map.get(__name__)
        if metadata is None:
            lines.append(f"  star_map 里没有本插件的模块路径 {__name__!r}（会被 waking_check 静默跳过）")
        else:
            lines.append(
                "  star_map: "
                f"name={getattr(metadata, 'name', None)!r} "
                f"activated={getattr(metadata, 'activated', None)!r} "
                f"reserved={getattr(metadata, 'reserved', None)!r} "
                f"module_path={getattr(metadata, 'module_path', None)!r} "
                f"root_dir_name={getattr(metadata, 'root_dir_name', None)!r} "
                f"version={getattr(metadata, 'version', None)!r}"
            )

        handlers = star_handlers_registry.get_handlers_by_module_name(__name__)
        lines.append(f"  handler 共 {len(handlers)} 个：")
        for handler in handlers:
            filter_texts = []
            for filter_ref in handler.event_filters:
                text = type(filter_ref).__name__
                command_name = getattr(filter_ref, "command_name", None)
                alias = getattr(filter_ref, "alias", None)
                regex = getattr(filter_ref, "regex", None)
                if command_name:
                    text += f"(command_name={command_name!r}, alias={sorted(alias) if alias else []})"
                if regex is not None:
                    text += f"(regex={getattr(regex, 'pattern', regex)!r})"
                filter_texts.append(text)
            lines.append(
                f"    - {handler.handler_name}: "
                f"event_type={_enum_text(getattr(handler, 'event_type', None))} "
                f"enabled={handler.enabled} "
                f"filters={filter_texts}"
            )
        return "\n".join(lines)

    @staticmethod
    def _simulate_command_match(event: AstrMessageEvent) -> str:
        """按 CommandFilter 的规则判断每条指令「本来能不能匹配上」。"""
        try:
            from astrbot.core.star.star_handler import star_handlers_registry
        except Exception as exc:  # noqa: BLE001
            return f"  （无法导入注册表：{exc!r}）"

        message_str = event.get_message_str()
        normalized = re.sub(r"\s+", " ", message_str.strip())
        lines = [
            f"  is_at_or_wake_command={event.is_at_or_wake_command}"
            "（CommandFilter 的前置条件，False 时所有指令都不会匹配）",
            f"  message_str={message_str!r} -> 规范化后={normalized!r}",
        ]
        for handler in star_handlers_registry.get_handlers_by_module_name(__name__):
            for filter_ref in handler.event_filters:
                get_names = getattr(filter_ref, "get_complete_command_names", None)
                if callable(get_names):
                    names = list(get_names())
                    matched = any(
                        normalized == name or normalized.startswith(f"{name} ")
                        for name in names
                    )
                    lines.append(
                        f"  {handler.handler_name}: 指令名={names} -> "
                        f"{'可匹配' if matched else '匹配不上'}"
                    )
                    continue
                regex = getattr(filter_ref, "regex", None)
                if regex is not None:
                    matched = bool(regex.search(message_str.strip()))
                    lines.append(
                        f"  {handler.handler_name}: 兜底正则 -> "
                        f"{'可匹配' if matched else '匹配不上'}"
                    )
        return "\n".join(lines)

    @staticmethod
    async def _dump_switches(event: AstrMessageEvent) -> str:
        """读取会话级 / 全局的插件开关（AstrBot 内部存储）。"""
        try:
            from astrbot.core import sp
        except Exception as exc:  # noqa: BLE001
            return f"  （无法导入 sp：{exc!r}）"

        lines = []
        try:
            session_config = await sp.get_async(
                scope="umo",
                scope_id=event.unified_msg_origin,
                key="session_plugin_config",
                default={},
            )
            lines.append(f"  session_plugin_config={_truncate(session_config, 800)}")
        except Exception as exc:  # noqa: BLE001
            lines.append(f"  session_plugin_config 读取失败：{exc!r}")

        for key in ("inactivated_plugins", "alter_cmd", "plugin_set"):
            try:
                value = await sp.global_get(key, [])
            except Exception as exc:  # noqa: BLE001
                lines.append(f"  {key} 读取失败：{exc!r}")
                continue
            lines.append(f"  {key}={_truncate(value, 500)}")
        return "\n".join(lines)

    def _log_registry_snapshot(self, reason: str) -> None:
        """打印注册表快照。"""
        if not self.config_helper.is_debug_log_enabled():
            return
        try:
            logger.info(f"【抽卡诊断】注册表快照（{reason}）\n" + self._dump_registry())
        except Exception as exc:  # noqa: BLE001
            logger.error(f"【抽卡诊断】打印注册表快照失败：{exc!r}")

    @filter.on_llm_request()
    async def debug_report(self, event: AstrMessageEvent, req: object | None = None):
        """诊断钩子（协程，不能 yield）。

        这条钩子能跑到，说明本插件的 handler 已经通过「插件已激活」和「在 plugin_set
        白名单里」两道过滤；此时如果指令处理函数仍然没有执行，问题就只可能在
        waking_check 的指令过滤 / 会话级插件开关上——下面把这些信息一并打出来。
        """
        if not self.config_helper.is_debug_log_enabled():
            return

        sections = ["【抽卡诊断】===== 收到 LLM 请求（本插件已被放行到 LLM 阶段）====="]
        try:
            sections.append("【抽卡诊断】① 事件详情\n" + self._dump_event(event))
        except Exception as exc:  # noqa: BLE001
            sections.append(f"【抽卡诊断】① 事件详情打印失败：{exc!r}")
        try:
            sections.append("【抽卡诊断】② 指令匹配模拟\n" + self._simulate_command_match(event))
        except Exception as exc:  # noqa: BLE001
            sections.append(f"【抽卡诊断】② 指令匹配模拟失败：{exc!r}")
        try:
            sections.append("【抽卡诊断】③ 注册表快照\n" + self._dump_registry())
        except Exception as exc:  # noqa: BLE001
            sections.append(f"【抽卡诊断】③ 注册表快照失败：{exc!r}")
        try:
            sections.append("【抽卡诊断】④ 会话/全局开关\n" + await self._dump_switches(event))
        except Exception as exc:  # noqa: BLE001
            sections.append(f"【抽卡诊断】④ 会话/全局开关打印失败：{exc!r}")
        try:
            sections.append(
                "【抽卡诊断】⑤ 本次 LLM 请求\n"
                f"  prompt={_truncate(getattr(req, 'prompt', None), 300)}\n"
                f"  system_prompt 长度={len(str(getattr(req, 'system_prompt', '') or ''))}"
            )
        except Exception as exc:  # noqa: BLE001
            sections.append(f"【抽卡诊断】⑤ LLM 请求信息打印失败：{exc!r}")

        logger.info("\n".join(sections))

    # ------------------------------------------------------------------ 业务逻辑

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
        self._log_command_entry(
            "抽卡",
            arg1=arg1,
            arg2=arg2,
            pool_key=pool_key,
            draw_mode=draw_mode.value,
            qq_id=context.qq_id,
        )
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
        self._log_command_entry(
            "今日抽卡",
            pool_key=target_pool_key,
            qq_id=context.qq_id,
        )
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
        self._log_command_entry(
            "抽卡历史",
            page=page,
            page_size=page_size,
            qq_id=context.qq_id,
        )
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
        self._log_command_entry("抽卡统计", qq_id=context.qq_id)
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
        self._log_command_entry("卡池列表", qq_id=context.qq_id)
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
        self._log_command_entry(
            "重置抽卡次数",
            target_qq_id=target_qq_id,
            pool_id=pool_id,
            qq_id=context.qq_id,
        )
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
        self._log_command_entry("抽卡帮助")
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

    @filter.regex(_MENTION_COMMAND_PATTERN)
    async def command_after_mention(self, event: AstrMessageEvent):
        """@ 提及排在指令前面时的兜底入口。

        AstrBot 的指令过滤器要求 message_str 以指令名开头。在群里「@A @机器人 /抽卡」这种
        消息中，AstrBot 会把不是本机器人自己的提及写进 message_str（aiocqhttp 的格式是
        ` @昵称(qq) `），于是 `/抽卡` 匹配不到，命令没有任何回复、消息直接落到大模型。

        这里把前面的提及剥掉，再交给同一套命令处理函数：参数解析规则一致，回复后同样
        `event.stop_event()`，所以不会出现第二条回复。
        """
        # 只在消息确实是发给本机器人的时候兜底（被 @ / 被引用回复 / 带唤醒前缀），
        # 避免群里 @ 了别的机器人时本机器人抢答，造成多机器人重复回答。
        if not event.is_at_or_wake_command:
            return

        match = self._MENTION_COMMAND_RE.match(event.message_str or "")
        if not match:
            return

        command_stream = self._dispatch_command(
            match.group("command"),
            event,
            (match.group("args") or "").split(),
        )
        if command_stream is None:
            return

        if self.config_helper.is_debug_log_enabled():
            logger.info(
                f"【抽卡诊断】指令前带 @ 提及，走兜底匹配：message_str={event.message_str!r} "
                f"command={match.group('command')!r} args={(match.group('args') or '')!r}"
            )
        async for result in command_stream:
            yield result

    def _dispatch_command(self, command: str, event: AstrMessageEvent, args: list[str]):
        """把兜底匹配到的指令转交给对应的命令处理函数。

        返回命令处理函数的异步生成器（内部会 yield 回复并终止事件传播）；
        没有可用的处理方式时返回 None，此时调用方不回复、也不终止事件。
        """
        if command == "抽卡":
            return self.draw(event, self._arg(args, 0), self._arg(args, 1))
        if command == "今日抽卡":
            return self.today(event, self._arg(args, 0))
        if command == "抽卡历史":
            return self.history(
                event,
                self._to_int(self._arg(args, 0), 1),
                self._to_int(self._arg(args, 1), 10),
            )
        if command == "抽卡统计":
            return self.stats(event)
        if command == "卡池列表":
            return self.pool_list(event)
        if command == "抽卡帮助":
            return self.help(event)
        if command == "重置抽卡次数" and len(args) >= 2:
            return self.reset_quota(event, args[0], args[1])
        return None

    @staticmethod
    def _arg(args: list[str], index: int) -> str:
        """取第 index 个参数，缺省时返回空字符串（与指令参数的默认值一致）。"""
        return args[index] if len(args) > index else ""

    @staticmethod
    def _to_int(value: str, default: int) -> int:
        """把参数转成 int，非法时退回默认值（与指令参数的 int 转换行为对齐）。"""
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    async def terminate(self):
        """插件卸载时清理。"""
        logger.info("每日抽卡插件已卸载。")
