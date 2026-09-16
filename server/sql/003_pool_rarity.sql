-- 003：新增 pool_rarity 表，支持「先 roll 稀有度，再 roll 卡牌权重」的抽卡规则。
--
-- 不配置某卡池的 pool_rarity 时，抽卡会自动退回「该稀有度下所有卡牌权重之和」，
-- 因此本脚本只建表，不会影响已有卡池的现有行为。
--
-- 导入方式：
--   mysql -u 库用户名 -p 库名 < server/sql/003_pool_rarity.sql

USE `astrbot_daily_carddraw`;

CREATE TABLE IF NOT EXISTS `pool_rarity` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pool_id` BIGINT UNSIGNED NOT NULL,
  `rarity` TINYINT UNSIGNED NOT NULL COMMENT '稀有度 1~6 星',
  `weight` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pool_rarity_pool_id_rarity` (`pool_id`, `rarity`),
  KEY `idx_pool_rarity_pool_id` (`pool_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
