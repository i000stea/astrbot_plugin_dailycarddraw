'use strict';

const { todayDate } = require('../time');
const { badRequest, notFound } = require('../http/responses');

/**
 * 查询服务：今日记录 / 历史记录 / 累计统计。
 * 返回结构必须与插件 DTO（app/models/dto.py）逐字段对齐。
 */
function createQueryService({ pool, config, repositories }) {
  const { poolRepository, quotaRepository, drawRecordRepository, userRepository } = repositories;

  async function resolvePool(conn, poolKey) {
    const key = String(poolKey || '').trim();
    if (!key) {
      throw badRequest('缺少 pool_key 参数。');
    }
    const cardPool = await poolRepository.findByKey(conn, key);
    if (!cardPool) {
      throw notFound(`卡池不存在：${key}`);
    }
    return cardPool;
  }

  return {
    async today({ qqId, poolKey }) {
      const normalizedQqId = String(qqId || '').trim();
      if (!normalizedQqId) {
        throw badRequest('缺少 qq_id 参数。');
      }
      const conn = await pool.getConnection();
      try {
        const cardPool = await resolvePool(conn, poolKey);
        const date = todayDate();
        const quotaRow = await quotaRepository.findTodayRow(conn, {
          qqId: normalizedQqId,
          date,
          poolId: cardPool.id,
        });
        const latestCards = await drawRecordRepository.findLatestItems(conn, {
          qqId: normalizedQqId,
          poolId: cardPool.id,
        });

        return {
          pool_name: cardPool.pool_name,
          quota: {
            single_used: Number(quotaRow?.single_used || 0),
            single_limit: Number(quotaRow?.single_limit ?? cardPool.daily_single_quota) || 0,
            ten_used: Number(quotaRow?.ten_used || 0),
            ten_limit: Number(quotaRow?.ten_limit ?? cardPool.daily_ten_draw_quota) || 0,
          },
          latest_cards: latestCards,
        };
      } finally {
        conn.release();
      }
    },

    async history({ qqId, page, pageSize }) {
      const normalizedQqId = String(qqId || '').trim();
      if (!normalizedQqId) {
        throw badRequest('缺少 qq_id 参数。');
      }
      const conn = await pool.getConnection();
      try {
        const { rows, total } = await drawRecordRepository.listHistory(conn, {
          qqId: normalizedQqId,
          page,
          pageSize,
          maxPageSize: config.draw.maxPageSize,
        });
        return {
          list: rows.map((row) => ({
            record_no: row.record_no,
            pool_name: row.pool_name || '未知卡池',
            draw_mode: row.draw_mode,
            draw_count: Number(row.draw_count) || 0,
            total_score: Number(row.total_score) || 0,
            highest_rarity: row.highest_rarity || '',
            created_at: row.created_at,
          })),
          total,
        };
      } finally {
        conn.release();
      }
    },

    async stats({ qqId }) {
      const normalizedQqId = String(qqId || '').trim();
      if (!normalizedQqId) {
        throw badRequest('缺少 qq_id 参数。');
      }
      const conn = await pool.getConnection();
      try {
        const profile = await userRepository.getProfile(conn, normalizedQqId);
        return {
          qq_id: normalizedQqId,
          nickname: profile?.nickname || '',
          total_draw_count: Number(profile?.total_draw_count || 0),
          total_single_draw_count: Number(profile?.total_single_draw_count || 0),
          total_ten_draw_count: Number(profile?.total_ten_draw_count || 0),
          total_score: Number(profile?.total_score || 0),
          total_ssr_count: Number(profile?.total_ssr_count || 0),
          total_ur_count: Number(profile?.total_ur_count || 0),
        };
      } finally {
        conn.release();
      }
    },
  };
}

module.exports = { createQueryService };
