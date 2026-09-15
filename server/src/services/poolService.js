'use strict';

const { withTransaction } = require('../db');
const { badRequest, notFound } = require('../http/responses');
const { todayDate } = require('../time');

const BOOLEAN_FIELDS = ['is_enabled', 'allow_single_draw', 'allow_ten_draw'];
const INTEGER_FIELDS = ['daily_single_quota', 'daily_ten_draw_quota'];
const DATETIME_FIELDS = ['start_at', 'end_at'];
const TEXT_FIELDS = ['pool_key', 'pool_name', 'description'];

const CARD_TEXT_FIELDS = ['card_key', 'card_name', 'rarity', 'description'];

/** 把前端传来的 JSON 收敛成明确的列值，杜绝把任意键名拼进 SQL。 */
function normalizePoolPayload(payload = {}) {
  const normalized = {};
  for (const field of TEXT_FIELDS) {
    if (payload[field] !== undefined) {
      normalized[field] = String(payload[field] ?? '').trim();
    }
  }
  for (const field of BOOLEAN_FIELDS) {
    if (payload[field] !== undefined) {
      normalized[field] = payload[field] ? 1 : 0;
    }
  }
  for (const field of INTEGER_FIELDS) {
    if (payload[field] !== undefined) {
      normalized[field] = Math.max(0, Number.parseInt(payload[field], 10) || 0);
    }
  }
  for (const field of DATETIME_FIELDS) {
    if (payload[field] !== undefined) {
      const raw = payload[field] === null ? '' : String(payload[field]).trim();
      normalized[field] = raw ? raw.replace('T', ' ') : null;
    }
  }
  return normalized;
}

function normalizeCardPayload(payload = {}) {
  const normalized = {};
  for (const field of CARD_TEXT_FIELDS) {
    if (payload[field] !== undefined) {
      normalized[field] = String(payload[field] ?? '').trim();
    }
  }
  if (payload.score_value !== undefined) {
    normalized.score_value = Number.parseInt(payload.score_value, 10) || 0;
  }
  if (payload.is_enabled !== undefined) {
    normalized.is_enabled = payload.is_enabled ? 1 : 0;
  }
  return normalized;
}

function assertPoolPayload(payload, { requireKey }) {
  if (requireKey) {
    if (!payload.pool_key) {
      throw badRequest('pool_key 不能为空。');
    }
    if (!payload.pool_name) {
      throw badRequest('pool_name 不能为空。');
    }
  }
  if (payload.pool_key && !/^[A-Za-z0-9_-]{1,64}$/.test(payload.pool_key)) {
    throw badRequest('pool_key 只能包含字母、数字、下划线和短横线。');
  }
}

/**
 * 卡池与卡牌管理服务：既服务插件侧的管理命令，也服务前端管理后台。
 */
