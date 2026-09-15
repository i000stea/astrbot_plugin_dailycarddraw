'use strict';

const { config } = require('./config');
const { createPool, checkSchema } = require('./db');
const { buildContainer } = require('./container');
const { createApp } = require('./app');

/**
 * 端口被占用时给出可执行的提示，而不是让 Node 抛一串 EADDRINUSE 栈。
 * 最常见的原因：上一次 node src/server.js 没退干净，或 PM2 里已经跑着同名应用。
 */
function attachServerErrorHandler(server, port = config.port) {
  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      console.error(`[boot] 端口 ${port} 已被占用：${config.host}:${port} 上已有进程在监听。`);
      console.error('[boot] 常见原因：上一次 node src/server.js 没有退出，或 PM2 里已经跑着同名应用。');
      console.error(`[boot] 排查命令：ss -lntp | grep :${port}     pm2 list     ps -ef | grep node`);
      console.error(
        `[boot] 处理方式：结束占用端口的进程；或把 .env 里的 APP_PORT 改掉` +
          '（改端口后要同步改插件 api_base_url 与 Nginx 反代）。',
      );
      process.exit(1);
    }
    console.error('[boot] 监听失败：', error);
    process.exit(1);
  });
  return server;
}

async function main() {
  const pool = createPool();

  try {
    const schema = await checkSchema(pool);
    if (schema.missingTables.length) {
      console.error(
        `[boot] 数据库 ${schema.database} 缺少表：${schema.missingTables.join(', ')}\n` +
          '[boot] 请先导入 server/sql/001_init_daily_carddraw.sql 再启动服务。',
      );
      process.exit(1);
    }
    console.log(`[boot] MySQL 连接正常，数据库：${schema.database}`);
  } catch (error) {
    console.error(`[boot] 无法连接 MySQL：${error.message}`);
    console.error('[boot] 请检查 server/.env 中的 MYSQL_* 配置（宝塔面板 → 数据库）。');
    process.exit(1);
  }

  const services = buildContainer({ pool, config });
  const app = createApp({ config, services });

  const server = attachServerErrorHandler(
    app.listen(config.port, config.host, () => {
      console.log(`[boot] daily-carddraw-server 已启动：http://${config.host}:${config.port}`);
      console.log(`[boot] 插件接口前缀：${config.apiPrefix}`);
      console.log(`[boot] 时区：${config.timeZone}（每日次数按此时区的自然日重置）`);
      if (!config.adminApiToken) {
        console.warn('[boot] 未配置 ADMIN_API_TOKEN，插件侧管理接口当前不鉴权。');
      }
      if (!config.panel.password && !config.panel.passwordSha256) {
        console.warn('[boot] 未配置 PANEL_PASSWORD，管理后台无法登录（请设置后才对外开放）。');
      }
      if (config.panel.jwtSecretGenerated) {
        console.warn('[boot] 未配置 PANEL_JWT_SECRET，本次启动随机生成；重启后后台登录态会失效。');
      }
    }),
  );

  const shutdown = (signal) => {
    console.log(`[boot] 收到 ${signal}，正在关闭...`);
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[boot] 启动失败：', error);
    process.exit(1);
  });
}

module.exports = { attachServerErrorHandler, main };
