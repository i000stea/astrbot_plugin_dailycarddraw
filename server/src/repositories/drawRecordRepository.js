'use strict';

/**
 * 抽卡记录（draw_record / draw_record_item）仓储。
 * 记录明细写入快照字段，之后改动卡牌名称或积分也不会影响历史记录。
 */

async function insertRecord(conn, payload) {
  const [result] = await conn.execute(
    `INSERT INTO draw_record
       (record_no, qq_id, pool_id, draw_mode, draw_count, total_score, highest_rarity, group_id, operator_context, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.recordNo,
      payload.qqId,
      Number(payload.poolId),
      payload.drawMode,
      Number(payload.drawCount),
      Number(payload.totalScore),
      payload.highestRarity || '',
      payload.groupId || '',
      payload.operatorContext || '',
      payload.createdAt,
    ],
  );
  return result.insertId;
}

async function insertItems(conn, recordId, cards) {
  if (!cards.length) {
    return;
  }
  const placeholders = cards.map(() => '(?, ?, ?, ?, ?)').join(', ');
  const values = [];
  cards.forEach((card, index) => {
    values.push(
      Number(recordId),
      Number(card.card_id),
      card.card_name,
      card.rarity,
      Number(card.score_value) || 0,
      index + 1,
    );
  });
  await conn.execute(
    `INSERT INTO draw_record_item
       (record_id, card_id, card_name_snapshot, rarity_snapshot, score_snapshot, position_index)
     VALUES ${placeholders}`,
    values,
  );
}

function normalizePage(page, pageSize, maxPageSize) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeSize = Math.min(Math.max(1, Number.parseInt(pageSize, 10) || 10), maxPageSize);
  return { page: safePage, pageSize: safeSize, offset: (safePage - 1) * safeSize };
}

/** 分页查询历史记录，返回插件契约需要的字段。 */
async function listHistory(conn, { qqId, page, pageSize, maxPageSize = 50 }) {
  const { pageSize: size, offset } = normalizePage(page, pageSize, maxPageSize);

  const [countRows] = await conn.execute(
    'SELECT COUNT(*) AS total FROM draw_record WHERE qq_id = ?',
    [qqId],
  );
  const total = Number(countRows[0]?.total || 0);

  // size / offset 已由 normalizePage 规整为正整数，这里直接内联，避免 LIMIT ? 的预编译兼容问题。
  const [rows] = await conn.execute(
    `SELECT r.record_no, r.qq_id, r.draw_mode, r.draw_count, r.total_score, r.highest_rarity,
            r.group_id, r.created_at, r.pool_id, p.pool_name AS pool_name
       FROM draw_record r
       LEFT JOIN card_pool p ON p.id = r.pool_id
      WHERE r.qq_id = ?
      ORDER BY r.id DESC
      LIMIT ${size} OFFSET ${offset}`,
    [qqId],
  );

  return { rows, total };
}

/** 某 QQ 在某卡池最近一次抽到的卡（用于「今日抽卡」的最近结果）。 */
async function findLatestItems(conn, { qqId, poolId }) {
  const [recordRows] = await conn.execute(
    `SELECT id FROM draw_record
      WHERE qq_id = ? AND pool_id = ?
      ORDER BY id DESC LIMIT 1`,
    [qqId, Number(poolId)],
  );
  const recordId = recordRows[0]?.id;
  if (!recordId) {
    return [];
  }
  const [itemRows] = await conn.execute(
    `SELECT card_name_snapshot, rarity_snapshot, score_snapshot
       FROM draw_record_item
      WHERE record_id = ?
      ORDER BY position_index ASC`,
    [recordId],
  );
  return itemRows.map((row) => ({
    card_name: row.card_name_snapshot,
    rarity: row.rarity_snapshot,
    score: Number(row.score_snapshot) || 0,
  }));
}

/** 管理端：带筛选条件的流水分页，并带出每条的卡牌明细。 */
async function listRecordsForAdmin(conn, { qqId, poolId, page, pageSize, maxPageSize = 50 }) {
  const { pageSize: size, offset } = normalizePage(page, pageSize, maxPageSize);
  const conditions = [];
  const params = [];
  if (qqId) {
    conditions.push('r.qq_id = ?');
    params.push(qqId);
  }
  if (poolId) {
    conditions.push('r.pool_id = ?');
    params.push(Number(poolId));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRows] = await conn.execute(
    `SELECT COUNT(*) AS total FROM draw_record r ${where}`,
    params,
  );

  const [rows] = await conn.execute(
    `SELECT r.id, r.record_no, r.qq_id, r.draw_mode, r.draw_count, r.total_score, r.highest_rarity,
            r.group_id, r.created_at, r.pool_id, p.pool_name AS pool_name
       FROM draw_record r
       LEFT JOIN card_pool p ON p.id = r.pool_id
       ${where}
      ORDER BY r.id DESC
      LIMIT ${size} OFFSET ${offset}`,
    params,
  );

  const records = rows.map((row) => ({ ...row, cards: [] }));
  if (records.length) {
    const ids = records.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(', ');
    const [itemRows] = await conn.execute(
      `SELECT record_id, card_name_snapshot, rarity_snapshot, score_snapshot, position_index
         FROM draw_record_item
        WHERE record_id IN (${placeholders})
        ORDER BY record_id ASC, position_index ASC`,
      ids,
    );
    const byRecord = new Map();
    for (const item of itemRows) {
      if (!byRecord.has(item.record_id)) {
        byRecord.set(item.record_id, []);
      }
      byRecord.get(item.record_id).push({
        card_name: item.card_name_snapshot,
        rarity: item.rarity_snapshot,
        score: Number(item.score_snapshot) || 0,
      });
    }
    for (const record of records) {
      record.cards = byRecord.get(record.id) || [];
    }
  }

  return { rows: records, total: Number(countRows[0]?.total || 0) };
}

/** 管理端概览：总记录数、今日记录数、今日参与人数。 */
async function overviewStats(conn, { today }) {
  const [rows] = await conn.execute(
    `SELECT
        COUNT(*) AS total_records,
        COALESCE(SUM(total_score), 0) AS total_score,
        COUNT(DISTINCT qq_id) AS total_users,
        COALESCE(SUM(CASE WHEN DATE(created_at) = ? THEN 1 ELSE 0 END), 0) AS today_records,
        COUNT(DISTINCT CASE WHEN DATE(created_at) = ? THEN qq_id END) AS today_users
      FROM draw_record`,
    [today, today],
  );
  const row = rows[0] || {};
  return {
    total_records: Number(row.total_records || 0),
    total_score: Number(row.total_score || 0),
    total_users: Number(row.total_users || 0),
    today_records: Number(row.today_records || 0),
    today_users: Number(row.today_users || 0),
  };
}

module.exports = {
  insertRecord,
  insertItems,
  listHistory,
  findLatestItems,
  listRecordsForAdmin,
  overviewStats,
  normalizePage,
};
