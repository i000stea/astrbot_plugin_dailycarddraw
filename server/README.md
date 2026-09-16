# 每日抽卡 Node 后端（server/）

这是 `astrbot_plugin_dailycarddraw` 配套的 Node.js 服务，一台服务器上同时承担三件事：

1. **抽卡计算**：概率、每日次数扣减、记录落库、累计统计，全部在这里完成；
2. **给插件调用的 HTTP 接口**：路径与字段和插件 `app/infrastructure/api_client.py` 完全一致；
3. **给浏览器看的前端**：`/` 查询页（今日 / 历史 / 统计），`/admin` 管理后台（卡池、卡牌、权重、用户、流水）。

> 关键约定：插件侧一行代码都不需要改，把 `api_base_url` 指过来即可 —— 接口契约见下方「接口一览」。

## 目录结构

```text
server/
  src/
    server.js            启动入口：连接自检 → 监听端口 → 优雅退出
    config.js            配置读取（.env）
    db.js                mysql2 连接池 + 事务封装 + 建表自检
    time.js              按 APP_TIMEZONE 生成时间串（每日次数按此时区重置）
    container.js         仓储 / 服务装配
    app.js               Express 应用与统一错误处理
    domain/draw.js       加权随机、稀有度比较
    routes/              插件契约接口、插件管理接口、后台接口
    services/            抽卡事务、查询、卡池与卡牌、管理
    repositories/        MySQL 访问（全部参数化）
    middleware/          后台 JWT 登录
  public/                前端静态页（index.html / admin.html / assets）
  sql/                   建表脚本（复用原 001_init_daily_carddraw.sql）
  deploy/nginx.conf      宝塔反向代理片段
  scripts/               自测脚本（含真实插件端到端联调）
  .env.example           配置样例
  ecosystem.config.js    PM2 配置
```

## 抽卡图片渲染

从 `v1.1.0` 起，`/draw` 接口会在抽卡成功后生成结果图片，并在 `data.image_url` 返回相对地址：

```json
{
  "image_url": "/api/daily-carddraw/images/20260701-000123.png"
}
```

渲染规则：

- 单抽：生成一张 `320×480` 卡片图；
- 十连：高度保持 `480`，宽度按 `320 × 张数` 横向拼接长图；
- 背景：暗灰色 `#2B2B2B`；
- 渐变：以卡片中心为稀有度颜色最浓处，向上下两端透明；
- 头像：`resource/avatar/{card_key}.png`，居中、不铺满，找不到则跳过；
- 职业：`resource/profession/{profession}.png`，左上角，找不到则留空；
- 稀有度：`resource/rarity/rarity{1-6}.png`，右下角；
- 缓存：生成文件默认放在 `server/cache/draw-images/`，缓存 12 小时；
- 资源目录 `server/resource/` 体积较大，**单独上传**，不要打进更新包。

图片生成失败只会降级为纯文本，不会影响抽卡落库。



## 一、准备数据库（宝塔面板）

1. 宝塔 → 数据库 → 添加数据库，记下库名 / 用户名 / 密码；
2. 导入表结构（二选一）：
   - 宝塔「数据库 → 管理 → 导入」，选择 `server/sql/001_init_daily_carddraw.sql`；
   - 或命令行：`mysql -u 库用户名 -p 库名 < server/sql/001_init_daily_carddraw.sql`。

脚本会建 8 张表，并写入示例卡池 `normal_pool`（常驻卡池）、示例卡牌及其初始权重与稀有度权重。

## 二、部署 Node 服务

宝塔 → 软件商店 → 安装 **Node 版本管理器**（选 20 LTS）与 **PM2 管理器**。

```bash
cd /www/wwwroot
git clone https://github.com/i000stea/astrbot_plugin_dailycarddraw.git
cd astrbot_plugin_dailycarddraw/server

# 安装依赖（宝塔上用面板里选的 Node 版本；也可用面板的「Node 项目」一键安装依赖）
npm install --omit=dev

# 配置
cp .env.example .env
vi .env            # 填 MySQL、ADMIN_API_TOKEN、PANEL_PASSWORD、PANEL_JWT_SECRET

# 自检：启动时会校验 MySQL 连通性与 8 张表是否齐全
node src/server.js
# 看到 [boot] daily-carddraw-server 已启动 就可以 Ctrl+C 了
```

