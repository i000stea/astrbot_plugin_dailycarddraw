# AstrBot 每日抽卡插件

`astrbot_plugin_dailycarddraw` 是一个面向 QQ 号的 AstrBot 每日抽卡插件。

它要解决的不是「返回一个随机结果」，而是给 QQ 群 / 私聊提供一套**按自然日、按 QQ 号全局统计**的抽卡玩法：

- 群友每天可以抽一次单抽、一次十连，次数按 QQ 号每日重置
- 抽卡结果、积分、稀有度会落到云端数据库，可随时查询今日记录、历史记录与累计统计
- 管理员可以查看卡池、重置指定 QQ 的当日次数
- 插件只做「命令接入 + 参数解析 + 权限判断 + 文本渲染」，抽卡概率、次数扣减、落库统计全部由云端后端 API 负责

> 数据范围约定：同一个 QQ 在不同群里共享同一份每日抽卡状态（QQ 全局口径）。

## 指令速查

> 指令前缀取决于 AstrBot 的唤醒前缀设置（默认 `/`），下表以 `/` 为例。群聊中「@ 机器人」或以 `/` 开头都能唤醒；被 @ 时前缀可省略。
>
> 命令前缀、权限（普通 / 管理员）可以在 AstrBot WebUI 的「指令管理」中统一查看与调整。
>
> 本插件的**每条命令在回复后都会终止该消息的事件传播**（先 `yield` 回复、再 `event.stop_event()`，与 AstrBot 内置插件一致）：回复照常按 AstrBot 的发送设置（引用 / At / 分段）发出，但同一条 `/抽卡` 不会再被其他插件的 handler 或默认的大模型请求回答一遍，避免一次命令收到多条互相冲突的回复。
>
> 指令前面带 `@` 提及也能触发：`@机器人 /抽卡`、`@别人 @机器人 /抽卡` 都会命中同一条命令。AstrBot 原生的指令匹配要求消息以指令名开头，被提及前缀挡住时会匹配不到（消息就被当成普通聊天丢给大模型），插件为此加了一条正则兜底；兜底只在消息确实是发给本机器人时生效，不会抢答 @ 了别的机器人的指令。

### 用户指令（所有人可用）

| 指令 | 说明 |
| --- | --- |
| `/抽卡` | 对默认卡池单抽 |
| `/抽卡 十连` | 对默认卡池十连（`10连`、`ten` 等效） |
| `/抽卡 <卡池Key>` | 对指定卡池单抽，例如 `/抽卡 normal_pool` |
| `/抽卡 <卡池Key> 十连` | 对指定卡池十连 |
| `/今日抽卡 [卡池Key]` | 查询本人今日次数与最近结果，省略卡池则用默认卡池 |
| `/抽卡历史 [页码] [每页数量]` | 分页查询本人历史记录，默认 `1 10` |
| `/抽卡统计` | 查询本人累计统计（总抽数、累计积分、SSR / UR 数量等） |
| `/抽卡帮助` | 查看帮助文本（别名：`/抽卡help`、`/carddraw_help`） |

### 管理员指令（仅 `admin_qq_list` 内的 QQ 可用）

| 指令 | 说明 |
| --- | --- |
| `/卡池列表` | 查看全部卡池的 ID、Key、启用状态与单抽/十连开关 |
| `/重置抽卡次数 <QQ号> <卡池ID>` | 请求后端重置指定 QQ 在指定卡池的当日次数，两个参数都必须带上 |

### 参数说明

| 参数 | 取值 | 位置 |
| --- | --- | --- |
| 卡池 Key | 后端卡池表里的 `pool_key`，默认卡池由配置项 `default_pool_key` 决定（默认 `normal_pool`） | `/抽卡`、`/今日抽卡` 的第 1 个位置参数 |
| 抽取模式 | 留空 = 单抽；`十连` / `10连` / `ten` = 十连 | `/抽卡` 的最后一个位置参数 |
| 页码 / 每页数量 | 整数，默认 `1` / `10`，服务端上限由 `MAX_PAGE_SIZE` 控制 | `/抽卡历史` 的第 1、2 个位置参数 |
| QQ 号 / 卡池 ID | 目标 QQ 号；卡池 ID 可填卡池主键或 `pool_key` | `/重置抽卡次数` 的第 1、2 个位置参数 |

> `/重置抽卡次数` 的两个参数是必填的：只发 `/重置抽卡次数` 时 AstrBot 会直接回「必要参数缺失」提示，不会进入插件逻辑。

## 功能一览

