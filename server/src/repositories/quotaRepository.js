'use strict';

/**
 * 每日配额（daily_quota）仓储。
 * 唯一键为 (qq_id, quota_date, pool_id)，同一 QQ 在同一天同一卡池只允许一行。
 */

/**
 * 取得（必要时创建）今天的配额行，并加行锁。
 * 必须在事务里调用，锁才有效 —— 这是并发下「每日 1 次」不被刷穿的关键。
 */
async function ensureTodayRowForUpdate(conn, { qqId, date, pool }) {
  const singleLimit = Math.max(0, Number(pool.daily_single_quota) || 0);
  const tenLimit = Math.max(0, Number(pool.daily_ten_draw_quota) || 0);

  await conn.execute(
    `INSERT INTO daily_quota (qq_id, quota_date, pool_id, single_used, ten_used, single_limit, ten_limit)
     VALUES (?, ?, ?, 0, 0, ?, ?)
     ON DUPLICATE KEY UPDATE single_limit = ?, ten_limit = ?`,
    [qqId, date, pool.id, singleLimit, tenLimit, singleLimit, tenLimit],
  );

  const [rows] = await conn.execute(
    `SELECT id, qq_id, quota_date, pool_id, single_used, ten_used, single_limit, ten_limit
       FROM daily_quota
      WHERE qq_id = ? AND quota_date = ? AND pool_id = ?
      FOR UPDATE`,
    [qqId, date, pool.id],
  );
  return rows[0] || null;
}

/** 只读查询今天的配额（不存在则返回 null，由调用方按 0 处理）。 */
async function findTodayRow(conn, { qqId, date, poolId }) {
  const [rows] = await conn.execute(
    `SELECT id, qq_id, quota_date, pool_id, single_used, ten_used, single_limit, ten_limit
       FROM daily_quota
      WHERE qq_id = ? AND quota_date = ? AND pool_id = ?
      LIMIT 1`,
    [qqId, date, poolId],
  );
  return rows[0] || null;
}

async function incrementUsed(conn, { quotaId, drawMode }) {
  const column = drawMode === 'ten' ? 'ten_used' : 'single_used';
  await conn.execute(`UPDATE daily_quota SET ${column} = ${column} + 1 WHERE id = ?`, [Number(quotaId)]);
}

/** 管理端重置：把某个 QQ 今天的次数清零。 */
async function resetToday(conn, { qqId, date, poolId }) {
  const [result] = await conn.execute(
    `UPDATE daily_quota SET single_used = 0, ten_used = 0
      WHERE qq_id = ? AND quota_date = ? AND pool_id = ?`,
    [qqId, date, Number(poolId)],
  );
  return result.affectedRows;
}

module.exports = { ensureTodayRowForUpdate, findTodayRow, incrementUsed, resetToday };
