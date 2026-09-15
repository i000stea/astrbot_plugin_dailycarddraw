# 每日抽卡后端

这是 `astrbot_plugin_dailycarddraw` 配套的云端后端骨架，负责承接插件侧的 HTTP 请求，并为后续 MySQL 持久化提供统一入口。

## 当前已提供

- FastAPI 入口 `backend/main.py`
- API 路由前缀：`/api/daily-carddraw`
- 抽卡接口：`POST /api/daily-carddraw/draw`
- 今日记录接口：`GET /api/daily-carddraw/today`
- 历史记录接口：`GET /api/daily-carddraw/history`
- 累计统计接口：`GET /api/daily-carddraw/stats`
- 管理接口：
  - `GET /api/daily-carddraw/admin/pools`
  - `POST /api/daily-carddraw/admin/reset-quota`
  - `GET /api/daily-carddraw/admin/user-records`

## 当前实现说明

当前后端仍是骨架版：

- 路由和返回结构已固定
- 服务层与仓储层已拆分
- 仓储层目前使用内存假数据
- 尚未接入真实 MySQL 查询

## 启动方式

### 1. 安装依赖

```bash
pip install -r backend/requirements.txt
```

### 2. 复制环境变量

将 `backend/.env.example` 复制为你自己的环境变量文件，并按实际部署环境填写 MySQL 和管理鉴权配置。

### 3. 启动服务

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

## 数据库脚本

初始化表结构请执行：

`backend/sql/001_init_daily_carddraw.sql`

## 下一步建议

下一阶段建议继续完成：

1. 用真实 MySQL 实现仓储层
2. 完成每日次数扣减与事务处理
3. 接入管理员卡池与卡牌维护接口
4. 增加分页、校验和错误码规范
