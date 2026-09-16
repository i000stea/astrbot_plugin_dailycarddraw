'use strict';

/**
 * 稀有度：与 gacha_YYYY-MM-DD.json 一致，使用 1~6 星整数，数字越大越稀有。
 * 兼容层：
 *   - rarityRank(1~6) -> 1~6，非法值返回 -1；
 *   - rarityTier(1~6)  -> N/R/SR/SSR/UR，其中 6★=UR、5★=SSR、4★=SR、3★=R、1~2★=N，
 *     用于沿用 user_profile 里 total_ssr_count / total_ur_count 的统计口径。
 */

const MIN_RARITY = 1;
const MAX_RARITY = 6;

/** 不同稀有度对应的默认积分，导入 JSON 未提供 score_value 时使用。 */
const DEFAULT_SCORE_BY_RARITY = Object.freeze({
  1: 1,
  2: 2,
  3: 5,
  4: 10,
  5: 30,
  6: 60,
});

function normalizeRarity(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.min(MAX_RARITY, Math.max(MIN_RARITY, parsed));
}

/** 稀有度比较用序号；无法识别时返回 -1（按最低处理）。 */
function rarityRank(rarity) {
  const normalized = normalizeRarity(rarity);
  return normalized === null ? -1 : normalized;
}

/** 数字稀有度 -> 星级字符串（如 6 -> ★★★★★★）。 */
function rarityStars(rarity) {
  const normalized = normalizeRarity(rarity);
  if (normalized === null) {
    return String(rarity ?? '');
  }
  return '★'.repeat(normalized);
}

/** 数字稀有度 -> 传统 N/R/SR/SSR/UR 分层，仅用于累计统计。 */
function rarityTier(rarity) {
  const normalized = normalizeRarity(rarity);
  if (normalized === null) {
    return '';
  }
  if (normalized >= 6) return 'UR';
  if (normalized >= 5) return 'SSR';
  if (normalized >= 4) return 'SR';
  if (normalized >= 3) return 'R';
  return 'N';
}

function defaultScoreForRarity(rarity) {
  const normalized = normalizeRarity(rarity);
  return normalized === null ? 0 : DEFAULT_SCORE_BY_RARITY[normalized];
}

function highestRarity(rarities) {
  let best = '';
  let bestRank = -1;
  for (const rarity of rarities) {
    const rank = rarityRank(rarity);
    if (rank > bestRank) {
      bestRank = rank;
      best = String(rarity ?? '');
    }
  }
  return best;
}

/**
 * 按权重随机抽 count 张，允许重复（每次独立抽取）。
 * cards: [{ card_id, card_name, rarity, score_value, weight }]
 */
function pickWeighted(cards, count) {
  const totalWeight = cards.reduce((sum, card) => sum + Math.max(0, Number(card.weight) || 0), 0);
  if (totalWeight <= 0) {
    throw new Error('卡池权重总和为 0，无法抽卡');
  }

  const picked = [];
  for (let index = 0; index < count; index += 1) {
    let hit = Math.random() * totalWeight;
    let chosen = cards[cards.length - 1];
    for (const card of cards) {
      hit -= Math.max(0, Number(card.weight) || 0);
      if (hit < 0) {
        chosen = card;
        break;
      }
    }
    picked.push(chosen);
  }
  return picked;
}

/**
 * 两段式加权抽卡：先按「稀有度权重」roll 一档星级，再在该星级内按卡牌自身权重 roll 具体卡。
 *
 * @param {Array} cards          [{ rarity, weight, ... }]，通常来自 pool_card join card_item
 * @param {Array} rarityWeights  [{ rarity, weight }]，来自 pool_rarity；缺失的星级自动回退
 * @param {number} count         抽几张（每张独立走一遍两段式随机）
 * @returns {Array} 抽中的卡牌对象数组（元素来自 cards）
 */
function pickWeightedByRarity(cards, rarityWeights, count) {
  // 1) 先按星级分组，只保留权重 > 0 的卡。
  const groups = new Map();
  for (const card of cards) {
    const rarity = normalizeRarity(card.rarity);
    if (rarity === null || Math.max(0, Number(card.weight) || 0) <= 0) {
      continue;
    }
    if (!groups.has(rarity)) {
      groups.set(rarity, []);
    }
    groups.get(rarity).push(card);
  }
  if (!groups.size) {
    throw new Error('卡池没有可抽取的卡牌（权重全为 0）');
  }

  // 2) 组装稀有度抽取池：优先用 pool_rarity 配置，未配置则回退到卡牌权重之和。
  const configured = new Map();
  for (const item of rarityWeights || []) {
    const rarity = normalizeRarity(item.rarity);
    if (rarity !== null) {
      configured.set(rarity, Math.max(0, Number(item.weight) || 0));
    }
  }
  const rarityPool = [];
  for (const [rarity, group] of groups) {
    const fallback = group.reduce((sum, card) => sum + Math.max(0, Number(card.weight) || 0), 0);
    const weight = configured.has(rarity) ? configured.get(rarity) : fallback;
    if (weight > 0) {
      rarityPool.push({ rarity, weight, cards: group });
    }
  }
  if (!rarityPool.length) {
    throw new Error('卡池稀有度权重总和为 0，无法抽卡');
  }

  // 3) 每张卡独立「先 roll 星级，再 roll 卡」。
  const picked = [];
  for (let index = 0; index < count; index += 1) {
    const tier = pickWeighted(rarityPool, 1)[0];
    picked.push(pickWeighted(tier.cards, 1)[0]);
  }
  return picked;
}

module.exports = {
  MIN_RARITY,
  MAX_RARITY,
  DEFAULT_SCORE_BY_RARITY,
  normalizeRarity,
  rarityRank,
  rarityStars,
  rarityTier,
  defaultScoreForRarity,
  highestRarity,
  pickWeighted,
  pickWeightedByRarity,
};