| 能力 | 说明 |
| --- | --- |
| 单抽 / 十连 | 默认卡池或指定卡池，均可单抽与十连 |
| 多卡池 | 用卡池 Key 区分卡池，后续可扩展活动池 |
| 每日次数 | 单抽与十连分别计数，按自然日重置 |
| 今日记录 | 查询本人当日次数与最近抽卡结果 |
| 历史记录 | 分页查询本人历史抽卡明细 |
| 累计统计 | 总抽数、单抽/十连次数、累计积分、SSR / UR 数量 |
| 管理能力 | 管理员查看卡池列表、重置指定 QQ 的当日次数 |
| 使用范围控制 | 可分别开关群聊 / 私聊使用 |

## 安装

### 前置条件

- AstrBot `>=4.16,<5`
- 平台适配器：`aiocqhttp`、`qq_official` 或 `qq_official_webhook`
- 一个已部署的每日抽卡后端（本仓库 `server/`，Node.js + MySQL），插件本身不直连数据库

### 安装步骤

把本仓库放到 AstrBot 的插件目录下（若该插件已上架 AstrBot 插件市场，也可直接在 WebUI「插件市场」中搜索安装）：

```bash
cd <AstrBot>/data/plugins
git clone https://github.com/i000stea/astrbot_plugin_dailycarddraw.git
```

插件依赖仅一个：

```bash
pip install -r requirements.txt
```

安装后在 WebUI「插件管理」中重载插件，日志出现 `每日抽卡插件已加载完成。` 即为加载成功。

## 配置说明

配置项定义在 `_conf_schema.json`，在 AstrBot WebUI 的插件配置页填写即可。

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `plugin_enabled` | bool | `true` | 插件总开关，关闭后所有抽卡、查询、管理命令都不生效 |
| `api_base_url` | string | 空 | 后端地址，例如 `https://your-domain.com`；插件会在其后拼接 `/api/daily-carddraw/*`。AstrBot 跑在 Docker 里时不能用 `127.0.0.1`，应填 Docker 网关 IP（如 `http://172.17.0.1:3100`），详见 `server/README.md` |
| `api_token` | string（secret） | 空 | 后端鉴权 Token，会以 `Authorization: Bearer <token>` 发送；后端不需要鉴权时留空 |
| `default_pool_key` | string | `normal_pool` | 默认卡池 Key，用户不带卡池参数时使用 |
| `request_timeout_seconds` | float | `10` | 请求后端的超时时间（秒），最小按 1 秒生效 |
| `admin_qq_list` | list | `[]` | 管理员 QQ 白名单，列表内 QQ 才能使用 `/卡池列表`、`/重置抽卡次数` |
| `enable_group_usage` | bool | `true` | 是否允许群聊触发 |
| `enable_private_usage` | bool | `true` | 是否允许私聊触发 |

**最少需要配置的两项是 `api_base_url` 和 `admin_qq_list`**：不填 `api_base_url` 时，任何命令都会直接返回「未配置 `api_base_url`，当前无法请求云端后端。」

## 输出示例

抽卡成功：

```text
【每日抽卡】
QQ：123456789
卡池：常驻池
模式：十连
结果：
1. 星穹旅人 SSR
2. 巡星学徒 SR
本次积分：34
今日单抽：0/1
今日十连：1/1
记录号：20240501-000123
```

今日记录查询：

```text
【今日抽卡记录】
卡池：常驻池
今日单抽：1/1
今日十连：0/1
最近结果：
1. 星穹旅人 SSR
```

累计统计：

```text
【累计统计】
QQ：123456789
昵称：未记录
总抽卡次数：12
单抽次数：4
十连次数：8
累计积分：256
SSR 数量：3
UR 数量：0
```

## 后端服务（server/）

插件通过 HTTP 调用本仓库配套的 Node.js 后端，接口前缀为 `/api/daily-carddraw`：

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `/api/daily-carddraw/draw` | POST | 执行抽卡 |
| `/api/daily-carddraw/today` | GET | 今日记录 |
| `/api/daily-carddraw/history` | GET | 历史记录（分页） |
| `/api/daily-carddraw/stats` | GET | 累计统计 |
| `/api/daily-carddraw/pools` | GET | 启用中的卡池（前端使用） |
| `/api/daily-carddraw/admin/pools` | GET | 卡池列表（需 Token） |
| `/api/daily-carddraw/admin/reset-quota` | POST | 重置当日次数（需 Token） |
| `/api/daily-carddraw/admin/user-records` | GET | 指定 QQ 的抽卡记录（需 Token） |

后端同时自带前端：`/` 为记录查询页，`/admin` 为管理后台（卡池、卡牌、权重、用户、流水）。

部署方式见 `server/README.md`（宝塔面板 + PM2 + Nginx，含 AstrBot 在 Docker 中时的网络配置），建表脚本为 `server/sql/001_init_daily_carddraw.sql`。

## 常见提示与排查

