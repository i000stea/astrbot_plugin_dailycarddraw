'use strict';

/**
 * 卡牌（card_item）仓储。
 */

const WRITABLE_FIELDS = ['card_key', 'card_name', 'rarity', 'score_value', 'description', 'is_enabled'];

async function listAll(conn, { keyword } = {}) {
  const params = [];
  let where = '';
  if (keyword) {
    where = 'WHERE card_key LIKE ? OR card_name LIKE ?';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const [rows] = await conn.execute(
    `SELECT id, card_key, card_name, rarity, score_value, description, is_enabled, created_at, updated_at
       FROM card_item ${where}
      ORDER BY id ASC`,
    params,
  );
  return rows.map((row) => ({ ...row, is_enabled: Number(row.is_enabled) === 1 }));
}

async function findById(conn, cardId) {
  const [rows] = await conn.execute(
    `SELECT id, card_key, card_name, rarity, score_value, description, is_enabled
       FROM card_item WHERE id = ? LIMIT 1`,
    [Number(cardId)],
  );
  const row = rows[0];
  return row ? { ...row, is_enabled: Number(row.is_enabled) === 1 } : null;
}

async function create(conn, payload) {
  const fields = WRITABLE_FIELDS.filter((field) => payload[field] !== undefined);
  const placeholders = fields.map(() => '?').join(', ');
  const values = fields.map((field) => payload[field]);
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
  const values = fields.map((field) => payload[field]);
  const [result] = await conn.execute(
    `UPDATE card_item SET ${assignments} WHERE id = ?`,
    [...values, Number(cardId)],
  );
  return result.affectedRows;
}

async function remove(conn, cardId) {
  const id = Number(cardId);
  await conn.execute('DELETE FROM pool_card WHERE card_id = ?', [id]);
  const [result] = await conn.execute('DELETE FROM card_item WHERE id = ?', [id]);
  return result.affectedRows;
}

module.exports = { listAll, findById, create, update, remove };
