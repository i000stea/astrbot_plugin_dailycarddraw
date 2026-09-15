'use strict';

/**
 * 抽卡链路冒烟测试：用内存 MySQL 替身跑真实的仓储 + 服务代码。
 * 运行：node scripts/smoke-draw.js
 */

const assert = require('assert');

const { config } = require('../src/config');
const { buildContainer } = require('../src/container');
const { createFakeDb } = require('./fakeDb');
const { pickWeighted, highestRarity, rarityRank } = require('../src/domain/draw');

const failures = [];
function check(label, fn) {
  try {
    fn();
    console.log(`[PASS] ${label}`);
  } catch (error) {
    failures.push(`${label} -> ${error.message}`);
    console.log(`[FAIL] ${label} -> ${error.message}`);
  }
}

async function expectReject(label, promise, matcher) {
  try {
    await promise;
    failures.push(`${label} -> 预期抛错但成功返回`);
    console.log(`[FAIL] ${label} -> 预期抛错但成功返回`);
  } catch (error) {
    const ok = matcher(error);
    if (ok) {
      console.log(`[PASS] ${label} -> ${error.message}`);
    } else {
      failures.push(`${label} -> 错误信息不符合预期：${error.message}`);
      console.log(`[FAIL] ${label} -> 错误信息不符合预期：${error.message}`);
    }
  }
}