| 提示 | 原因与处理 |
| --- | --- |
| 未配置 `api_base_url`，当前无法请求云端后端。 | 在插件配置里填写后端地址 |
| 插件当前已关闭。 | `plugin_enabled` 为 `false` |
| 插件当前未开启私聊使用。 / 群聊使用 | 对应的 `enable_private_usage` / `enable_group_usage` 为 `false` |
| 未能识别当前消息对应的 QQ 号。 | 平台适配器未提供发送者 ID |
| 你没有权限使用管理命令。 | 当前 QQ 不在 `admin_qq_list` 中 |
| 请求云端接口失败：… | 网络不可达或超时，可调大 `request_timeout_seconds` |
| 云端接口返回异常状态码：… | 后端报错或 Token 不正确 |

### 发 `/抽卡` 完全没有回复（连报错都没有）

「完全没有回复」和「回复报错」是两类问题：上表里所有提示都是**插件已经跑起来**才可能出现的，只要你能看到其中任意一条，说明插件本身没问题，问题在配置或后端。

真正什么都不回时，说明这条消息压根没进插件的命令处理函数，AstrBot 会把它当成普通聊天丢给大模型（典型现象：机器人用它自己的人格回了一句「投币口在左手边」之类的话，而不是抽卡结果）。按下面的顺序在 AstrBot 日志里逐项确认：

1. **插件是否真的加载成功**。日志里应有这两行：
   - `Loading plugin astrbot_plugin_dailycarddraw ...`
   - `每日抽卡插件已加载完成。`（插件实例化时打印，启动、WebUI 重载/启用都会出现；AstrBot 启动完成后还会有 `每日抽卡插件已就绪，等待抽卡指令。`）

   如果只有第一行、或出现 `Failed to import plugin astrbot_plugin_dailycarddraw: ...`，说明插件导入失败：AstrBot WebUI 的「插件管理」页会把这类插件列进**加载失败**列表，先按那里的报错修。
2. **是否是包结构/导入问题**。插件的子模块全部使用相对导入（如 `from .app.controllers import ...`），因此 AstrBot 必须把**整个插件目录**当成一个 Python 包来加载：更新插件时务必把 `main.py` 与 `app/` 目录一起同步进去，不能只拷 `main.py`。历史版本曾使用绝对导入（`from app.xxx import ...`），在本机目录下直接跑没问题，但被 AstrBot 以 `data.plugins.astrbot_plugin_dailycarddraw.main` 加载时会抛 `ModuleNotFoundError: No module named 'app'`，表现为「插件已启用但毫无反应」。
3. **插件是否处于启用状态**。这里有两层开关，都要确认：
   - **全局**：日志里 `enabled_plugins_name: [...]` 就是当前生效的插件白名单（取 AstrBot 的 `plugin_set` 配置）。列表里没有 `astrbot_plugin_dailycarddraw` 时，即使代码正常，命令也不会被分发。
   - **会话级**：AstrBot 支持在单个会话（群 / 私聊）里单独停用某个插件。被会话禁用时，处理函数会被静默过滤掉，日志（DEBUG）里会出现 `Plugin astrbot_plugin_dailycarddraw is disabled in session ...; skipping handler draw.`。到 WebUI 对应会话的插件开关里重新启用即可。
4. **消息是不是「@ 提及 + 指令」的格式**。AstrBot 的指令匹配要求 `message_str` 以指令名开头，而 aiocqhttp 适配器会把提及按自己的规则拼进 `message_str`：
   - `@机器人 /抽卡`：AstrBot ≥ 4.28 的适配器会把**本机器人自己**的那个提及丢掉、并对文本 `strip()`，`message_str` 就是 `/抽卡`，原生匹配正常；较早版本会把提及也写进 `message_str`，此时由下面的兜底接管；
   - `@别人 @机器人 /抽卡`，或指令前面还出现了别的提及 → `message_str` 变成 ` @别人(qq) /抽卡`，原生匹配不到，由插件的 `command_after_mention` 正则兜底接管（DEBUG 日志里会打印「指令前带 @ 提及，已走兜底匹配」）。
   兜底只在 `event.is_at_or_wake_command` 为真（这条消息确实是发给本机器人的）时生效，所以不会在群里 @ 了别的机器人时抢答。
5. **命令处理函数是否被激活**。把日志级别开到 DEBUG 后发一次 `/抽卡`，应能看到：
   - `plugin -> astrbot_plugin_dailycarddraw - draw`

   这一行是 AstrBot 管道 `star_request` 阶段打印的「实际调用的处理函数」。**没有这一行** = 命令没有匹配到插件（回到第 1～4 步）；**有这一行但没有回复** = 处理函数内部出错，同一条日志附近会有 `Star ... handle error: ...`。
6. **更新代码后要重载插件**。改完 `data/plugins/astrbot_plugin_dailycarddraw/` 下的文件后，需要在 WebUI「插件管理」里点一次重载，或重启 AstrBot；旧代码会一直留在内存里。
7. **排查命令本身是否可用**。`/抽卡帮助` 不依赖后端，能回帮助文本就说明插件链路是通的，此时问题只剩 `api_base_url` 配置与后端连通性（见 `server/README.md` 第五节）。