用 PM2 守护并开机自启：

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup        # 按提示执行它输出的那条命令
```

也可以直接在宝塔「Node 项目」里添加：项目目录选 `.../server`，启动文件 `src/server.js`，端口 `3100`。

## 三、配置项（server/.env）

| 变量 | 说明 |
| --- | --- |
| `APP_PORT` | 监听端口，默认 `3100` |
| `APP_HOST` | 默认 `0.0.0.0`（AstrBot 在容器里时必须是 `0.0.0.0`，不能是 `127.0.0.1`） |
| `APP_TIMEZONE` | 每日次数的自然日口径，默认 `Asia/Shanghai`。**不要依赖容器/服务器时区**，否则凌晨会错开 |
| `MAX_PAGE_SIZE` | 单页最大条数，默认 50 |
| `DRAW_TEN_COUNT` | 十连一次抽几张，默认 10 |
| `MYSQL_*` | 宝塔里创建的库信息 |
| `ADMIN_API_TOKEN` | 与插件配置里的 `api_token` 对应；留空则插件侧管理接口不鉴权 |
| `PANEL_USERNAME` / `PANEL_PASSWORD` | 管理后台登录账号密码；也可改用 `PANEL_PASSWORD_SHA256` 存哈希 |
| `PANEL_JWT_SECRET` | 后台登录态签名密钥，**建议固定填一个长随机串**，否则重启后要重新登录 |

## 四、Nginx 反向代理（前端 + API 同域）

把 `deploy/nginx.conf` 里的内容贴进宝塔站点的配置文件（或按「反向代理 → /api → 127.0.0.1:3100」配置），要点：

- 站点根目录指向 `.../server/public`，前端由 Nginx 直接托管；
- `/api/` 与 `/manage/api/` 反代到 `http://127.0.0.1:3100`；
- **不要把 3100 端口在宝塔「安全」里对公网放行**，外部流量统一走域名。

这样浏览器访问前后端同域，完全不用处理 CORS。

## 五、让 Docker 里的 AstrBot 访问这个服务（最容易踩坑的一步）

AstrBot 跑在容器里时，容器内的 `127.0.0.1` 是**容器自己**，填 `http://127.0.0.1:3100` 一定连不上。三种可行写法：

### 方案 A：用 Docker 网关 IP（推荐，不用改容器）

Node 监听 `0.0.0.0:3100`，插件里填 `api_base_url = http://172.17.0.1:3100`。

如果 AstrBot 是 docker compose 起的、用了自定义网络，网关不一定是 `172.17.0.1`，先查：

```bash
docker inspect astrbot --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}'
```

### 方案 B：给容器加 host-gateway（Docker 20.10+）

在 AstrBot 的 compose 服务里加：

```yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

插件里填 `api_base_url = http://host.docker.internal:3100`。

### 方案 C：把 Node 也放进 AstrBot 所在的 docker 网络

插件里填 `api_base_url = http://daily-carddraw-server:3100`（用容器名）。最干净，但 Node 需要一起容器化。

### 连通性验证（按顺序做）

```bash
# 1. 宿主机上确认服务活着
curl http://127.0.0.1:3100/health
curl http://172.17.0.1:3100/health

# 2. 进 AstrBot 容器里再确认一次（容器一定自带 Python，比 curl 可靠）
docker exec -it astrbot python -c "import urllib.request;print(urllib.request.urlopen('http://172.17.0.1:3100/health').read().decode())"
```

**防火墙坑**：容器访问宿主机端口走的是 docker0 网桥入站，被系统防火墙（firewalld/ufw）或宝塔安全插件拦截时，现象是「宿主机 curl 通、容器里连不上」。排查方法：临时关闭防火墙确认，然后按需放行 docker0 网段，而不是把 3100 对公网开放。

