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

CREATE TABLE IF NOT EXISTS `card_item` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `card_key` VARCHAR(64) NOT NULL,
  `card_name` VARCHAR(100) NOT NULL,
  `rarity` VARCHAR(16) NOT NULL,
  `score_value` INT NOT NULL DEFAULT 0,
  `description` VARCHAR(255) NOT NULL DEFAULT '',
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_card_item_card_key` (`card_key`)
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

INSERT INTO `card_item` (`card_key`, `card_name`, `rarity`, `score_value`, `description`, `is_enabled`) VALUES
  ('star_traveler', '星穹旅人', 'SSR', 12, '默认示例 SSR 卡牌', 1),
  ('star_apprentice', '巡星学徒', 'SR', 5, '默认示例 SR 卡牌', 1),
  ('wild_walker', '荒野旅者', 'R', 2, '默认示例 R 卡牌', 1),
  ('morning_recorder', '晨光记录员', 'N', 1, '默认示例 N 卡牌', 1)
ON DUPLICATE KEY UPDATE
  `card_name` = VALUES(`card_name`),
  `rarity` = VALUES(`rarity`),
  `score_value` = VALUES(`score_value`),
  `description` = VALUES(`description`);

INSERT INTO `pool_card` (`pool_id`, `card_id`, `weight`, `is_up`)
SELECT p.id, c.id,
  CASE c.card_key
    WHEN 'star_traveler' THEN 5
    WHEN 'star_apprentice' THEN 20
    WHEN 'wild_walker' THEN 40
    ELSE 60
  END AS `weight`,
  0
FROM `card_pool` p
JOIN `card_item` c ON c.card_key IN ('star_traveler', 'star_apprentice', 'wild_walker', 'morning_recorder')
WHERE p.pool_key = 'normal_pool'
ON DUPLICATE KEY UPDATE
  `weight` = VALUES(`weight`),
  `is_up` = VALUES(`is_up`);
