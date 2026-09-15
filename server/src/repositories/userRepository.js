'use strict';

/**
 * 用户累计档案（user_profile）仓储。
 * 只在抽卡事务内做增量累加，避免「读-改-写」丢更新。
 */

async function getProfile(conn, qqId) {
  const [rows] = await conn.execute(
    `SELECT qq_id, nickname, total_draw_count, total_single_draw_count, total_ten_draw_count,
            total_score, total_ssr_count, total_ur_count, created_at, updated_at
       FROM user_profile WHERE qq_id = ? LIMIT 1`,
    [qqId],
  );
  return rows[0] || null;
}

/**
 * 抽卡后累加统计。
 * 首次出现的 QQ 直接插入；昵称为空时不覆盖已有昵称。
 */
async function applyDrawStats(conn, stats) {
  const {
    qqId,
    nickname,
    drawCount,
    singleCount,
    tenCount,
    score,
    ssrCount,
    urCount,
  } = stats;

  await conn.execute(
    `INSERT INTO user_profile
       (qq_id, nickname, total_draw_count, total_single_draw_count, total_ten_draw_count,
        total_score, total_ssr_count, total_ur_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       nickname = IF(? = '', nickname, ?),
       total_draw_count = total_draw_count + ?,
       total_single_draw_count = total_single_draw_count + ?,
       total_ten_draw_count = total_ten_draw_count + ?,
       total_score = total_score + ?,
       total_ssr_count = total_ssr_count + ?,
       total_ur_count = total_ur_count + ?`,
    [
      qqId,
      nickname || '',
      drawCount,
      singleCount,
      tenCount,
      score,
      ssrCount,
      urCount,
      nickname || '',
      nickname || '',
      drawCount,
      singleCount,
      tenCount,
      score,
      ssrCount,
      urCount,
    ],
  );
}

async function listProfiles(conn, { keyword, page, pageSize, maxPageSize = 50 }) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const size = Math.min(Math.max(1, Number.parseInt(pageSize, 10) || 20), maxPageSize);
  const offset = (safePage - 1) * size;

  const conditions = [];
  const params = [];
  if (keyword) {
    conditions.push('(qq_id LIKE ? OR nickname LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRows] = await conn.execute(
    `SELECT COUNT(*) AS total FROM user_profile ${where}`,
    params,
  );

  const [rows] = await conn.execute(
    `SELECT qq_id, nickname, total_draw_count, total_single_draw_count, total_ten_draw_count,
            total_score, total_ssr_count, total_ur_count, updated_at
       FROM user_profile ${where}
      ORDER BY total_draw_count DESC, id ASC
      LIMIT ${size} OFFSET ${offset}`,
    params,
  );

  return { rows, total: Number(countRows[0]?.total || 0) };
}

module.exports = { getProfile, applyDrawStats, listProfiles };
