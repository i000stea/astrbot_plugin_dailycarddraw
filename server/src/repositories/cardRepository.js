'use strict';

/**
 * 卡牌（card_item）仓储。
 * 字段与 gacha_YYYY-MM-DD.json 对齐：card_key / card_name / rarity(1~6) / profession / obtain。
 * obtain 在库中以 JSON 数组文本存储，读出来统一转成数组。
 */

const { toObtainArray, serializeObtain } = require('../domain/card');

const CARD_COLUMNS = [
  'id',
  'card_key',
  'card_name',
  'rarity',
  'profession',
  'obtain',
  'score_value',
  'description',
  'is_enabled',
].join(', ');

const WRITABLE_FIELDS = [
  'card_key',
  'card_name',
  'rarity',
  'profession',
  'obtain',
  'score_value',
  'description',
  'is_enabled',
];

/** 批量导入允许写入的列（card_key 作为唯一键参与 upsert）。 */
const IMPORT_COLUMNS = [
  'card_key',
  'card_name',
  'rarity',
  'profession',
  'obtain',
  'score_value',
  'description',
  'is_enabled',
];

function mapCard(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    obtain: toObtainArray(row.obtain),
    is_enabled: Number(row.is_enabled) === 1,
  };
}

async function listAll(conn, { keyword } = {}) {
  const params = [];
  let where = '';
  if (keyword) {
    where = 'WHERE card_key LIKE ? OR card_name LIKE ?';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const [rows] = await conn.execute(
    `SELECT ${CARD_COLUMNS}, created_at, updated_at
       FROM card_item ${where}
      ORDER BY id ASC`,
    params,
  );
  return rows.map(mapCard);
}

async function findById(conn, cardId) {
  const [rows] = await conn.execute(
    `SELECT ${CARD_COLUMNS}
       FROM card_item WHERE id = ? LIMIT 1`,
    [Number(cardId)],
  );
  return mapCard(rows[0]);
}

/** 已存在的 card_key 集合，导入时用来区分「新增 / 更新」。 */
async function listKeys(conn) {
  const [rows] = await conn.execute('SELECT card_key FROM card_item');
  return rows.map((row) => row.card_key);
}

function buildWriteValue(field, payload) {
  return field === 'obtain' ? serializeObtain(payload[field]) : payload[field];
}

async function create(conn, payload) {
  const fields = WRITABLE_FIELDS.filter((field) => payload[field] !== undefined);
  const placeholders = fields.map(() => '?').join(', ');
  const values = fields.map((field) => buildWriteValue(field, payload));
  const [result] = await conn.execute(
    `INSERT INTO card_item (${fields.join(', ')}) VALUES (${placeholders})`,
    values,
  );
  return result.insertId;
}

async function update(conn, cardId, payload) {
  const fields = WRITABLE_FIELDS.filter((field) => payload[field] !== undefined);
  if (!fields.length) {
    return 0;
  }
  const assignments = fields.map((field) => `${field} = ?`).join(', ');
  const values = fields.map((field) => buildWriteValue(field, payload));
  const [result] = await conn.execute(
    `UPDATE card_item SET ${assignments} WHERE id = ?`,
    [...values, Number(cardId)],
  );
  return result.affectedRows;
}

/**
 * 批量 upsert（用于管理后台上传 JSON 录入数据）。
 * 以 card_key 为唯一键；命中已存在的卡时只更新 JSON 能提供的定义字段
 * （名称 / 稀有度 / 职业 / 获取方式 / 积分），保留人工维护的 description 与 is_enabled。
 */
async function upsertMany(conn, cards) {
  if (!cards.length) {
    return 0;
  }
  const columnList = IMPORT_COLUMNS.join(', ');
  const placeholders = cards
    .map(() => `(${IMPORT_COLUMNS.map(() => '?').join(', ')})`)
    .join(', ');
  const values = [];
  for (const card of cards) {
    values.push(
      card.card_key,
      card.card_name,
      card.rarity,
      card.profession ?? '',
      serializeObtain(card.obtain),
      card.score_value ?? 0,
      card.description ?? '',
      card.is_enabled ?? 1,
    );
  }
  const [result] = await conn.execute(
    `INSERT INTO card_item (${columnList}) VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       card_name = VALUES(card_name),
       rarity = VALUES(rarity),
       profession = VALUES(profession),
       obtain = VALUES(obtain),
       score_value = VALUES(score_value)`,
    values,
  );
  return result.affectedRows;
}

async function remove(conn, cardId) {
  const id = Number(cardId);
  await conn.execute('DELETE FROM pool_card WHERE card_id = ?', [id]);
  const [result] = await conn.execute('DELETE FROM card_item WHERE id = ?', [id]);
  return result.affectedRows;
}

module.exports = { listAll, findById, listKeys, create, update, upsertMany, remove };
