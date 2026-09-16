CREATE DATABASE IF NOT EXISTS `astrbot_daily_carddraw`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `astrbot_daily_carddraw`;

CREATE TABLE IF NOT EXISTS `user_profile` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `qq_id` VARCHAR(32) NOT NULL,
  `nickname` VARCHAR(100) NOT NULL DEFAULT '',
  `total_draw_count` INT NOT NULL DEFAULT 0,
  `total_single_draw_count` INT NOT NULL DEFAULT 0,
  `total_ten_draw_count` INT NOT NULL DEFAULT 0,
  `total_score` INT NOT NULL DEFAULT 0,
  `total_ssr_count` INT NOT NULL DEFAULT 0,
  `total_ur_count` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_profile_qq_id` (`qq_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `card_pool` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pool_key` VARCHAR(64) NOT NULL,
  `pool_name` VARCHAR(100) NOT NULL,
  `description` VARCHAR(255) NOT NULL DEFAULT '',
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `allow_single_draw` TINYINT(1) NOT NULL DEFAULT 1,
  `allow_ten_draw` TINYINT(1) NOT NULL DEFAULT 1,
  `daily_single_quota` INT NOT NULL DEFAULT 1,
  `daily_ten_draw_quota` INT NOT NULL DEFAULT 1,
  `start_at` DATETIME NULL DEFAULT NULL,
  `end_at` DATETIME NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_card_pool_pool_key` (`pool_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 卡牌定义。字段与资源文件 gacha_YYYY-MM-DD.json 对齐：
--   card_key       <- JSON 的 id（干员编号，如 RE21）
--   card_name      <- JSON 的 name
--   rarity         <- JSON 的 rarity，1~6 星（数字，越大越稀有）
--   profession     <- JSON 的 profession（职业）
--   obtain         <- JSON 的 obtain（获取方式，可能是 "公开招募,中坚寻访" 这种多值，导入时转成数组）
--   score_value    <- 抽到该卡时的积分，未提供时由稀有度换算（见 poolService）
CREATE TABLE IF NOT EXISTS `card_item` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `card_key` VARCHAR(64) NOT NULL,
  `card_name` VARCHAR(100) NOT NULL,
  `rarity` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '稀有度 1~6 星',
  `profession` VARCHAR(32) NOT NULL DEFAULT '' COMMENT '职业',
  `obtain` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '获取方式（JSON 数组，如 ["公开招募","中坚寻访"]）',
  `score_value` INT NOT NULL DEFAULT 0,
  `description` VARCHAR(255) NOT NULL DEFAULT '',
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_card_item_card_key` (`card_key`),
  KEY `idx_card_item_rarity` (`rarity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pool_card` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pool_id` BIGINT UNSIGNED NOT NULL,
  `card_id` BIGINT UNSIGNED NOT NULL,
  `weight` INT NOT NULL DEFAULT 1,
  `is_up` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pool_card_pool_id_card_id` (`pool_id`, `card_id`),
  KEY `idx_pool_card_pool_id` (`pool_id`),
  KEY `idx_pool_card_card_id` (`card_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 卡池稀有度权重：抽卡时「先按稀有度 roll 一档，再在该稀有度内按卡牌权重 roll 具体卡」。
-- 未配置的稀有度会退回「该星级下所有卡牌权重之和」，因此老卡池不配置也能按原方式工作。
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

CREATE TABLE IF NOT EXISTS `daily_quota` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `qq_id` VARCHAR(32) NOT NULL,
  `quota_date` DATE NOT NULL,
  `pool_id` BIGINT UNSIGNED NOT NULL,
  `single_used` INT NOT NULL DEFAULT 0,
  `ten_used` INT NOT NULL DEFAULT 0,
  `single_limit` INT NOT NULL DEFAULT 1,
  `ten_limit` INT NOT NULL DEFAULT 1,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_daily_quota_qq_date_pool` (`qq_id`, `quota_date`, `pool_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `draw_record` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `record_no` VARCHAR(32) NOT NULL,
  `qq_id` VARCHAR(32) NOT NULL,
  `pool_id` BIGINT UNSIGNED NOT NULL,
  `draw_mode` VARCHAR(16) NOT NULL,
  `draw_count` INT NOT NULL DEFAULT 1,
  `total_score` INT NOT NULL DEFAULT 0,
  `highest_rarity` VARCHAR(16) NOT NULL DEFAULT '',
  `group_id` VARCHAR(32) NOT NULL DEFAULT '',
  `operator_context` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_draw_record_record_no` (`record_no`),
  KEY `idx_draw_record_qq_id` (`qq_id`),
  KEY `idx_draw_record_pool_id` (`pool_id`),
  KEY `idx_draw_record_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `draw_record_item` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `record_id` BIGINT UNSIGNED NOT NULL,
  `card_id` BIGINT UNSIGNED NOT NULL,
  `card_name_snapshot` VARCHAR(100) NOT NULL,
  `rarity_snapshot` VARCHAR(16) NOT NULL,
  `score_snapshot` INT NOT NULL DEFAULT 0,
  `position_index` INT NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_draw_record_item_record_id` (`record_id`),
  KEY `idx_draw_record_item_card_id` (`card_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `card_pool` (
  `pool_key`, `pool_name`, `description`, `is_enabled`, `allow_single_draw`, `allow_ten_draw`, `daily_single_quota`, `daily_ten_draw_quota`
) VALUES (
  'normal_pool', '常驻卡池', '默认常驻卡池', 1, 1, 1, 1, 1
) ON DUPLICATE KEY UPDATE
  `pool_name` = VALUES(`pool_name`),
  `description` = VALUES(`description`);

-- 示例数据：直接取自 resource/gacha_2026-09-16 (1).json 的真实干员格式，
-- 覆盖 6/5/4/1 星，方便导入真实 JSON 前先跑通链路。
INSERT INTO `card_item`
  (`card_key`, `card_name`, `rarity`, `profession`, `obtain`, `score_value`, `description`, `is_enabled`)
VALUES
  ('RE21', '机械师', 6, '重装', '["活动获得"]', 60, '', 1),
  ('CB35', '谬因', 6, '术师', '["标准寻访"]', 60, '', 1),
  ('BV02', '佩德洛', 5, '辅助', '["标准寻访"]', 30, '', 1),
  ('US42', '裂响', 5, '重装', '["标准寻访"]', 30, '', 1),
  ('LN22', '协律', 4, '术师', '["凭证交易所(采购)"]', 10, '', 1),
  ('US38', '冬时', 4, '先锋', '["标准寻访"]', 10, '', 1),
  ('MH04', '罗德岛隐秘队', 1, '先锋', '["活动获得"]', 1, '', 1)
ON DUPLICATE KEY UPDATE
  `card_name` = VALUES(`card_name`),
  `rarity` = VALUES(`rarity`),
  `profession` = VALUES(`profession`),
  `obtain` = VALUES(`obtain`),
  `score_value` = VALUES(`score_value`);

INSERT INTO `pool_card` (`pool_id`, `card_id`, `weight`, `is_up`)
SELECT p.id, c.id,
  CASE c.card_key
    WHEN 'RE21' THEN 2
    WHEN 'CB35' THEN 2
    WHEN 'BV02' THEN 8
    WHEN 'US42' THEN 8
    WHEN 'LN22' THEN 20
    WHEN 'US38' THEN 20
    ELSE 60
  END AS `weight`,
  0
FROM `card_pool` p
JOIN `card_item` c
  ON c.card_key IN ('RE21', 'CB35', 'BV02', 'US42', 'LN22', 'US38', 'MH04')
WHERE p.pool_key = 'normal_pool'
ON DUPLICATE KEY UPDATE
  `weight` = VALUES(`weight`),
  `is_up` = VALUES(`is_up`);

-- 示例卡池的稀有度权重（先 roll 星级，再 roll 卡）。不配置也能用，会退回卡牌权重。
INSERT INTO `pool_rarity` (`pool_id`, `rarity`, `weight`)
SELECT p.id, r.rarity, r.weight
FROM `card_pool` p
JOIN (
  SELECT 6 AS `rarity`, 2 AS `weight`
  UNION ALL SELECT 5, 12
  UNION ALL SELECT 4, 36
  UNION ALL SELECT 1, 150
) r
WHERE p.pool_key = 'normal_pool'
ON DUPLICATE KEY UPDATE
  `weight` = VALUES(`weight`);