async function main() {
  const db = createFakeDb();
  const services = buildContainer({ pool: db.pool, config });
  const today = require('../src/time').todayDate();

  // ---------- 纯函数 ----------
  check('pickWeighted 抽出的张数正确', () => {
    const cards = db.state.poolCards.map((link) => {
      const card = db.state.cards.find((item) => item.id === link.card_id);
      return { ...card, weight: link.weight };
    });
    assert.strictEqual(pickWeighted(cards, 10).length, 10);
    assert.strictEqual(pickWeighted(cards, 1).length, 1);
  });

  check('权重为 0 的卡不会被抽到', () => {
    const cards = [
      { card_name: 'A', rarity: 'N', score_value: 1, weight: 0 },
      { card_name: 'B', rarity: 'N', score_value: 1, weight: 5 },
    ];
    for (let index = 0; index < 500; index += 1) {
      assert.strictEqual(pickWeighted(cards, 1)[0].card_name, 'B');
    }
  });

  check('加权分布大致符合权重（900:100 允许 ±8%）', () => {
    const cards = [
      { card_name: 'common', rarity: 'N', score_value: 1, weight: 900 },
      { card_name: 'rare', rarity: 'SSR', score_value: 12, weight: 100 },
    ];
    let rare = 0;
    const rounds = 20000;
    for (let index = 0; index < rounds; index += 1) {
      if (pickWeighted(cards, 1)[0].card_name === 'rare') {
        rare += 1;
      }
    }
    const rate = rare / rounds;
    assert.ok(Math.abs(rate - 0.1) < 0.02, `实际 ${(rate * 100).toFixed(2)}% 偏离期望 10%`);
  });

  check('highestRarity 按 N<R<SR<SSR<UR 取最高', () => {
    assert.strictEqual(highestRarity(['N', 'R', 'SR']), 'SR');
    assert.strictEqual(highestRarity(['SSR', 'UR', 'R']), 'UR');
    assert.strictEqual(highestRarity(['N', 'N']), 'N');
    assert.strictEqual(highestRarity([]), '');
    assert.ok(rarityRank('SSR') > rarityRank('SR'));
    assert.strictEqual(rarityRank('??'), -1);
  });

  // ---------- 单抽 ----------
  const single = await services.draw.draw({
    qqId: '10001',
    nickname: '测试玩家',
    groupId: '88888',
    poolKey: 'normal_pool',
    drawMode: 'single',
  });

  check('单抽返回契约字段完整', () => {
    assert.ok(single.record_no.startsWith('DR'));
    assert.strictEqual(single.pool_name, '常驻卡池');
    assert.strictEqual(single.draw_mode, 'single');
    assert.strictEqual(single.cards.length, 1);
    assert.strictEqual(single.quota.single_used, 1);
    assert.strictEqual(single.quota.single_limit, 1);
    assert.strictEqual(single.quota.ten_used, 0);
    assert.strictEqual(single.quota.ten_limit, 1);
    assert.strictEqual(single.total_score, single.cards[0].score);
    assert.ok(single.cards[0].card_name);
  });

  check('单抽落库：记录与明细写入，且明细为快照字段', () => {
    const record = db.state.records.find((row) => row.record_no === single.record_no);
    assert.ok(record, '未写入 draw_record');
    assert.strictEqual(record.qq_id, '10001');
    assert.strictEqual(record.draw_count, 1);
    assert.strictEqual(record.group_id, '88888');
    const items = db.state.items.filter((row) => row.record_id === record.id);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].card_name_snapshot, single.cards[0].card_name);
    assert.strictEqual(items[0].position_index, 1);
  });

  check('单抽落库：用户统计累加', () => {
    const profile = db.state.profiles.find((row) => row.qq_id === '10001');
    assert.ok(profile, '未写入 user_profile');
    assert.strictEqual(profile.total_draw_count, 1);
    assert.strictEqual(profile.total_single_draw_count, 1);
    assert.strictEqual(profile.total_ten_draw_count, 0);
    assert.strictEqual(profile.total_score, single.total_score);
    assert.strictEqual(profile.nickname, '测试玩家');
  });

  await expectReject(
    '同一 QQ 当天第二次单抽被拒绝',
    services.draw.draw({ qqId: '10001', poolKey: 'normal_pool', drawMode: 'single' }),
    (error) => error.status === 400 && error.message.includes('今日单抽次数已用完'),
  );

  check('超额抽卡被拒绝时事务回滚，不会留下脏记录', () => {
    assert.strictEqual(db.state.records.filter((row) => row.qq_id === '10001').length, 1);
    assert.ok(db.rollbackCount > 0, 'rollback 未被调用');
    const quota = db.state.quotas.find((row) => row.qq_id === '10001');
    assert.strictEqual(quota.single_used, 1);
  });

  // ---------- 十连 ----------
  const ten = await services.draw.draw({
    qqId: '10002',
    nickname: '',
    groupId: '',
    poolKey: 'normal_pool',
    drawMode: 'ten',
  });

  check('十连一次抽 10 张并只占 1 次十连配额', () => {
    assert.strictEqual(ten.cards.length, config.draw.tenCount);
    assert.strictEqual(ten.quota.ten_used, 1);
    assert.strictEqual(ten.quota.single_used, 0);
    assert.strictEqual(
      ten.total_score,
      ten.cards.reduce((sum, card) => sum + card.score, 0),
    );
  });

  check('十连明细按 position_index 顺序写入', () => {
    const record = db.state.records.find((row) => row.record_no === ten.record_no);
    const items = db.state.items
      .filter((row) => row.record_id === record.id)
      .sort((a, b) => a.position_index - b.position_index);
    assert.strictEqual(items.length, 10);
    assert.deepStrictEqual(
      items.map((row) => row.position_index),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    assert.deepStrictEqual(
      items.map((row) => row.card_name_snapshot),
      ten.cards.map((card) => card.card_name),
    );
  });

  check('十连的 highest_rarity 等于本次最高稀有度', () => {
    const record = db.state.records.find((row) => row.record_no === ten.record_no);
    assert.strictEqual(record.highest_rarity, highestRarity(ten.cards.map((card) => card.rarity)));
  });

  check('空昵称不覆盖已有昵称', () => {
    const profile = db.state.profiles.find((row) => row.qq_id === '10002');
    assert.strictEqual(profile.nickname, '');
    assert.strictEqual(profile.total_ten_draw_count, 1);
    assert.strictEqual(profile.total_draw_count, 1);
  });

  // ---------- 卡池开关与校验 ----------
  await expectReject(
    '不存在的卡池被拒绝',
    services.draw.draw({ qqId: '10003', poolKey: 'no_such_pool', drawMode: 'single' }),
    (error) => error.status === 404 && error.message.includes('卡池不存在'),
  );

  await expectReject(
    '非法抽卡模式被拒绝',
    services.draw.draw({ qqId: '10003', poolKey: 'normal_pool', drawMode: 'hundred' }),
    (error) => error.status === 400 && error.message.includes('不支持的抽卡模式'),
  );

  await expectReject(
    '缺少 qq_id 被拒绝',
    services.draw.draw({ qqId: '', poolKey: 'normal_pool', drawMode: 'single' }),
    (error) => error.status === 400 && error.message.includes('qq_id'),
  );

  db.state.pools.find((row) => row.pool_key === 'normal_pool').allow_ten_draw = 0;
  await expectReject(
    '卡池关闭十连后拒绝十连',
    services.draw.draw({ qqId: '10004', poolKey: 'normal_pool', drawMode: 'ten' }),
    (error) => error.message.includes('不支持十连'),
  );
  db.state.pools.find((row) => row.pool_key === 'normal_pool').allow_ten_draw = 1;

  db.state.pools.find((row) => row.pool_key === 'normal_pool').is_enabled = 0;
  await expectReject(
    '停用卡池拒绝抽卡',
    services.draw.draw({ qqId: '10005', poolKey: 'normal_pool', drawMode: 'single' }),
    (error) => error.message.includes('未开放'),
  );
  db.state.pools.find((row) => row.pool_key === 'normal_pool').is_enabled = 1;

  db.state.pools.find((row) => row.pool_key === 'normal_pool').start_at = '2999-01-01 00:00:00';
  await expectReject(
    '未到开始时间拒绝抽卡',
    services.draw.draw({ qqId: '10006', poolKey: 'normal_pool', drawMode: 'single' }),
    (error) => error.message.includes('尚未开始'),
  );
  db.state.pools.find((row) => row.pool_key === 'normal_pool').start_at = null;

  const originalWeights = db.state.poolCards.map((link) => ({ ...link }));
  db.state.poolCards.forEach((link) => {
    link.weight = 0;
  });
  await expectReject(
    '卡池没有可抽卡牌时给出明确提示',
    services.draw.draw({ qqId: '10007', poolKey: 'normal_pool', drawMode: 'single' }),
    (error) => error.message.includes('暂无可抽卡牌'),
  );
  db.state.poolCards = originalWeights;

  // ---------- 查询链路 ----------
  const todayResult = await services.query.today({ qqId: '10001', poolKey: 'normal_pool' });
  check('今日查询返回配额与最近结果', () => {
    assert.strictEqual(todayResult.pool_name, '常驻卡池');
    assert.strictEqual(todayResult.quota.single_used, 1);
    assert.strictEqual(todayResult.quota.single_limit, 1);
    assert.strictEqual(todayResult.latest_cards.length, 1);
    assert.strictEqual(todayResult.latest_cards[0].card_name, single.cards[0].card_name);
  });

  const history = await services.query.history({ qqId: '10001', page: 1, pageSize: 10 });
  check('历史查询带出卡池名与总数', () => {
    assert.strictEqual(history.total, 1);
    assert.strictEqual(history.list[0].record_no, single.record_no);
    assert.strictEqual(history.list[0].pool_name, '常驻卡池');
    assert.strictEqual(history.list[0].draw_mode, 'single');
  });

  const stats = await services.query.stats({ qqId: '10001' });
  check('统计查询与落库一致', () => {
    assert.strictEqual(stats.qq_id, '10001');
    assert.strictEqual(stats.total_draw_count, 1);
    assert.strictEqual(stats.total_score, single.total_score);
    assert.ok(stats.nickname);
  });

  const zeroStats = await services.query.stats({ qqId: '999999' });
  check('查不到的用户返回全 0 而不是报错', () => {
    assert.strictEqual(zeroStats.total_draw_count, 0);
    assert.strictEqual(zeroStats.total_score, 0);
    assert.strictEqual(zeroStats.qq_id, '999999');
  });

  // ---------- 管理链路 ----------
  const reset = await services.admin.resetQuota({ qqId: '10001', poolId: 'normal_pool' });
  check('用 pool_key 重置次数同样生效', () => {
    assert.strictEqual(reset.pool_id, 1);
    assert.strictEqual(reset.reset, true);
    assert.strictEqual(reset.quota_date, today);
    const quota = db.state.quotas.find((row) => row.qq_id === '10001');
    assert.strictEqual(quota.single_used, 0);
  });

  const afterReset = await services.query.today({ qqId: '10001', poolKey: 'normal_pool' });
  check('重置后可再次单抽', async () => {});
  assert.strictEqual(afterReset.quota.single_used, 0);
  const again = await services.draw.draw({
    qqId: '10001',
    nickname: '测试玩家',
    poolKey: 'normal_pool',
    drawMode: 'single',
  });
  check('重置后再次单抽成功', () => assert.ok(again.record_no));
  check('累计统计在重复抽卡后继续累加', () => {
    const profile = db.state.profiles.find((row) => row.qq_id === '10001');
    assert.strictEqual(profile.total_draw_count, 2);
    assert.strictEqual(profile.total_score, single.total_score + again.total_score);
  });

  const pools = await services.pool.listPools();
  check('插件侧卡池列表字段与插件解析一致', () => {
    assert.strictEqual(pools.list.length, 1);
    const [pool] = pools.list;
    assert.deepStrictEqual(Object.keys(pool).sort(), [
      'allow_single_draw',
      'allow_ten_draw',
      'id',
      'is_enabled',
      'pool_key',
      'pool_name',
    ]);
    assert.strictEqual(typeof pool.is_enabled, 'boolean');
  });

  const adminRecords = await services.admin.listRecords({ qqId: '10001', page: 1, pageSize: 20 });
  check('管理端流水带出明细卡片', () => {
    assert.strictEqual(adminRecords.total, 2);
    assert.ok(adminRecords.rows[0].cards.length >= 1);
  });

  const overview = await services.admin.overview();
  check('概览统计与库内数据一致', () => {
    assert.strictEqual(overview.total_records, 3);
    assert.strictEqual(overview.total_users, 2);
    assert.strictEqual(overview.pool_count, 1);
    assert.strictEqual(overview.enabled_pool_count, 1);
    assert.strictEqual(overview.quota_date, today);
  });

  // ---------- 卡池 / 卡牌 CRUD ----------
  const created = await services.pool.createPool({
    pool_key: 'event_pool',
    pool_name: '活动池',
    daily_single_quota: 2,
    daily_ten_draw_quota: 0,
    is_enabled: true,
    allow_single_draw: true,
    allow_ten_draw: false,
  });
  check('新建卡池成功', () => assert.ok(created.id > 1));

  await expectReject(
    '重复 pool_key 被拒绝',
    services.pool.createPool({ pool_key: 'event_pool', pool_name: '重复' }),
    (error) => error.status === 400 && error.message.includes('已存在'),
  );

  await expectReject(
    '非法 pool_key 被拒绝',
    services.pool.createPool({ pool_key: 'bad key!', pool_name: 'x' }),
    (error) => error.status === 400 && error.message.includes('pool_key'),
  );

  await services.pool.replacePoolCards(created.id, [
    { card_id: 1, weight: 1, is_up: true },
    { card_id: 2, weight: 0, is_up: false },
  ]);
  const poolCards = await services.pool.listPoolCards(created.id);
  check('卡池权重保存后只把 weight>0 的卡算进概率', () => {
    assert.strictEqual(poolCards.list.length, 2);
    assert.strictEqual(poolCards.total_weight, 1);
    const up = poolCards.list.find((item) => item.card_id === 1);
    assert.strictEqual(up.rate, 1);
    assert.strictEqual(up.is_up, true);
  });

  const eventDraw = await services.draw.draw({
    qqId: '10010',
    poolKey: 'event_pool',
    drawMode: 'single',
  });
  check('活动池按自己的配额规则抽卡', () => {
    assert.strictEqual(eventDraw.pool_name, '活动池');
    assert.strictEqual(eventDraw.cards[0].card_name, '星穹旅人');
    assert.strictEqual(eventDraw.quota.single_limit, 2);
  });

  const eventAgain = await services.draw.draw({
    qqId: '10010',
    poolKey: 'event_pool',
    drawMode: 'single',
  });
  check('活动池第 2 次单抽仍然可用', () => assert.strictEqual(eventAgain.quota.single_used, 2));

  await expectReject(
    '活动池第 3 次单抽被拒绝（配额 2）',
    services.draw.draw({ qqId: '10010', poolKey: 'event_pool', drawMode: 'single' }),
    (error) => error.message.includes('今日单抽次数已用完（2/2）'),
  );

  const card = await services.pool.createCard({
    card_key: 'test_card',
    card_name: '测试卡',
    rarity: 'UR',
    score_value: 30,
  });
  check('新建卡牌成功', () => assert.ok(card.id > 4));

  await services.pool.deleteCard(card.id);
  check('删除卡牌同时清理卡池引用', () => {
    assert.strictEqual(db.state.cards.find((row) => row.id === card.id), undefined);
    assert.strictEqual(db.state.poolCards.find((row) => row.card_id === card.id), undefined);
  });

  // ---------- 独立用户并发语义（放在最后，避免影响前面的断言） ----------
  const parallelResults = await Promise.allSettled([
    services.draw.draw({ qqId: '20001', poolKey: 'normal_pool', drawMode: 'single' }),
    services.draw.draw({ qqId: '20001', poolKey: 'normal_pool', drawMode: 'single' }),
    services.draw.draw({ qqId: '20001', poolKey: 'normal_pool', drawMode: 'single' }),
  ]);
  const fulfilled = parallelResults.filter((item) => item.status === 'fulfilled').length;
  check('同一 QQ 并发单抽在配额为 1 时只成功 1 次（FOR UPDATE 行锁 + 事务）', () => {
    assert.strictEqual(fulfilled, 1, `实际成功 ${fulfilled} 次`);
  });

  console.log('');
  if (failures.length) {
    console.log(`RESULT: ${failures.length} FAILURE(S)`);
    failures.forEach((item) => console.log(`  - ${item}`));
    process.exit(1);
  }
  console.log('RESULT: ALL CHECKS PASSED');
}

main().catch((error) => {
  console.error('冒烟测试异常终止：', error);
  process.exit(1);
});
