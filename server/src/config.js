'use strict';

const crypto = require('crypto');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

const panelPassword = toText(process.env.PANEL_PASSWORD);
const panelPasswordSha256 = toText(process.env.PANEL_PASSWORD_SHA256).toLowerCase();
let panelJwtSecret = toText(process.env.PANEL_JWT_SECRET);
let panelJwtSecretGenerated = false;
if (!panelJwtSecret) {
  panelJwtSecret = crypto.randomBytes(32).toString('hex');
  panelJwtSecretGenerated = true;
}

const config = {
  env: toText(process.env.APP_ENV, 'production'),
  host: toText(process.env.APP_HOST, '0.0.0.0'),
  port: toInt(process.env.APP_PORT, 3100),
  /** 每日次数按此自然日重置；不要用容器的 UTC 时间，否则凌晨会错开 8 小时。 */
  timeZone: toText(process.env.APP_TIMEZONE, 'Asia/Shanghai'),
  apiPrefix: '/api/daily-carddraw',
  /** 插件侧 api_token 对应的后端 Token；为空时管理接口不鉴权（与插件行为一致）。 */
  adminApiToken: toText(process.env.ADMIN_API_TOKEN),
  panel: {
    username: toText(process.env.PANEL_USERNAME, 'admin'),
    password: panelPassword,
    passwordSha256: panelPasswordSha256,
    jwtSecret: panelJwtSecret,
    jwtSecretGenerated: panelJwtSecretGenerated,
    jwtExpiresIn: toText(process.env.PANEL_JWT_EXPIRES_IN, '12h'),
  },
  db: {
    host: toText(process.env.MYSQL_HOST, '127.0.0.1'),
    port: toInt(process.env.MYSQL_PORT, 3306),
    user: toText(process.env.MYSQL_USER, 'root'),
    password: process.env.MYSQL_PASSWORD || '',
    database: toText(process.env.MYSQL_DATABASE, 'daily_carddraw'),
    connectionLimit: toInt(process.env.MYSQL_POOL_SIZE, 10),
  },
  draw: {
    tenCount: toInt(process.env.DRAW_TEN_COUNT, 10),
    maxPageSize: toInt(process.env.MAX_PAGE_SIZE, 50),
  },
    /** 图片资源目录：单独上传的 resource 目录默认位于 server/resource。 */
    resourceDir: toText(process.env.RESOURCE_DIR, path.join(__dirname, '..', 'resource')),
    /** 生成的抽卡图片缓存目录，默认 server/cache/draw-images，缓存 12 小时。 */
    imageCacheDir: toText(
      process.env.IMAGE_CACHE_DIR,
      path.join(__dirname, '..', 'cache', 'draw-images'),
    ),
    imageCacheTtlSeconds: toInt(process.env.IMAGE_CACHE_TTL_SECONDS, 12 * 60 * 60),
    image: {
      cardWidth: toInt(process.env.IMAGE_CARD_WIDTH, 320),
      cardHeight: toInt(process.env.IMAGE_CARD_HEIGHT, 480),
      avatarSize: toInt(process.env.IMAGE_AVATAR_SIZE, 220),
      professionSize: toInt(process.env.IMAGE_PROFESSION_SIZE, 56),
      raritySize: toInt(process.env.IMAGE_RARITY_SIZE, 72),
      padding: toInt(process.env.IMAGE_PADDING, 16),
    },

};

module.exports = { config };
