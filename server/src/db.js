'use strict';

const mysql = require('mysql2/promise');

const { config } = require('./config');

function createPool() {
  return mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: config.db.connectionLimit,
    queueLimit: 0,
    charset: 'utf8mb4_general_ci',
    // 时间统一由应用层按 config.timeZone 生成为字符串写入，读出来保持原样，避免时区二次换算。
    dateStrings: true,
  });
}

/**
 * 在一个连接上跑事务：回调抛错则回滚，否则提交。
 */
async function withTransaction(pool, handler) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await handler(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try {
      await conn.rollback();
    } catch (rollbackError) {
      // 回滚失败时保留原始异常，仅记录，避免掩盖真正的错误。
      console.error('[db] rollback failed:', rollbackError.message);
    }
    throw error;
  } finally {
    conn.release();
  }
}

/** 启动时自检：数据库连通 + 关键表存在，便于宝塔上快速定位问题。 */
async function checkSchema(pool) {
  const requiredTables = [
    'card_pool',
    'card_item',
    'pool_card',
    'daily_quota',
    'draw_record',
    'draw_record_item',
    'user_profile',
  ];
  const [rows] = await pool.query(
    'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?',
    [config.db.database],
  );
  const existing = new Set(rows.map((row) => row.name));
  return {
    database: config.db.database,
    missingTables: requiredTables.filter((table) => !existing.has(table)),
  };
}

module.exports = { createPool, withTransaction, checkSchema };
