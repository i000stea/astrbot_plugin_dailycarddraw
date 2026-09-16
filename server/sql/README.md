# SQL 目录说明

该目录保存每日抽卡 Node 后端所需的数据库建表脚本。

当前包含：

- `001_init_daily_carddraw.sql`
  - 第一版 MySQL 表结构：`card_pool` / `card_item` / `pool_card` / `pool_rarity` / `daily_quota` / `draw_record` / `draw_record_item` / `user_profile`
  - 附带一个示例卡池 `normal_pool`（常驻卡池）、7 张示例卡牌及初始权重、稀有度权重
- `002_gacha_card_attributes.sql`
  - 升级脚本（仅老库需要）：给 `card_item` 增加 `profession` / `obtain`，并把 `rarity` 从 `N/R/SR/SSR/UR` 字符串改成 `1~6` 星整数
- `003_pool_rarity.sql`
  - 升级脚本（仅老库需要）：新增 `pool_rarity` 表，支持「先 roll 稀有度，再 roll 卡牌权重」
- `004_obtain_json_array.sql`
  - 升级脚本（仅老库需要）：把 `card_item.obtain` 放宽到 `VARCHAR(255)`，用于存放 JSON 数组文本

> `card_item` 的字段与真实数据文件 `resource/gacha_YYYY-MM-DD.json` 对齐：
> `card_key` = JSON 的 `id`，`card_name` = `name`，`rarity` = `rarity`（1~6 星），
> `profession` = `profession`，`obtain` = `obtain`（多值逗号串会转成数组）。

导入方式（宝塔面板 → 数据库 → 导入，或命令行）：

```bash
# 全新安装
mysql -u daily_carddraw -p daily_carddraw < server/sql/001_init_daily_carddraw.sql

# 老库升级（按需依次执行）
mysql -u daily_carddraw -p daily_carddraw < server/sql/002_gacha_card_attributes.sql
mysql -u daily_carddraw -p daily_carddraw < server/sql/003_pool_rarity.sql
mysql -u daily_carddraw -p daily_carddraw < server/sql/004_obtain_json_array.sql
```

后续如果存在结构升级，继续按递增编号新增：

- `005_xxx.sql`
- `006_xxx.sql`
