# AstrBot 每日抽卡插件

`astrbot_plugin_dailycarddraw` 是一个面向 QQ 号的 AstrBot 每日抽卡插件。

它要解决的不是「返回一个随机结果」，而是给 QQ 群 / 私聊提供一套**按自然日、按 QQ 号全局统计**的抽卡玩法：

- 群友每天可以抽一次单抽、一次十连，次数按 QQ 号每日重置
- 抽卡结果、积分、稀有度会落到云端数据库，可随时查询今日记录、历史记录与累计统计
- 管理员可以查看卡池、重置指定 QQ 的当日次数
- 插件只做「命令接入 + 参数解析 + 权限判断 + 文本渲染」，抽卡概率、次数扣减、落库统计全部由云端后端 API 负责

> 数据范围约定：同一个 QQ 在不同群里共享同一份每日抽卡状态（QQ 全局口径）。

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
- 一个已部署的每日抽卡云端后端（见下方「云端后端」），插件本身不直连数据库

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
| `api_base_url` | string | 空 | 云端后端地址，例如 `https://your-domain.com`；插件会在其后拼接 `/api/daily-carddraw/*` |
| `api_token` | string（secret） | 空 | 后端鉴权 Token，会以 `Authorization: Bearer <token>` 发送；后端不需要鉴权时留空 |
| `default_pool_key` | string | `normal_pool` | 默认卡池 Key，用户不带卡池参数时使用 |
| `request_timeout_seconds` | float | `10` | 请求后端的超时时间（秒），最小按 1 秒生效 |
| `admin_qq_list` | list | `[]` | 管理员 QQ 白名单，列表内 QQ 才能使用 `/卡池列表`、`/重置抽卡次数` |
| `enable_group_usage` | bool | `true` | 是否允许群聊触发 |
| `enable_private_usage` | bool | `true` | 是否允许私聊触发 |

**最少需要配置的两项是 `api_base_url` 和 `admin_qq_list`**：不填 `api_base_url` 时，任何命令都会直接返回「未配置 `api_base_url`，当前无法请求云端后端。」

## 命令一览

> 命令前缀取决于 AstrBot 的唤醒前缀设置（默认 `/`），下表以 `/` 为例。

### 用户命令（所有人可用）

| 命令 | 说明 |
| --- | --- |
| `/抽卡` | 对默认卡池单抽 |
| `/抽卡 十连` | 对默认卡池十连（`10连`、`ten` 等效） |
| `/抽卡 <卡池Key>` | 对指定卡池单抽，例如 `/抽卡 normal_pool` |
| `/抽卡 <卡池Key> 十连` | 对指定卡池十连 |
| `/今日抽卡 [卡池Key]` | 查询本人今日次数与最近结果，省略卡池则用默认卡池 |
| `/抽卡历史 [页码] [每页数量]` | 分页查询本人历史记录，默认 `1 10` |
| `/抽卡统计` | 查询本人累计统计（总抽数、累计积分、SSR / UR 数量等） |
| `/抽卡帮助` | 查看帮助文本（别名：`抽卡help`、`carddraw_help`） |

### 管理员命令（仅 `admin_qq_list` 内 QQ 可用）

| 命令 | 说明 |
| --- | --- |
| `/卡池列表` | 查看全部卡池的 ID、Key、启用状态与单抽/十连开关 |
| `/重置抽卡次数 <QQ号> <卡池ID>` | 请求后端重置指定 QQ 在指定卡池的当日次数 |

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

## 云端后端

插件通过 HTTP 调用配套的 FastAPI 后端，接口前缀为 `/api/daily-carddraw`：

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `/api/daily-carddraw/draw` | POST | 执行抽卡 |
| `/api/daily-carddraw/today` | GET | 今日记录 |
| `/api/daily-carddraw/history` | GET | 历史记录（分页） |
| `/api/daily-carddraw/stats` | GET | 累计统计 |
| `/api/daily-carddraw/admin/pools` | GET | 卡池列表 |
| `/api/daily-carddraw/admin/reset-quota` | POST | 重置当日次数 |
| `/api/daily-carddraw/admin/user-records` | GET | 指定 QQ 的抽卡记录 |

后端部署方式见 `backend/README.md`，建表脚本为 `backend/sql/001_init_daily_carddraw.sql`。

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
  backend/                # 配套 FastAPI 云端后端骨架
    app/                  # controllers / services / repositories / models
    sql/                  # MySQL 建表脚本
  docs/                   # 设计与规划文档
```

设计上刻意把「命令解析」与「文本渲染」分开：后续要把纯文本结果改成图片卡片或富文本，只需替换 `app/utils/message_formatter.py`，不必改动业务流程。

## 项目状态与限制

- 插件侧命令、服务层与后端客户端已接通，云端后端目前是骨架版：路由与返回结构已固定，仓储层仍使用内存假数据，尚未接入真实 MySQL 查询
- 因此**必须提供可用的后端 API**，命令才会返回真实抽卡数据
- 管理员卡池维护（新建/修改卡池、卡牌与权重配置）在后端接口落地前尚未开放命令入口
- 保底机制、UP 池、卡牌图鉴、群专属活动池等属于后续阶段规划

## 相关文档

- `docs/00_项目总览.md`：目标、方向与交付范围
- `docs/01_需求与范围.md`：功能边界
- `docs/02_技术架构.md`：插件侧与云端侧分层
- `docs/03_数据模型与云端接口.md`：表结构与 API 草案
- `docs/04_命令与管理接口.md`：命令约定与回复模板
- `docs/05_开发顺序.md`：实施顺序与验收重点
- `backend/README.md`：后端部署与接口说明

## 许可证

许可证见仓库根目录 `LICENSE`。
