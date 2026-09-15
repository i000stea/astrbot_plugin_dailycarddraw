'use strict';

/**
 * 插件端到端联调：真实 Python 插件代码 → 真实 Express 服务 → 内存 MySQL 替身。
 *
 * 目的：证明 Node 后端返回的结构能被插件的 DTO / 渲染层正确吃下去，
 * 即「插件只需要把 api_base_url 指过来」这句话是真的。
 *
 * 运行：
 *   node scripts/smoke-plugin.js
 *   PYTHON_BIN=/www/server/nodejs/xxx/bin/python3 node scripts/smoke-plugin.js   # 指定解释器
 *
 * 找不到可用的 Python 时会跳过（退出码 0 并提示），不会让 CI 误判为失败。
 */

process.env.ADMIN_API_TOKEN = 'test-admin-token';
process.env.PANEL_USERNAME = 'admin';
process.env.PANEL_PASSWORD = 'test-panel-password';
process.env.PANEL_JWT_SECRET = 'test-panel-jwt-secret';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { config } = require('../src/config');
const { buildContainer } = require('../src/container');
const { createApp } = require('../src/app');
const { createFakeDb } = require('./fakeDb');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HARNESS = path.join(__dirname, 'e2e', 'plugin-harness.py');
const TEST_QQ = '123456';

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

function resolvePython() {
  const candidates = [process.env.PYTHON_BIN, 'python3', 'python'].filter(Boolean);
  for (const candidate of candidates) {
    // stdio: 'ignore' —— 受限环境下 Node 无法用管道捕获子进程输出，只判断能否跑起来。
    const probe = spawnSync(candidate, ['-c', 'import sys'], { stdio: 'ignore' });
    if (probe.status === 0) {
      return { bin: candidate };
    }
  }
  return null;
}

