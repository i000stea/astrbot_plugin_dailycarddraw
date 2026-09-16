'use strict';

const POOL_COLUMNS = [
  'id',
  'pool_key',
  'pool_name',
  'description',
  'is_enabled',
  'allow_single_draw',
  'allow_ten_draw',
  'daily_single_quota',
  'daily_ten_draw_quota',
  'start_at',
  'end_at',
].join(', ');

const SELECT_POOL = `SELECT ${POOL_COLUMNS} FROM card_pool`;

function toBoolean(value) {
  return Number(value) === 1;
}

function mapPool(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    is_enabled: toBoolean(row.is_enabled),
    allow_single_draw: toBoolean(row.allow_single_draw),
    allow_ten_draw: toBoolean(row.allow_ten_draw),
  };
}

function normalizeKey(value) {
  return String(value || '').trim();
}

async function findByKey(conn, poolKey) {
  const [rows] = await conn.execute(`${SELECT_POOL} WHERE pool_key = ? LIMIT 1`, [normalizeKey(poolKey)]);
  return mapPool(rows[0]);
}

async function findById(conn, poolId) {
  const [rows] = await conn.execute(`${SELECT_POOL} WHERE id = ? LIMIT 1`, [Number(poolId)]);
  return mapPool(rows[0]);
}

/** 管理命令传来的「卡池 ID」既可能是数字主键，也可能是 pool_key，两种都认。 */
async function findByIdOrKey(conn, idOrKey) {
  const raw = normalizeKey(idOrKey);
  if (!raw) {
    return null;
  }
  if (/^\d+$/.test(raw)) {
    const byId = await findById(conn, raw);
    if (byId) {
      return byId;
    }
  }
  return findByKey(conn, raw);
}

async function listAll(conn) {
  const [rows] = await conn.execute(`${SELECT_POOL} ORDER BY id ASC`);
  return rows.map(mapPool);
}

async function listEnabled(conn) {
  const [rows] = await conn.execute(
    `${SELECT_POOL} WHERE is_enabled = 1 ORDER BY id ASC`,
  );
  return rows.map(mapPool);
}

const WRITABLE_FIELDS = [
  'pool_key',
  'pool_name',
  'description',
  'is_enabled',
  'allow_single_draw',
  'allow_ten_draw',
  'daily_single_quota',
  'daily_ten_draw_quota',
  'start_at',
  'end_at',
];

async function create(conn, payload) {
  const fields = WRITABLE_FIELDS.filter((field) => payload[field] !== undefined);
  const placeholders = fields.map(() => '?').join(', ');
  const values = fields.map((field) => payload[field]);
  const [result] = await conn.execute(
    `INSERT INTO card_pool (${fields.join(', ')}) VALUES (${placeholders})`,
    values,
  );
  return result.insertId;
}

async function update(conn, poolId, payload) {
  const fields = WRITABLE_FIELDS.filter((field) => payload[field] !== undefined);
  if (!fields.length) {
    return 0;
  }
  const assignments = fields.map((field) => `${field} = ?`).join(', ');
  const values = fields.map((field) => payload[field]);
  const [result] = await conn.execute(
    `UPDATE card_pool SET ${assignments} WHERE id = ?`,
    [...values, Number(poolId)],
  );
  return result.affectedRows;
}

async function remove(conn, poolId) {
  const id = Number(poolId);
  await conn.execute('DELETE FROM pool_card WHERE pool_id = ?', [id]);
  await conn.execute('DELETE FROM pool_rarity WHERE pool_id = ?', [id]);
  await conn.execute('DELETE FROM daily_quota WHERE pool_id = ?', [id]);
  const [result] = await conn.execute('DELETE FROM card_pool WHERE id = ?', [id]);
  return result.affectedRows;
}

