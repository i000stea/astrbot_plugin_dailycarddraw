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
};

module.exports = { config };
