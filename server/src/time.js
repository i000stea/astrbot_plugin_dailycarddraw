'use strict';

const crypto = require('crypto');

const { config } = require('./config');

const dateTimeFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: config.timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** 返回配置时区下的 "YYYY-MM-DD HH:mm:ss"，可直接写进 MySQL DATETIME。 */
function nowDateTime() {
  return dateTimeFormatter.format(new Date());
}

/** 返回配置时区下的 "YYYY-MM-DD"，用于 daily_quota.quota_date。 */
function todayDate() {
  return nowDateTime().slice(0, 10);
}

/** 生成抽卡记录号：DR + 时间戳 + 4 位随机数，长度 20。 */
function buildRecordNo() {
  const stamp = nowDateTime().replace(/[-: ]/g, '');
  return `DR${stamp}${crypto.randomInt(1000, 10000)}`;
}

module.exports = { nowDateTime, todayDate, buildRecordNo };
