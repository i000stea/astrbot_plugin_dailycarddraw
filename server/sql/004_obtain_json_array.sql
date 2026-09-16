-- 004：把 card_item.obtain 放宽到 VARCHAR(255)，用于存放 JSON 数组文本。
--
-- 背景：真实数据 gacha_YYYY-MM-DD.json 里 obtain 可能是 "公开招募,中坚寻访"
--       这种英文逗号分隔的多值，导入时会被转成 JSON 数组：
--         ["公开招募","中坚寻访"]
--       旧的 VARCHAR(64) 偏窄，这里放宽。
--
-- 本脚本幂等：ALTER MODIFY 重复执行不会报错。
--   全新安装：001 已包含，无需执行；
--   已升级到新结构：执行本脚本即可（或直接重跑最新的 002）。
--
-- 导入方式：
--   mysql -u 库用户名 -p 库名 < server/sql/004_obtain_json_array.sql

USE `astrbot_daily_carddraw`;

ALTER TABLE `card_item`
  MODIFY COLUMN `obtain` VARCHAR(255) NOT NULL DEFAULT ''
  COMMENT '获取方式（JSON 数组，如 ["公开招募","中坚寻访"]）';