/** 卡池内可用的卡牌（含权重），抽卡时使用。 */
async function listEnabledCards(conn, poolId) {
  const [rows] = await conn.execute(
    `SELECT c.id AS card_id, c.card_key, c.card_name, c.rarity, c.profession, c.score_value, pc.weight, pc.is_up
       FROM pool_card pc
       JOIN card_item c ON c.id = pc.card_id
      WHERE pc.pool_id = ? AND c.is_enabled = 1 AND pc.weight > 0
      ORDER BY pc.id ASC`,
    [Number(poolId)],
  );
  return rows.map((row) => ({ ...row, is_up: toBoolean(row.is_up) }));
}

/** 卡池配置页用：包含被禁用/权重为 0 的条目。 */
async function listPoolCards(conn, poolId) {
  const [rows] = await conn.execute(
    `SELECT pc.id AS pool_card_id, pc.card_id, pc.weight, pc.is_up,
            c.card_key, c.card_name, c.rarity, c.score_value, c.is_enabled
       FROM pool_card pc
       JOIN card_item c ON c.id = pc.card_id
      WHERE pc.pool_id = ?
      ORDER BY pc.id ASC`,
    [Number(poolId)],
  );
  return rows.map((row) => ({
    ...row,
    is_up: toBoolean(row.is_up),
    is_enabled: toBoolean(row.is_enabled),
  }));
}

/** 用给定列表整体替换卡池配置（前端「保存权重」用）。 */
async function replacePoolCards(conn, poolId, items) {
  const id = Number(poolId);
  await conn.execute('DELETE FROM pool_card WHERE pool_id = ?', [id]);
  if (!items.length) {
    return 0;
  }
  const placeholders = items.map(() => '(?, ?, ?, ?)').join(', ');
  const values = [];
  for (const item of items) {
    values.push(id, Number(item.card_id), Math.max(0, Number(item.weight) || 0), item.is_up ? 1 : 0);
  }
  await conn.execute(
    `INSERT INTO pool_card (pool_id, card_id, weight, is_up) VALUES ${placeholders}`,
    values,
  );
  return items.length;
}

async function upsertPoolCard(conn, poolId, cardId, payload) {
  await conn.execute(
    `INSERT INTO pool_card (pool_id, card_id, weight, is_up) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE weight = ?, is_up = ?`,
    [
      Number(poolId),
      Number(cardId),
      Math.max(0, Number(payload.weight) || 0),
      payload.is_up ? 1 : 0,
      Math.max(0, Number(payload.weight) || 0),
      payload.is_up ? 1 : 0,
    ],
  );
}

async function removePoolCard(conn, poolId, cardId) {
  const [result] = await conn.execute(
    'DELETE FROM pool_card WHERE pool_id = ? AND card_id = ?',
    [Number(poolId), Number(cardId)],
  );
  return result.affectedRows;
}

/** 卡池稀有度权重（pool_rarity），抽卡时「先 roll 星级」。 */
async function listRarityWeights(conn, poolId) {
  const [rows] = await conn.execute(
    'SELECT rarity, weight FROM pool_rarity WHERE pool_id = ? ORDER BY rarity ASC',
    [Number(poolId)],
  );
  return rows.map((row) => ({ rarity: Number(row.rarity), weight: Number(row.weight) || 0 }));
}

/** 整体替换卡池稀有度权重。 */
async function replaceRarityWeights(conn, poolId, items) {
  const id = Number(poolId);
  await conn.execute('DELETE FROM pool_rarity WHERE pool_id = ?', [id]);
  if (!items.length) {
    return 0;
  }
  const placeholders = items.map(() => '(?, ?, ?)').join(', ');
  const values = [];
  for (const item of items) {
    values.push(id, Number(item.rarity), Math.max(0, Number(item.weight) || 0));
  }
  await conn.execute(
    `INSERT INTO pool_rarity (pool_id, rarity, weight) VALUES ${placeholders}`,
    values,
  );
  return items.length;
}

module.exports = {
  findByKey,
  findById,
  findByIdOrKey,
  listAll,
  listEnabled,
  create,
  update,
  remove,
  listEnabledCards,
  listPoolCards,
  replacePoolCards,
  upsertPoolCard,
  removePoolCard,
  listRarityWeights,
  replaceRarityWeights,
};
