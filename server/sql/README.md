# SQL 目录说明

该目录保存每日抽卡 Node 后端所需的数据库建表脚本。

当前包含：

- `001_init_daily_carddraw.sql`
  - 第一版 MySQL 表结构：`card_pool` / `card_item` / `pool_card` / `daily_quota` / `draw_record` / `draw_record_item` / `user_profile`
  - 附带一个示例卡池 `normal_pool`（常驻卡池）与 4 张示例卡牌及其初始权重

导入方式（宝塔面板 → 数据库 → 导入，或命令行）：

```bash
mysql -u daily_carddraw -p daily_carddraw < server/sql/001_init_daily_carddraw.sql
```

后续如果存在结构升级，继续按递增编号新增：

- `002_xxx.sql`
- `003_xxx.sql`