> 提示：群里同时挂了多个机器人 / 防抖、多机器人路由类插件时，也要确认这条消息最终是被本插件所在的那个机器人实例处理的（日志里对应 `[QQ-xxxxx(aiocqhttp)]` 那一行）。

### 诊断日志（`debug_log_enabled`，默认开启）

插件内置了排查「命令没反应」用的诊断日志，开关是配置项 `debug_log_enabled`（默认开）。开启后日志里会出现 `【抽卡诊断】` 开头的内容，分别在三个位置打印：

| 位置 | 内容 |
| --- | --- |
| 插件加载时（`__init__` / 启动时的 `on_astrbot_loaded`） | 配置快照：`plugin_enabled`、群聊/私聊开关、`api_base_url` 与 `api_token` 是否已配置、默认卡池、超时、管理员数量；注册表快照（插件名 / `activated` / 每个 handler 的事件类型、`enabled`、过滤器与指令名） |
| 每条指令进入处理函数时 | `命中指令 /抽卡：...`，附带解析出的参数与 QQ 号（证明 handler 真的被执行了） |
| 收到 LLM 请求时（`on_llm_request` 钩子） | ① 事件完整结构（umo、平台、消息类型、发送者、`message_str`、消息链各消息段的字段、`is_wake` / `is_at_or_wake_command` / `plugins_name`、原始 `raw_message`）；② **指令匹配模拟**（按 `CommandFilter` 的规则逐条判断「本来能不能匹配上」）；③ 注册表快照；④ 会话级 `session_plugin_config` 与全局 `inactivated_plugins` / `alter_cmd` / `plugin_set`；⑤ 本次 LLM 请求的 prompt 与 system_prompt 长度 |

判断方法很简单：

- 能看到第 3 条，说明本插件已经通过了「插件已激活 + 在 `plugin_set` 白名单里」两道过滤（钩子和指令 handler 走同一套注册表过滤），问题只可能在唤醒阶段的指令过滤或会话级插件开关上——第 2、4 条会直接给出答案；
- 看不到第 3 条，说明插件在更前面就被过滤掉了，那就看第 1 条里的 `activated` / `name` 与日志里的 `enabled_plugins_name` 是否对得上。

排查完成后把这个开关关掉即可，不影响任何功能。

## 工程结构

```text
astrbot_plugin_dailycarddraw/
  main.py                 # 插件入口：命令注册、参数解析、权限结果返回
  metadata.yaml           # 插件元信息
  _conf_schema.json       # 插件配置项定义
  requirements.txt        # 插件依赖（httpx）
  app/
    controllers/          # 命令意图识别、权限校验（draw / query / admin）
    services/             # 抽卡、查询、卡池业务服务
    models/               # DTO、枚举、视图模型（CommandContext）
    infrastructure/       # API 客户端、配置读取、管理员鉴权、时间工具
    utils/                # 统一文本渲染 message_formatter
  server/                 # 配套 Node.js 后端 + 前端管理后台
    src/                  # 抽卡计算、配额事务、查询、卡池与卡牌管理
    public/               # 查询页与管理后台（零构建静态页）
    sql/                  # MySQL 建表脚本
    deploy/               # Nginx 反向代理配置片段
    scripts/              # 自测脚本（含真实插件端到端联调）
  docs/                   # 设计与规划文档
```

设计上刻意把「命令解析」与「文本渲染」分开：后续要把纯文本结果改成图片卡片或富文本，只需替换 `app/utils/message_formatter.py`，不必改动业务流程。

## 项目状态与限制

- 插件侧命令、服务层与后端客户端已接通，`server/` 提供完整的抽卡计算、每日配额（事务 + 行锁）、记录落库、统计与管理接口
- 后端自带前端：`/` 记录查询页、`/admin` 管理后台（卡池与卡牌维护、权重配置、重置次数、流水查看）
- 因此部署前需要先按 `server/README.md` 起好后端并填好 `api_base_url`，命令才会返回真实抽卡数据
- 保底机制、UP 池、卡牌图鉴、群专属活动池等属于后续阶段规划

## 相关文档

- `docs/00_项目总览.md`：目标、方向与交付范围
- `docs/01_需求与范围.md`：功能边界
- `docs/02_技术架构.md`：插件侧与云端侧分层
- `docs/03_数据模型与云端接口.md`：表结构与 API 草案
- `docs/04_命令与管理接口.md`：命令约定与回复模板
- `docs/05_开发顺序.md`：实施顺序与验收重点
- `server/README.md`：后端部署、接口说明与 Docker 网络配置

## 许可证

许可证见仓库根目录 `LICENSE`。
