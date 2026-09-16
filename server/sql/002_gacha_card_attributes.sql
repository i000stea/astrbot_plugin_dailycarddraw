-- 002：把 card_item 升级成与 gacha_YYYY-MM-DD.json 对齐的结构
--   * 新增 profession（职业）、obtain（获取方式）两列
--   * rarity 由 N/R/SR/SSR/UR 字符串改成 1~6 星整数
--
-- 适用范围：仅「从旧版 001 建出来的库」需要执行；
--           全新安装直接用 001_init_daily_carddraw.sql 即可（已包含这些改动），无需再跑本脚本。
--
-- 本脚本是「幂等」的：会先查 information_schema，缺什么补什么，
-- 已存在 profession/obtain、rarity 已是数字、索引已有时都会自动跳过，
-- 因此重复执行也不会再出现 #1060 Duplicate column name。
--
-- 用 phpMyAdmin / 宝塔「SQL 查询窗口」整段粘贴执行即可（支持 DELIMITER）。

USE `astrbot_daily_carddraw`;

DROP PROCEDURE IF EXISTS `dcd_migrate_002`;

DELIMITER $$

CREATE PROCEDURE `dcd_migrate_002`()
BEGIN
  -- 1) profession 列
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'card_item'
      AND COLUMN_NAME = 'profession'
  ) THEN
    ALTER TABLE `card_item`
      ADD COLUMN `profession` VARCHAR(32) NOT NULL DEFAULT '' COMMENT '职业' AFTER `rarity`;
  END IF;

  -- 2) obtain 列（放在 profession 之后；若上一步没新增 profession，这里也能正常工作）
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'card_item'
      AND COLUMN_NAME = 'obtain'
  ) THEN
    ALTER TABLE `card_item`
      ADD COLUMN `obtain` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '获取方式（JSON 数组）' AFTER `profession`;
  END IF;

  -- 2.1) 老列的宽度可能不够存 JSON 数组，统一放宽到 VARCHAR(255)（重复执行无副作用）
  ALTER TABLE `card_item`
    MODIFY COLUMN `obtain` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '获取方式（JSON 数组，如 ["公开招募","中坚寻访"]）';

  -- 3) rarity 仍是字符串时才做类型转换（已经是 TINYINT 会跳过）
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'card_item'
      AND COLUMN_NAME = 'rarity'
      AND DATA_TYPE IN ('varchar', 'char', 'text', 'tinytext', 'mediumtext', 'longtext')
  ) THEN
    UPDATE `card_item`
       SET `rarity` = CASE UPPER(`rarity`)
         WHEN 'UR'  THEN '6'
         WHEN 'SSR' THEN '6'
         WHEN 'SR'  THEN '5'
         WHEN 'R'   THEN '4'
         WHEN 'N'   THEN '1'
         ELSE CASE WHEN `rarity` REGEXP '^[1-6]$' THEN `rarity` ELSE '1' END
       END;
    ALTER TABLE `card_item`
      MODIFY COLUMN `rarity` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '稀有度 1~6 星';
  END IF;

  -- 4) 稀有度索引（存在即跳过）
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'card_item'
      AND INDEX_NAME = 'idx_card_item_rarity'
  ) THEN
    ALTER TABLE `card_item` ADD KEY `idx_card_item_rarity` (`rarity`);
  END IF;
END$$

DELIMITER ;

CALL `dcd_migrate_002`();

DROP PROCEDURE IF EXISTS `dcd_migrate_002`;