## 六、插件侧配置

AstrBot → 插件管理 → 每日抽卡插件 → 配置：

| 配置项 | 填写内容 |
| --- | --- |
| `api_base_url` | 按上面选定的地址，例如 `http://172.17.0.1:3100`。**不要**带 `/api/daily-carddraw`，代码会自动拼 |
| `api_token` | 与服务端 `ADMIN_API_TOKEN` 一致（不鉴权时两边都留空） |
| `default_pool_key` | `normal_pool` |
| `admin_qq_list` | 允许用 `/卡池列表`、`/重置抽卡次数` 的 QQ |

保存后重载插件，在群里发 `/抽卡` 验证。

## 日常更新：一键打包 + 推送

改完代码后不用手工挑文件，`server/` 下自带脚本：

```powershell
cd server
.\updatePush.cmd                            # 只打包：生成 update\ 与 update.tar.gz
.\updatePush.cmd -Server 1.2.3.4            # 打包 + 上传 + 远程 npm install + pm2 重启
.\updatePush.cmd -Server 1.2.3.4 -DryRun    # 只预览将要执行的远程命令，不真的上传
```

常用参数：`-Server` / `-User` / `-Port` / `-TargetDir` 覆盖脚本顶部配置区的默认值；`-SkipInstall` 只更新文件、不动依赖与进程；`-Force` 跳过上传前确认。

脚本做的事：生成 `update\`（不含 `node_modules`、`scripts`、`.env`）→ 打包 `update.tar.gz` → `scp` 到服务器 `/tmp` → 远程把旧版本备份到 `/tmp/daily-carddraw-server-backup.tar.gz` → 解包覆盖（**不会动服务器上的 `.env` 与 `node_modules`**）→ `npm install --omit=dev` → `pm2 restart` → 请求 `/health` 自检。每步都会写进 `server/update-push.log`。

首次连接会提示输入服务器密码；配置好 SSH 公钥后可完全无人值守。

> `updatePush.cmd` 是纯 ASCII 启动器（双击即可运行），真正的逻辑在 `updatePush.ps1`，该文件保存为 **UTF-8 with BOM**。用编辑器改完请保持 UTF-8 BOM，否则 Windows PowerShell 5.1 会把中文读成乱码。

## 接口一览

### 插件契约接口（前缀 `/api/daily-carddraw`）

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/draw` | POST | 抽卡，`{qq_id,nickname,group_id,pool_key,draw_mode}`，`draw_mode` 为 `single`/`ten` |
| `/today` | GET | `?qq_id=&pool_key=` |
| `/history` | GET | `?qq_id=&page=&page_size=` |
| `/stats` | GET | `?qq_id=` |
| `/pools` | GET | 启用中的卡池（前端下拉用，插件不用） |
| `/health` | GET | 健康检查 |
| `/admin/pools` | GET | 卡池列表（需 `Authorization: Bearer <ADMIN_API_TOKEN>`） |
| `/admin/reset-quota` | POST | `{qq_id,pool_id}`，`pool_id` 可传数字主键或 `pool_key` |
| `/admin/user-records` | GET | `?qq_id=` |

返回统一为 `{success, message, data}`；出错时 HTTP 4xx/5xx + `success:false` + 可读 `message`（插件会直接把 `message` 展示给用户）。

### 管理后台接口（前缀 `/manage/api`，除登录外都需要 JWT）

| 接口 | 说明 |
| --- | --- |
| `POST /login` | `{username,password}` → `{token}` |
| `GET /overview` | 总记录、总积分、用户数、今日记录与人数、卡池数 |
| `GET/POST /pools`、`PUT/DELETE /pools/:id` | 卡池增删改查 |
| `POST /pools/:id/copy` | 复制卡池（连同卡牌权重、稀有度权重、开关与配额） |
| `GET/PUT /pools/:id/cards` | 卡池内卡牌与权重（`PUT` 整体替换） |
| `GET/POST /cards`、`PUT/DELETE /cards/:id` | 卡牌增删改查（字段：card_key/card_name/rarity(1~6)/profession/obtain/score_value；`obtain` 为字符串数组） |
| `POST /cards/import` | 上传 JSON 批量录入卡牌（`{cards: <gacha JSON>}`，按 card_key upsert；`obtain` 的逗号多值会转成数组） |
| `GET /users` | 用户档案分页（`keyword` 支持 QQ / 昵称模糊） |
| `GET /users/:qqId/records` | 某个 QQ 的抽卡记录 |
| `POST /users/:qqId/reset-quota` | 重置某 QQ 当日次数 |
| `GET /records` | 抽卡流水（可按 `qq_id`、`pool_id` 过滤，带卡牌明细） |