async function main() {
  const python = resolvePython();
  if (!python) {
    console.log('SKIP: 找不到可用的 Python 解释器（可设置 PYTHON_BIN 指定），跳过插件端到端联调。');
    return;
  }
  console.log(`[info] 使用 Python：${python.bin}`);

  const db = createFakeDb();
  const services = buildContainer({ pool: db.pool, config });
  const app = createApp({ config, services, enableRequestLog: false });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  console.log(`[info] Node 服务：${baseUrl}`);

  const resultPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dcd-e2e-')), 'result.json');

  // 必须用异步 spawn：spawnSync 会阻塞事件循环，导致被测试的 HTTP 服务无法响应（互相等待直到超时）。
  // stdio 用 inherit：受限环境下 Node 无法用管道捕获子进程输出，因此结果由 Python 落盘。
  const exitCode = await new Promise((resolve) => {
    const child = spawn(
      python.bin,
      [HARNESS, REPO_ROOT, baseUrl, config.adminApiToken, TEST_QQ, resultPath],
      { stdio: 'inherit', cwd: REPO_ROOT },
    );
    child.on('error', (error) => {
      console.log(`[FAIL] 无法启动 Python：${error.message}`);
      resolve(-1);
    });
    child.on('exit', (code) => resolve(code));
  });

  await new Promise((resolve) => server.close(resolve));

  if (exitCode !== 0) {
    console.log(`[FAIL] 插件侧执行失败，退出码 ${exitCode}`);
    failures.push(`插件侧执行失败，退出码 ${exitCode}`);
  } else if (!fs.existsSync(resultPath)) {
    console.log('[FAIL] 插件侧未产出结果文件');
    failures.push('插件侧未产出结果文件');
  }

  let results = {};
  if (fs.existsSync(resultPath)) {
    results = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    fs.unlinkSync(resultPath);
  }

  const first = (key) => (Array.isArray(results[key]) ? String(results[key][0] || '') : '');

  console.log('\n--- 插件实际回复 ---');
  ['help', 'draw_single', 'draw_single_again', 'draw_ten', 'today', 'history', 'stats', 'pool_list', 'reset', 'draw_after_reset', 'bad_pool'].forEach(
    (key) => {
      const text = first(key);
      console.log(`\n### ${key}\n${text.split('\n').slice(0, 6).join('\n')}${text.split('\n').length > 6 ? '\n...' : ''}`);
    },
  );
  console.log('\n--- 断言 ---');

  check('插件以 AstrBot 的包路径导入成功', () => {
    assert.strictEqual(results.package, 'data.plugins.astrbot_plugin_dailycarddraw');
  });

  check('/抽卡帮助 正常', () => {
    assert.ok(first('help').includes('每日抽卡插件帮助'));
  });

  check('/抽卡 单抽成功且渲染正确', () => {
    const text = first('draw_single');
    assert.ok(text.includes('【每日抽卡】'), text);
    assert.ok(text.includes('卡池：常驻卡池'), text);
    assert.ok(text.includes('模式：单抽'), text);
    assert.ok(text.includes('今日单抽：1/1'), text);
    assert.ok(/记录号：DR\d{16}/.test(text), text);
  });

  check('第二次 /抽卡 返回后端给出的配额提示', () => {
    const text = first('draw_single_again');
    assert.ok(text.includes('抽卡失败：'), text);
    assert.ok(text.includes('今日单抽次数已用完'), text);
  });

  check('/抽卡 十连返回 10 张卡', () => {
    const text = first('draw_ten');
    assert.ok(text.includes('模式：十连'), text);
    assert.ok(text.includes('今日十连：1/1'), text);
    const numbered = text.split('\n').filter((line) => /^\d+\. /.test(line));
    assert.strictEqual(numbered.length, 10, `实际 ${numbered.length} 行卡牌`);
  });

  check('/今日抽卡 渲染配额与最近结果', () => {
    const text = first('today');
    assert.ok(text.includes('【今日抽卡记录】'), text);
    assert.ok(text.includes('今日单抽：1/1'), text);
    assert.ok(text.includes('今日十连：1/1'), text);
    assert.ok(!text.includes('今天还没有抽卡记录'), text);
  });

  check('/抽卡历史 分页与总数正确', () => {
    const text = first('history');
    assert.ok(text.includes('【抽卡历史】'), text);
    assert.ok(text.includes('页码：1'), text);
    assert.ok(text.includes('每页：10'), text);
    assert.ok(text.includes('总数：2'), text);
  });

  check('/抽卡统计 与后端累计一致', () => {
    const text = first('stats');
    assert.ok(text.includes('【累计统计】'), text);
    assert.ok(text.includes(`QQ：${TEST_QQ}`), text);
    assert.ok(text.includes('总抽卡次数：2'), text);
    assert.ok(text.includes('单抽次数：1'), text);
    assert.ok(text.includes('十连次数：1'), text);
  });

  check('/卡池列表（管理接口带 Token）正常', () => {
    const text = first('pool_list');
    assert.ok(text.includes('【卡池列表】'), text);
    assert.ok(text.includes('常驻卡池'), text);
    assert.ok(text.includes('normal_pool'), text);
  });

  check('/重置抽卡次数 成功', () => {
    const text = first('reset');
    assert.ok(text.includes('【重置成功】'), text);
    assert.ok(text.includes('卡池 ID：1'), text);
  });

  check('重置后再次 /抽卡 成功（插件→Node→库 全链路闭环）', () => {
    const text = first('draw_after_reset');
    assert.ok(text.includes('【每日抽卡】'), text);
    assert.ok(text.includes('今日单抽：1/1'), text);
  });

  check('不存在的卡池只返回后端原因（不再把整段 JSON 抛给用户）', () => {
    const text = first('bad_pool');
    assert.ok(text.includes('抽卡失败：'), text);
    assert.ok(text.includes('卡池不存在：no_such_pool'), text);
    assert.ok(!text.includes('{"success"'), text);
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
  console.error('端到端测试异常终止：', error);
  process.exit(1);
});
