'use strict';

const { withTransaction } = require('../db');
const { badRequest, notFound } = require('../http/responses');
const { todayDate } = require('../time');
const { MIN_RARITY, MAX_RARITY, defaultScoreForRarity } = require('../domain/draw');
const { toObtainArray } = require('../domain/card');

const BOOLEAN_FIELDS = ['is_enabled', 'allow_single_draw', 'allow_ten_draw'];
const INTEGER_FIELDS = ['daily_single_quota', 'daily_ten_draw_quota'];
const DATETIME_FIELDS = ['start_at', 'end_at'];
const TEXT_FIELDS = ['pool_key', 'pool_name', 'description'];

const CARD_TEXT_FIELDS = ['card_key', 'card_name', 'description', 'profession'];

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
  if (payload.obtain !== undefined) {
      normalized.obtain = toObtainArray(payload.obtain);
    }
    if (payload.rarity !== undefined) {
    normalized.rarity = Number.parseInt(payload.rarity, 10);
    assertRarity(normalized.rarity);
  }
  if (payload.score_value !== undefined) {
    normalized.score_value = Math.max(0, Number.parseInt(payload.score_value, 10) || 0);
  }
  if (payload.is_enabled !== undefined) {
    normalized.is_enabled = payload.is_enabled ? 1 : 0;
  }
  return normalized;
}

function assertRarity(rarity) {
  if (!Number.isInteger(rarity) || rarity < MIN_RARITY || rarity > MAX_RARITY) {
    throw badRequest(`rarity 必须是 ${MIN_RARITY}~${MAX_RARITY} 之间的整数（星数）。`);
  }
}

/**
 * 把上传的 JSON 解析成卡牌数组。
 * 兼容以下三种写法：
 *   1. gacha_YYYY-MM-DD.json 原样：{ "RE21": {id,name,rarity,profession,obtain}, ... }
 *   2. 数组：[ {id,name,rarity,...}, ... ]
 *   3. 包一层：{ "cards": [...] } / { "list": [...] } / { "data": [...] }
 */
function collectCardEntries(input) {
  if (input === null || input === undefined) {
    return [];
  }
  if (Array.isArray(input)) {
    return input;
  }
  if (typeof input !== 'object') {
    return [];
  }
  for (const wrapper of ['cards', 'list', 'data', 'items']) {
    if (input[wrapper] !== undefined) {
      const nested = collectCardEntries(input[wrapper]);
      if (nested.length) {
        return nested;
      }
    }
  }
  const values = Object.values(input);
  if (values.length && values.every((value) => value && typeof value === 'object' && !Array.isArray(value))) {
    return values;
  }
  return [];
}

