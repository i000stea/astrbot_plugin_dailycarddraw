'use strict';

/**
 * HTTP 层冒烟测试：用内存 MySQL 替身起真实 Express 应用，逐个打真实接口。
 * 覆盖插件契约接口、管理接口鉴权、后台接口登录态、静态前端。
 * 运行：node scripts/smoke-http.js
 */

// 必须在 require config 之前设置，config 是在模块加载时读取环境变量的。
process.env.ADMIN_API_TOKEN = 'test-admin-token';
process.env.PANEL_USERNAME = 'admin';
process.env.PANEL_PASSWORD = 'test-panel-password';
process.env.PANEL_JWT_SECRET = 'test-panel-jwt-secret';

const assert = require('assert');

const { config } = require('../src/config');
const { buildContainer } = require('../src/container');
const { createApp } = require('../src/app');
const { createFakeDb } = require('./fakeDb');

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

async function main() {
  const db = createFakeDb();
  const services = buildContainer({ pool: db.pool, config });
  const app = createApp({ config, services, enableRequestLog: false });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`[info] 测试服务已启动：${base}\n`);

  const call = async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, options);
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (error) {
      json = null;
    }
    return { status: response.status, json, text, headers: response.headers };
  };

  const jsonPost = (body, headers = {}) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const jsonPut = (body, headers = {}) => ({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  // ---------- 基础 ----------
  const health = await call('/health');
  check('GET /health 返回成功外壳', () => {
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.json.success, true);
  });

  const indexPage = await call('/');
  check('GET / 返回查询页 HTML', () => {
    assert.strictEqual(indexPage.status, 200);
    assert.ok(indexPage.text.includes('每日抽卡'));
    assert.ok(indexPage.headers.get('content-type').includes('text/html'));
  });

  const adminPage = await call('/admin');
  check('GET /admin 返回管理后台 HTML', () => {
    assert.strictEqual(adminPage.status, 200);
    assert.ok(adminPage.text.includes('管理后台'));
  });

  const missing = await call('/api/nope');
  check('未知路由返回 JSON 404', () => {
    assert.strictEqual(missing.status, 404);
    assert.strictEqual(missing.json.success, false);
  });

  const badJson = await call('/api/daily-carddraw/draw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not-json',
  });
  check('非法 JSON 返回 400 且不抛 500', () => {
    assert.strictEqual(badJson.status, 400);
    assert.ok(badJson.json.message.includes('JSON'));
  });

  // ---------- 插件契约接口 ----------
  const pools = await call('/api/daily-carddraw/pools');
  check('GET /pools 返回启用中的卡池', () => {
    assert.strictEqual(pools.status, 200);
    assert.strictEqual(pools.json.data.list.length, 1);
    assert.strictEqual(pools.json.data.list[0].pool_key, 'normal_pool');
  });

  const draw = await call(
    '/api/daily-carddraw/draw',
    jsonPost({
      qq_id: '30001',
      nickname: 'HTTP 测试',
      group_id: '777',
      pool_key: 'normal_pool',
      draw_mode: 'single',
    }),
  );
  check('POST /draw 返回插件 DTO 所需字段', () => {
    assert.strictEqual(draw.status, 200);
    const data = draw.json.data;
    assert.deepStrictEqual(Object.keys(data).sort(), [
      'cards',
      'draw_mode',
      'pool_name',
      'quota',
      'record_no',
      'total_score',
    ]);
    assert.deepStrictEqual(Object.keys(data.quota).sort(), [
      'single_limit',
      'single_used',
      'ten_limit',
      'ten_used',
    ]);
    assert.deepStrictEqual(Object.keys(data.cards[0]).sort(), ['card_name', 'rarity', 'score']);
    assert.strictEqual(data.draw_mode, 'single');
    assert.strictEqual(data.cards.length, 1);
  });

  const drawAgain = await call(
    '/api/daily-carddraw/draw',
    jsonPost({ qq_id: '30001', pool_key: 'normal_pool', draw_mode: 'single' }),
  );
  check('配额用尽时返回 400 与可读原因（插件会当作失败原因展示）', () => {
    assert.strictEqual(drawAgain.status, 400);
    assert.strictEqual(drawAgain.json.success, false);
    assert.ok(drawAgain.json.message.includes('今日单抽次数已用完'));
  });

  const tenDraw = await call(
    '/api/daily-carddraw/draw',
    jsonPost({ qq_id: '30002', pool_key: 'normal_pool', draw_mode: 'ten' }),
  );
  check('POST /draw 十连返回 10 张卡', () => {
    assert.strictEqual(tenDraw.status, 200);
    assert.strictEqual(tenDraw.json.data.cards.length, 10);
    assert.strictEqual(tenDraw.json.data.quota.ten_used, 1);
  });

  const today = await call('/api/daily-carddraw/today?qq_id=30001&pool_key=normal_pool');
  check('GET /today 返回 pool_name/quota/latest_cards', () => {
    assert.strictEqual(today.status, 200);
    const data = today.json.data;
    assert.deepStrictEqual(Object.keys(data).sort(), ['latest_cards', 'pool_name', 'quota']);
    assert.strictEqual(data.quota.single_used, 1);
    assert.strictEqual(data.latest_cards[0].card_name, draw.json.data.cards[0].card_name);
  });

  const todayMissingPool = await call('/api/daily-carddraw/today?qq_id=30001&pool_key=nope');
  check('GET /today 卡池不存在时返回 404', () => {
    assert.strictEqual(todayMissingPool.status, 404);
    assert.ok(todayMissingPool.json.message.includes('卡池不存在'));
  });

  const history = await call('/api/daily-carddraw/history?qq_id=30001&page=1&page_size=10');
  check('GET /history 字段与插件 HistoryRecord 对齐', () => {
    assert.strictEqual(history.status, 200);
    const data = history.json.data;
    assert.strictEqual(data.total, 1);
    assert.deepStrictEqual(
      Object.keys(data.list[0]).sort(),
      ['created_at', 'draw_count', 'draw_mode', 'highest_rarity', 'pool_name', 'record_no', 'total_score'],
    );
  });

  const stats = await call('/api/daily-carddraw/stats?qq_id=30001');
  check('GET /stats 字段与插件 UserStats 对齐', () => {
    assert.strictEqual(stats.status, 200);
    const data = stats.json.data;
    assert.deepStrictEqual(Object.keys(data).sort(), [
      'nickname',
      'qq_id',
      'total_draw_count',
      'total_score',
      'total_single_draw_count',
      'total_ssr_count',
      'total_ten_draw_count',
      'total_ur_count',
    ]);
    assert.strictEqual(data.total_draw_count, 1);
  });

  // ---------- 插件管理接口鉴权 ----------
  const adminPoolsNoToken = await call('/api/daily-carddraw/admin/pools');
  check('管理接口无 Token 返回 401', () => {
    assert.strictEqual(adminPoolsNoToken.status, 401);
    assert.ok(adminPoolsNoToken.json.message.includes('鉴权'));
  });

  const adminPoolsBadToken = await call('/api/daily-carddraw/admin/pools', {
    headers: { Authorization: 'Bearer wrong' },
  });
  check('管理接口错误 Token 返回 401', () => assert.strictEqual(adminPoolsBadToken.status, 401));

  const adminPools = await call('/api/daily-carddraw/admin/pools', {
    headers: { Authorization: `Bearer ${config.adminApiToken}` },
  });
  check('管理接口正确 Token 返回卡池列表（含 list 字段）', () => {
    assert.strictEqual(adminPools.status, 200);
    assert.strictEqual(adminPools.json.data.list.length, 1);
    assert.strictEqual(adminPools.json.data.list[0].pool_name, '常驻卡池');
  });

  const resetQuota = await call(
    '/api/daily-carddraw/admin/reset-quota',
    jsonPost({ qq_id: '30001', pool_id: '1' }, { Authorization: `Bearer ${config.adminApiToken}` }),
  );
  check('POST /admin/reset-quota 用数字 ID 重置成功', () => {
    assert.strictEqual(resetQuota.status, 200);
    assert.strictEqual(resetQuota.json.data.reset, true);
  });

  const afterReset = await call('/api/daily-carddraw/today?qq_id=30001&pool_key=normal_pool');
  check('重置后今日已用次数归零', () => assert.strictEqual(afterReset.json.data.quota.single_used, 0));

  const userRecords = await call(
    '/api/daily-carddraw/admin/user-records?qq_id=30001',
    { headers: { Authorization: `Bearer ${config.adminApiToken}` } },
  );
  check('GET /admin/user-records 返回分页结构', () => {
    assert.strictEqual(userRecords.status, 200);
    assert.ok(Array.isArray(userRecords.json.data.list));
    assert.strictEqual(typeof userRecords.json.data.total, 'number');
  });

  // ---------- 后台登录 ----------
  const badLogin = await call('/manage/api/login', jsonPost({ username: 'admin', password: 'wrong' }));
  check('错误密码登录返回 401', () => assert.strictEqual(badLogin.status, 401));

  const statsNoAuth = await call('/manage/api/overview');
  check('未登录访问后台接口返回 401', () => assert.strictEqual(statsNoAuth.status, 401));

  const login = await call(
    '/manage/api/login',
    jsonPost({ username: 'admin', password: 'test-panel-password' }),
  );
  check('正确密码登录返回 JWT', () => {
    assert.strictEqual(login.status, 200);
    assert.ok(login.json.data.token.split('.').length === 3);
  });
  const auth = { Authorization: `Bearer ${login.json.data.token}` };

  const overview = await call('/manage/api/overview', { headers: auth });
  check('后台概览可用', () => {
    assert.strictEqual(overview.status, 200);
    assert.strictEqual(overview.json.data.total_records, 2);
  });

  const panelPools = await call('/manage/api/pools', { headers: auth });
  check('后台卡池列表返回完整字段', () => {
    assert.strictEqual(panelPools.status, 200);
    assert.ok(panelPools.json.data.list[0].daily_single_quota !== undefined);
  });

  const createPool = await call(
    '/manage/api/pools',
    jsonPost(
      {
        pool_key: 'http_pool',
        pool_name: 'HTTP 活动池',
        daily_single_quota: 3,
        daily_ten_draw_quota: 1,
        is_enabled: true,
        allow_single_draw: true,
        allow_ten_draw: true,
      },
      auth,
    ),
  );
  check('后台新建卡池', () => assert.strictEqual(createPool.status, 200));

  const newPoolId = createPool.json.data.id;
  const poolCards = await call(`/manage/api/pools/${newPoolId}/cards`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ items: [{ card_id: 1, weight: 100, is_up: true }] }),
  });
  check('后台保存卡池权重', () => assert.strictEqual(poolCards.status, 200));

  const drawOnNewPool = await call(
    '/api/daily-carddraw/draw',
    jsonPost({ qq_id: '30003', pool_key: 'http_pool', draw_mode: 'single' }),
  );
  check('新卡池立即可以按新权重抽卡', () => {
    assert.strictEqual(drawOnNewPool.status, 200);
    assert.strictEqual(drawOnNewPool.json.data.cards[0].card_name, '星穹旅人');
    assert.strictEqual(drawOnNewPool.json.data.quota.single_limit, 3);
  });

  const panelUsers = await call('/manage/api/users?page=1&page_size=20', { headers: auth });
  check('后台用户列表可用', () => {
    assert.strictEqual(panelUsers.status, 200);
    assert.ok(panelUsers.json.data.rows.length >= 2);
  });

  const panelRecords = await call('/manage/api/records?page=1&page_size=20', { headers: auth });
  check('后台流水带卡牌明细', () => {
    assert.strictEqual(panelRecords.status, 200);
    assert.ok(panelRecords.json.data.rows[0].cards.length >= 1);
  });

  const resetViaPanel = await call(
    '/manage/api/users/30002/reset-quota',
    jsonPost({ pool_id: 1 }, auth),
  );
  check('后台重置某个 QQ 的次数', () => assert.strictEqual(resetViaPanel.status, 200));

  const afterPanelReset = await call('/api/daily-carddraw/today?qq_id=30002&pool_key=normal_pool');
  check('后台重置后十连次数归零', () => assert.strictEqual(afterPanelReset.json.data.quota.ten_used, 0));

  const cardPage = await call('/manage/api/cards', { headers: auth });
  check('后台卡牌列表可用', () => {
    assert.strictEqual(cardPage.status, 200);
    assert.strictEqual(cardPage.json.data.list.length, 4);
  });

  const newCard = await call(
    '/manage/api/cards',
    jsonPost({ card_key: 'http_card', card_name: 'HTTP 卡', rarity: 'UR', score_value: 50 }, auth),
  );
  check('后台新建卡牌', () => assert.strictEqual(newCard.status, 200));

  const deleteCard = await call(`/manage/api/cards/${newCard.json.data.id}`, {
    method: 'DELETE',
    headers: auth,
  });
  check('后台删除卡牌', () => assert.strictEqual(deleteCard.status, 200));

  const deletePool = await call(`/manage/api/pools/${newPoolId}`, { method: 'DELETE', headers: auth });
  check('后台删除卡池', () => assert.strictEqual(deletePool.status, 200));

  await new Promise((resolve) => server.close(resolve));

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