function createPoolService({ pool, config, repositories }) {
  const { poolRepository, cardRepository } = repositories;

  async function useConn(handler) {
    const conn = await pool.getConnection();
    try {
      return await handler(conn);
    } finally {
      conn.release();
    }
  }

  return {
    /** 插件侧 /admin/pools 契约：只暴露插件解析用得到的字段。 */
    async listPools() {
      return useConn(async (conn) => {
        const rows = await poolRepository.listAll(conn);
        return {
          list: rows.map((row) => ({
            id: row.id,
            pool_key: row.pool_key,
            pool_name: row.pool_name,
            is_enabled: row.is_enabled,
            allow_single_draw: row.allow_single_draw,
            allow_ten_draw: row.allow_ten_draw,
          })),
        };
      });
    },

    /** 前端查询页用的公开卡池列表（仅启用中的卡池，字段最小化）。 */
    async listPublicPools() {
      return useConn(async (conn) => {
        const rows = await poolRepository.listEnabled(conn);
        return {
          list: rows.map((row) => ({
            id: row.id,
            pool_key: row.pool_key,
            pool_name: row.pool_name,
            allow_single_draw: row.allow_single_draw,
            allow_ten_draw: row.allow_ten_draw,
          })),
        };
      });
    },

    /** 管理后台用的完整卡池列表。 */
    async listPoolsForAdmin() {
      return useConn(async (conn) => {
        const rows = await poolRepository.listAll(conn);
        return { list: rows };
      });
    },

    async getPool(poolId) {
      return useConn(async (conn) => {
        const row = await poolRepository.findById(conn, poolId);
        if (!row) {
          throw notFound(`卡池不存在：${poolId}`);
        }
        return row;
      });
    },

    async createPool(payload) {
      const normalized = normalizePoolPayload(payload);
      assertPoolPayload(normalized, { requireKey: true });
      return withTransaction(pool, async (conn) => {
        const existing = await poolRepository.findByKey(conn, normalized.pool_key);
        if (existing) {
          throw badRequest(`pool_key 已存在：${normalized.pool_key}`);
        }
        const id = await poolRepository.create(conn, {
          ...normalized,
          is_enabled: normalized.is_enabled ?? 1,
          allow_single_draw: normalized.allow_single_draw ?? 1,
          allow_ten_draw: normalized.allow_ten_draw ?? 1,
          daily_single_quota: normalized.daily_single_quota ?? 1,
          daily_ten_draw_quota: normalized.daily_ten_draw_quota ?? 1,
          description: normalized.description ?? '',
        });
        return { id };
      });
    },

    async updatePool(poolId, payload) {
      const normalized = normalizePoolPayload(payload);
      assertPoolPayload(normalized, { requireKey: false });
      return withTransaction(pool, async (conn) => {
        const existing = await poolRepository.findById(conn, poolId);
        if (!existing) {
          throw notFound(`卡池不存在：${poolId}`);
        }
        if (normalized.pool_key && normalized.pool_key !== existing.pool_key) {
          const conflict = await poolRepository.findByKey(conn, normalized.pool_key);
          if (conflict) {
            throw badRequest(`pool_key 已被占用：${normalized.pool_key}`);
          }
        }
        await poolRepository.update(conn, poolId, normalized);
        return { id: Number(poolId) };
      });
    },

    async deletePool(poolId) {
      return withTransaction(pool, async (conn) => {
        const affected = await poolRepository.remove(conn, poolId);
        if (!affected) {
          throw notFound(`卡池不存在：${poolId}`);
        }
        return { id: Number(poolId), removed: true };
      });
    },

    async listCards({ keyword } = {}) {
      return useConn(async (conn) => {
        const rows = await cardRepository.listAll(conn, { keyword });
        return { list: rows };
      });
    },

    async createCard(payload) {
      const normalized = normalizeCardPayload(payload);
      if (!normalized.card_key || !normalized.card_name || !normalized.rarity) {
        throw badRequest('card_key、card_name、rarity 均为必填。');
      }
      return withTransaction(pool, async (conn) => {
        const id = await cardRepository.create(conn, {
          ...normalized,
          score_value: normalized.score_value ?? 0,
          description: normalized.description ?? '',
          is_enabled: normalized.is_enabled ?? 1,
        });
        return { id };
      });
    },

    async updateCard(cardId, payload) {
      const normalized = normalizeCardPayload(payload);
      return withTransaction(pool, async (conn) => {
        const existing = await cardRepository.findById(conn, cardId);
        if (!existing) {
          throw notFound(`卡牌不存在：${cardId}`);
        }
        await cardRepository.update(conn, cardId, normalized);
        return { id: Number(cardId) };
      });
    },

    async deleteCard(cardId) {
      return withTransaction(pool, async (conn) => {
        const affected = await cardRepository.remove(conn, cardId);
        if (!affected) {
          throw notFound(`卡牌不存在：${cardId}`);
        }
        return { id: Number(cardId), removed: true };
      });
    },

    /** 卡池内的卡牌与权重。 */
    async listPoolCards(poolId) {
      return useConn(async (conn) => {
        const cardPool = await poolRepository.findById(conn, poolId);
        if (!cardPool) {
          throw notFound(`卡池不存在：${poolId}`);
        }
        const items = await poolRepository.listPoolCards(conn, poolId);
        const totalWeight = items.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
        return {
          pool: cardPool,
          list: items.map((item) => ({
            ...item,
            rate: totalWeight > 0 ? Number(((Number(item.weight) || 0) / totalWeight).toFixed(6)) : 0,
          })),
          total_weight: totalWeight,
        };
      });
    },

    /** 整体替换卡池配置：items = [{card_id, weight, is_up}]。 */
    async replacePoolCards(poolId, items) {
      if (!Array.isArray(items)) {
        throw badRequest('items 必须是数组。');
      }
      const normalized = items.map((item) => ({
        card_id: Number.parseInt(item.card_id, 10),
        weight: Math.max(0, Number.parseInt(item.weight, 10) || 0),
        is_up: Boolean(item.is_up),
      }));
      if (normalized.some((item) => !Number.isInteger(item.card_id) || item.card_id <= 0)) {
        throw badRequest('items 中存在非法的 card_id。');
      }
      return withTransaction(pool, async (conn) => {
        const cardPool = await poolRepository.findById(conn, poolId);
        if (!cardPool) {
          throw notFound(`卡池不存在：${poolId}`);
        }
        await poolRepository.replacePoolCards(conn, poolId, normalized);
        return { pool_id: Number(poolId), count: normalized.length };
      });
    },
  };
}

module.exports = { createPoolService };
