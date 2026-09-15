'use strict';

const { withTransaction } = require('../db');
const { todayDate } = require('../time');
const { badRequest, notFound } = require('../http/responses');

/**
 * 管理服务：重置次数、用户查询、流水查询、概览统计。
 */
function createAdminService({ pool, config, repositories }) {
  const { poolRepository, quotaRepository, drawRecordRepository, userRepository } = repositories;

  async function useConn(handler) {
    const conn = await pool.getConnection();
    try {
      return await handler(conn);
    } finally {
      conn.release();
    }
  }

  return {
    /** 插件侧 /admin/reset-quota：pool_id 传数字主键或 pool_key 都能识别。 */
    async resetQuota({ qqId, poolId }) {
      const normalizedQqId = String(qqId || '').trim();
      if (!normalizedQqId) {
        throw badRequest('缺少 qq_id 参数。');
      }
      const rawPool = String(poolId || '').trim();
      if (!rawPool) {
        throw badRequest('缺少 pool_id 参数。');
      }
      return withTransaction(pool, async (conn) => {
        const cardPool = await poolRepository.findByIdOrKey(conn, rawPool);
        if (!cardPool) {
          throw notFound(`卡池不存在：${rawPool}`);
        }
        const date = todayDate();
        const affectedRows = await quotaRepository.resetToday(conn, {
          qqId: normalizedQqId,
          date,
          poolId: cardPool.id,
        });
        return {
          qq_id: normalizedQqId,
          pool_id: cardPool.id,
          pool_key: cardPool.pool_key,
          quota_date: date,
          affected_rows: affectedRows,
          reset: true,
        };
      });
    },

    async listUserRecords({ qqId, page, pageSize }) {
      const normalizedQqId = String(qqId || '').trim();
      if (!normalizedQqId) {
        throw badRequest('缺少 qq_id 参数。');
      }
      return useConn(async (conn) => {
        const { rows, total } = await drawRecordRepository.listHistory(conn, {
          qqId: normalizedQqId,
          page: page ?? 1,
          pageSize: pageSize ?? 20,
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
      });
    },

    async listProfiles({ keyword, page, pageSize }) {
      return useConn(async (conn) =>
        userRepository.listProfiles(conn, {
          keyword: String(keyword || '').trim(),
          page,
          pageSize,
          maxPageSize: config.draw.maxPageSize,
        }),
      );
    },

    async listRecords({ qqId, poolId, page, pageSize }) {
      return useConn(async (conn) =>
        drawRecordRepository.listRecordsForAdmin(conn, {
          qqId: String(qqId || '').trim(),
          poolId: poolId ? Number.parseInt(poolId, 10) : null,
          page,
          pageSize,
          maxPageSize: config.draw.maxPageSize,
        }),
      );
    },

    /** 管理后台概览：总记录、总积分、用户数、今日记录与今日参与人数。 */
    async overview() {
      return useConn(async (conn) => {
        const date = todayDate();
        const stats = await drawRecordRepository.overviewStats(conn, { today: date });
        const pools = await poolRepository.listAll(conn);
        return {
          ...stats,
          quota_date: date,
          pool_count: pools.length,
          enabled_pool_count: pools.filter((item) => item.is_enabled).length,
        };
      });
    },
  };
}

module.exports = { createAdminService };