## 前端页面

- `/` **查询页**：输入 QQ 号 + 选卡池 → 今日次数、最近结果、累计统计、历史分页。
- `/admin` **管理后台**：登录后进入「概览 / 卡池 / 卡牌 / 用户 / 流水」五个标签页；「卡牌」页支持**上传 JSON 一键录入**（直接吃 `resource/gacha_YYYY-MM-DD.json`），也可单条增删改，并支持按稀有度 / 职业 / 获取方式**多选筛选**（含「全部」）、关键词搜索、以及按稀有度或 card_key 本地排序；「卡池」页支持**一键复制卡池**（含卡牌权重、稀有度权重与开关/配额）；「卡池配置」分两段设置——先配**稀有度权重**（决定各星级概率，改动实时联动概率显示），再配每张卡的**卡牌权重与 UP**（决定同星级内概率），支持按获取方式**一键批量加入 / 移除**，并可筛选「显示全部 / 仅权重&gt;0 / 仅权重=0」，权重 0 = 不参与，保存立即生效。

前端是零构建的静态页（原生 JS + fetch），不需要 npm build，改完刷新即可。

## 本地自测

```bash
cd server
npm install
npm run smoke          # 抽卡链路 + HTTP 接口（用内存 MySQL 替身，不需要真实数据库）
npm run smoke:plugin   # 真实插件代码 → 真实 Express 服务 的端到端联调
```

`npm run smoke:plugin` 需要本机有 Python；没有会自动跳过。可用 `PYTHON_BIN=/path/to/python3` 指定解释器。

> 内存替身只用于验证代码逻辑与接口契约，**SQL 是否被真实 MySQL 接受仍需在服务器上跑一次**：导入 `sql/001_init_daily_carddraw.sql` 后启动服务，看启动自检是否通过，再在群里发一条 `/抽卡`。

## 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 启动即退出，提示缺少表 | 没有导入 `sql/001_init_daily_carddraw.sql` |
| 启动即退出，提示无法连接 MySQL | `.env` 里的 `MYSQL_*` 不对，或宝塔数据库没开远程/本机权限 |
| 插件报「未配置 `api_base_url`」 | 插件配置没填 |
| 插件报「请求云端接口失败：…」 | 容器到宿主机的网络不通，按第五节排查；也确认 `APP_HOST=0.0.0.0` |
| 插件报「云端接口返回异常状态码：403/401」 | `api_token` 与 `ADMIN_API_TOKEN` 不一致 |
| 群里提示「今日单抽次数已用完」但后台显示 0 | 看 `APP_TIMEZONE` 与 `daily_quota.quota_date`，别让服务器时区是 UTC |
| 后台登录后一刷新就退出 | 没设置 `PANEL_JWT_SECRET`，重启后签名变了 |
| 抽卡一直出不想要的卡 | 到「卡池」→「卡池配置」检查权重，权重 0 表示不参与 |

## 安全建议

1. `ADMIN_API_TOKEN` 与 `PANEL_JWT_SECRET` 都用 32 位以上随机串：
   `openssl rand -hex 32`；
2. 管理后台密码不要与宝塔面板相同，优先用 `PANEL_PASSWORD_SHA256`；
3. 3100 端口不对公网放行，只让 Nginx 和 docker 网桥访问；
4. 建议给 `/admin` 再叠加一层 IP 白名单（见 `deploy/nginx.conf` 注释）。
