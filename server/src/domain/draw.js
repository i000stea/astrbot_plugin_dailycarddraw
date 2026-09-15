'use strict';

/**
 * 稀有权重顺序：只用于计算一条记录里的最高稀有度。
 * 不在表内的稀有度字符串按最低处理。
 */
const RARITY_ORDER = ['N', 'R', 'SR', 'SSR', 'UR'];

function rarityRank(rarity) {
  const index = RARITY_ORDER.indexOf(String(rarity || '').toUpperCase());
  return index < 0 ? -1 : index;
}

function highestRarity(rarities) {
  let best = '';
  let bestRank = -1;
  for (const rarity of rarities) {
    const rank = rarityRank(rarity);
    if (rank > bestRank) {
      bestRank = rank;
      best = String(rarity || '');
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

module.exports = { RARITY_ORDER, rarityRank, highestRarity, pickWeighted };
