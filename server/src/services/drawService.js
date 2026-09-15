'use strict';

const { withTransaction } = require('../db');
const { nowDateTime, todayDate, buildRecordNo } = require('../time');
const { pickWeighted, highestRarity } = require('../domain/draw');
const { badRequest, notFound, ApiError } = require('../http/responses');

const MODE_LABELS = { single: '单抽', ten: '十连' };

function isRecordNoConflict(error) {
  return Boolean(error) && error.code === 'ER_DUP_ENTRY' && String(error.message).includes('uk_draw_record_record_no');
}

/**
 * 抽卡服务：概率、每日次数扣减、记录落库、统计累加全部在这里完成。
 * 整个流程跑在一个事务里，并对 daily_quota 行加锁，避免并发把每日次数刷穿。
 */
function createDrawService({ pool, config, repositories }) {
  const { poolRepository, quotaRepository, drawRecordRepository, userRepository } = repositories;

  async function runOnce({ qqId, nickname, groupId, poolKey, drawMode }) {
    return withTransaction(pool, async (conn) => {
      const cardPool = await poolRepository.findByKey(conn, poolKey);
      if (!cardPool) {
        throw notFound(`卡池不存在：${poolKey}`);
      }
      if (!cardPool.is_enabled) {
        throw badRequest(`卡池「${cardPool.pool_name}」当前未开放。`);
      }

      const now = nowDateTime();
      if (cardPool.start_at && now < String(cardPool.start_at)) {
        throw badRequest(`卡池「${cardPool.pool_name}」尚未开始。`);
      }
      if (cardPool.end_at && now > String(cardPool.end_at)) {
        throw badRequest(`卡池「${cardPool.pool_name}」已结束。`);
      }
      if (drawMode === 'single' && !cardPool.allow_single_draw) {
        throw badRequest(`卡池「${cardPool.pool_name}」当前不支持单抽。`);
      }
      if (drawMode === 'ten' && !cardPool.allow_ten_draw) {
        throw badRequest(`卡池「${cardPool.pool_name}」当前不支持十连。`);
      }

      const date = todayDate();
      const quota = await quotaRepository.ensureTodayRowForUpdate(conn, {
        qqId,
        date,
        pool: cardPool,
      });
      if (!quota) {
        throw new ApiError('配额行初始化失败，请检查 daily_quota 表结构。', 500);
      }

      const used = Number(drawMode === 'ten' ? quota.ten_used : quota.single_used) || 0;
      const limit = Number(drawMode === 'ten' ? quota.ten_limit : quota.single_limit) || 0;
      if (used >= limit) {
        throw badRequest(`今日${MODE_LABELS[drawMode]}次数已用完（${used}/${limit}），明天再来吧。`);
      }

      const candidates = await poolRepository.listEnabledCards(conn, cardPool.id);
      if (!candidates.length) {
        throw badRequest(`卡池「${cardPool.pool_name}」暂无可抽卡牌，请联系管理员配置。`);
      }

      const drawCount = drawMode === 'ten' ? Math.max(1, config.draw.tenCount) : 1;
      const drawn = pickWeighted(candidates, drawCount);
      const totalScore = drawn.reduce((sum, card) => sum + (Number(card.score_value) || 0), 0);
      const topRarity = highestRarity(drawn.map((card) => card.rarity));
      const recordNo = buildRecordNo();

      const recordId = await drawRecordRepository.insertRecord(conn, {
        recordNo,
        qqId,
        poolId: cardPool.id,
        drawMode,
        drawCount,
        totalScore,
        highestRarity: topRarity,
        groupId,
        operatorContext: 'astrbot',
        createdAt: now,
      });
      await drawRecordRepository.insertItems(conn, recordId, drawn);
      await quotaRepository.incrementUsed(conn, { quotaId: quota.id, drawMode });
      await userRepository.applyDrawStats(conn, {
        qqId,
        nickname,
        drawCount: 1,
        singleCount: drawMode === 'single' ? 1 : 0,
        tenCount: drawMode === 'ten' ? 1 : 0,
        score: totalScore,
        ssrCount: drawn.filter((card) => card.rarity === 'SSR').length,
        urCount: drawn.filter((card) => card.rarity === 'UR').length,
      });

      return {
        record_no: recordNo,
        pool_name: cardPool.pool_name,
        draw_mode: drawMode,
        total_score: totalScore,
        quota: {
          single_used: (Number(quota.single_used) || 0) + (drawMode === 'single' ? 1 : 0),
          single_limit: Number(quota.single_limit) || 0,
          ten_used: (Number(quota.ten_used) || 0) + (drawMode === 'ten' ? 1 : 0),
          ten_limit: Number(quota.ten_limit) || 0,
        },
        cards: drawn.map((card) => ({
          card_name: card.card_name,
          rarity: card.rarity,
          score: Number(card.score_value) || 0,
        })),
      };
    });
  }

  return {
    async draw({ qqId, nickname, groupId, poolKey, drawMode }) {
      const normalizedQqId = String(qqId || '').trim();
      if (!normalizedQqId) {
        throw badRequest('缺少 qq_id 参数。');
      }
      const normalizedPoolKey = String(poolKey || '').trim();
      if (!normalizedPoolKey) {
        throw badRequest('缺少 pool_key 参数。');
      }
      const normalizedMode = String(drawMode || '').trim().toLowerCase();
      if (!MODE_LABELS[normalizedMode]) {
        throw badRequest(`不支持的抽卡模式：${drawMode}（仅支持 single / ten）。`);
      }

      const payload = {
        qqId: normalizedQqId,
        nickname: String(nickname || '').trim(),
        groupId: String(groupId || '').trim(),
        poolKey: normalizedPoolKey,
        drawMode: normalizedMode,
      };

      // record_no 是「时间戳 + 4 位随机」，同一秒内并发有极小概率撞唯一键，撞了就重来一次。
      let lastError;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await runOnce(payload);
        } catch (error) {
          lastError = error;
          if (!isRecordNoConflict(error)) {
            throw error;
          }
        }
      }
      throw lastError;
    },
  };
}

module.exports = { createDrawService };