/** 单条 JSON -> 数据库行。字段名同时兼容 JSON 原文与数据库列名。 */
function normalizeImportedCard(raw) {
  const cardKey = String(raw.card_key ?? raw.id ?? '').trim();
  const cardName = String(raw.card_name ?? raw.name ?? '').trim();
  const rarity = Number.parseInt(raw.rarity, 10);
  const profession = String(raw.profession ?? '').trim();
  // JSON 里 obtain 可能是 "公开招募,中坚寻访" 这样的多值字符串，统一转成数组
  const obtain = toObtainArray(raw.obtain);
  const hasScore = raw.score_value !== undefined && raw.score_value !== null && raw.score_value !== '';
  const scoreValue = hasScore
    ? Math.max(0, Number.parseInt(raw.score_value, 10) || 0)
    : defaultScoreForRarity(rarity);
  const description = String(raw.description ?? '').trim();
  const isEnabled = raw.is_enabled === undefined ? 1 : raw.is_enabled ? 1 : 0;
  return { card_key: cardKey, card_name: cardName, rarity, profession, obtain, score_value: scoreValue, description, is_enabled: isEnabled };
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
/**
 * 计算卡池配置页需要的概率视图。
 * 抽卡是两段式：先按 pool_rarity 的星级权重定档，再在该星级内按卡牌权重定卡。
 * 未配置 star 权重的星级回退到该星级卡牌权重之和。
 */
function buildPoolCardView(items, rarityRows = []) {
  const configured = new Map();
  for (const row of rarityRows || []) {
    configured.set(Number(row.rarity), Math.max(0, Number(row.weight) || 0));
  }

  const byRarity = new Map();
  for (const item of items) {
    const rarity = Number(item.rarity) || 0;
    if (!byRarity.has(rarity)) {
      byRarity.set(rarity, []);
    }
    byRarity.get(rarity).push(item);
  }

  const rarityMap = new Map();
  for (const [rarity, list] of byRarity) {
    const cardWeightSum = list.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
    const weight = configured.has(rarity) ? configured.get(rarity) : cardWeightSum;
    rarityMap.set(rarity, { rarity, weight, card_weight_sum: cardWeightSum });
  }
  const rarityTotal = [...rarityMap.values()].reduce((sum, row) => sum + row.weight, 0);

  const list = items.map((item) => {
    const rarity = Number(item.rarity) || 0;
    const row = rarityMap.get(rarity);
    const within = row && row.card_weight_sum > 0
      ? Math.max(0, Number(item.weight) || 0) / row.card_weight_sum
      : 0;
    const rarityRate = row && rarityTotal > 0 ? row.weight / rarityTotal : 0;
    return {
      ...item,
      rate: Number((within * rarityRate).toFixed(6)),
      rarity_rate: Number(rarityRate.toFixed(6)),
      within_rarity_rate: Number(within.toFixed(6)),
    };
  });

  const rarityList = [...rarityMap.values()]
    .sort((a, b) => b.rarity - a.rarity)
    .map((row) => ({
      rarity: row.rarity,
      weight: row.weight,
      card_weight_sum: row.card_weight_sum,
      rate: rarityTotal > 0 ? Number((row.weight / rarityTotal).toFixed(6)) : 0,
    }));

  const totalWeight = items.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
  return {
    list,
    rarity_list: rarityList,
    total_weight: totalWeight,
    rarity_total_weight: rarityTotal,
  };
}

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

    /**
 * 复制卡池：连同卡牌权重、稀有度权重一起复制成一个新卡池。
 */
async copyPool(sourceId, payload = {}) {
  const source = await useConn((conn) => poolRepository.findById(conn, sourceId));
  if (!source) {
    throw notFound(`卡池不存在：${sourceId}`);
  }
  const newKey = String(payload.pool_key || '').trim() || `${source.pool_key}_copy`;
  const newName = String(payload.pool_name || '').trim() || `${source.pool_name} 副本`;
  assertPoolPayload({ pool_key: newKey, pool_name: newName }, { requireKey: true });

  return withTransaction(pool, async (conn) => {
    const conflict = await poolRepository.findByKey(conn, newKey);
    if (conflict) {
      throw badRequest(`pool_key 已存在：${newKey}`);
    }
    const sourceCards = await poolRepository.listPoolCards(conn, sourceId);
    const sourceRarities = await poolRepository.listRarityWeights(conn, sourceId);

    const newId = await poolRepository.create(conn, {
      pool_key: newKey,
      pool_name: newName,
      description: payload.description !== undefined ? String(payload.description) : source.description,
      is_enabled: payload.is_enabled !== undefined ? (payload.is_enabled ? 1 : 0) : source.is_enabled ? 1 : 0,
      allow_single_draw: payload.allow_single_draw !== undefined ? (payload.allow_single_draw ? 1 : 0) : source.allow_single_draw ? 1 : 0,
      allow_ten_draw: payload.allow_ten_draw !== undefined ? (payload.allow_ten_draw ? 1 : 0) : source.allow_ten_draw ? 1 : 0,
      daily_single_quota: source.daily_single_quota,
      daily_ten_draw_quota: source.daily_ten_draw_quota,
      start_at: source.start_at,
      end_at: source.end_at,
    });

    const cardItems = sourceCards.map((item) => ({
      card_id: item.card_id,
      weight: item.weight,
      is_up: item.is_up,
    }));
    await poolRepository.replacePoolCards(conn, newId, cardItems);
    await poolRepository.replaceRarityWeights(
      conn,
      newId,
      sourceRarities.map((row) => ({ rarity: row.rarity, weight: row.weight })),
    );

    return {
      id: newId,
      pool_key: newKey,
      pool_name: newName,
      card_count: cardItems.length,
      rarity_count: sourceRarities.length,
    };
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
      if (!normalized.card_key || !normalized.card_name || normalized.rarity === undefined) {
        throw badRequest('card_key、card_name、rarity 均为必填。');
      }
      return withTransaction(pool, async (conn) => {
        const id = await cardRepository.create(conn, {
          ...normalized,
          profession: normalized.profession ?? '',
            obtain: normalized.obtain ?? [],
            score_value: normalized.score_value ?? defaultScoreForRarity(normalized.rarity),
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

    /**
       * 管理后台上传 JSON 录入卡牌数据。
       * body.cards 支持 gacha_YYYY-MM-DD.json 原样对象 map、卡牌数组或 {cards:[...]} 包装；
       * 以 card_key 为唯一键：已存在则更新定义字段，不存在则新增。
       */
      async importCards(payload = {}) {
        const source = payload.cards !== undefined ? payload.cards : payload;
        const rawEntries = collectCardEntries(source);
        if (!rawEntries.length) {
          throw badRequest('没有解析到卡牌数据，请确认 JSON 是 gacha 文件的对象格式或卡牌数组。');
        }

        const byKey = new Map();
        const errors = [];
        rawEntries.forEach((raw, index) => {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            errors.push(`第 ${index + 1} 条不是卡牌对象，已跳过。`);
            return;
          }
          const card = normalizeImportedCard(raw);
          if (!card.card_key || !card.card_name) {
            errors.push(`第 ${index + 1} 条缺少 id/name（或 card_key/card_name），已跳过。`);
            return;
          }
          if (!Number.isInteger(card.rarity) || card.rarity < MIN_RARITY || card.rarity > MAX_RARITY) {
            errors.push(`卡牌 ${card.card_key} 的 rarity 不是 ${MIN_RARITY}~${MAX_RARITY} 的整数，已跳过。`);
            return;
          }
          byKey.set(card.card_key, card);
        });

        const cards = [...byKey.values()];
        if (!cards.length) {
          throw badRequest(`共 ${rawEntries.length} 条数据，但没有一条通过校验。`);
        }

        return withTransaction(pool, async (conn) => {
          const existingKeys = new Set(await cardRepository.listKeys(conn));
          await cardRepository.upsertMany(conn, cards);
          const created = cards.filter((card) => !existingKeys.has(card.card_key)).length;
          return {
            total: cards.length,
            created,
            updated: cards.length - created,
            skipped: errors.length,
            errors: errors.slice(0, 20),
          };
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
        const view = buildPoolCardView(items, await poolRepository.listRarityWeights(conn, poolId));
        const totalWeight = items.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
        return {
          pool: cardPool,
          _legacyList: items.map((item) => ({
            ...item,
            rate: totalWeight > 0 ? Number(((Number(item.weight) || 0) / totalWeight).toFixed(6)) : 0,
          })),
          total_weight: totalWeight,
        list: view.list,
        rarity_list: view.rarity_list,
        rarity_total_weight: view.rarity_total_weight,
        };
      });
    },

    /** 整体替换卡池配置：items = [{card_id, weight, is_up}]。 */
    async replacePoolCards(poolId, items, rarityItems) {
      if (!Array.isArray(items)) {
        throw badRequest('items 必须是数组。');
      }
      const normalized = items.map((item) => ({
        card_id: Number.parseInt(item.card_id, 10),
        weight: Math.max(0, Number.parseInt(item.weight, 10) || 0),
        is_up: Boolean(item.is_up),
      }));
      let normalizedRarities = null;
        if (rarityItems !== undefined) {
          if (!Array.isArray(rarityItems)) {
            throw badRequest('rarity_items 必须是数组。');
          }
          normalizedRarities = rarityItems.map((item) => ({
            rarity: Number.parseInt(item.rarity, 10),
            weight: Math.max(0, Number.parseInt(item.weight, 10) || 0),
          }));
          if (normalizedRarities.some((item) => !Number.isInteger(item.rarity) || item.rarity < MIN_RARITY || item.rarity > MAX_RARITY)) {
            throw badRequest(`rarity_items 中存在非法的 rarity（应为 ${MIN_RARITY}~${MAX_RARITY}）。`);
          }
        }
        if (normalized.some((item) => !Number.isInteger(item.card_id) || item.card_id <= 0)) {
        throw badRequest('items 中存在非法的 card_id。');
      }
      return withTransaction(pool, async (conn) => {
        const cardPool = await poolRepository.findById(conn, poolId);
        if (!cardPool) {
          throw notFound(`卡池不存在：${poolId}`);
        }
        await poolRepository.replacePoolCards(conn, poolId, normalized);
          if (normalizedRarities) {
            await poolRepository.replaceRarityWeights(conn, poolId, normalizedRarities);
          }
        return { pool_id: Number(poolId), count: normalized.length, rarity_count: normalizedRarities ? normalizedRarities.length : 0 };
      });
    },
  };
}

module.exports = { createPoolService };
