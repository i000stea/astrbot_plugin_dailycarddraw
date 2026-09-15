'use strict';

/**
 * 内存版 MySQL 替身，仅用于本地冒烟测试。
 *
 * 它不校验 SQL 语法，而是按本项目 repositories 里真实发出的语句逐条匹配，
 * 目的有两个：
 *   1. 在拿不到真实 MySQL 的环境下，让「路由 → 服务 → 仓储」整条链路可以真的跑起来；
 *   2. 覆盖事务行为（begin/commit/rollback），验证配额扣减失败时确实会回滚。
 *
 * 真实 SQL 的正确性仍需在宝塔 MySQL 上跑一次 server/sql/001_init_daily_carddraw.sql 后验证。
 */

const clone = (value) => JSON.parse(JSON.stringify(value));

function createState() {
  return {
    pools: [
      {
        id: 1,
        pool_key: 'normal_pool',
        pool_name: '常驻卡池',
        description: '默认常驻卡池',
        is_enabled: 1,
        allow_single_draw: 1,
        allow_ten_draw: 1,
        daily_single_quota: 1,
        daily_ten_draw_quota: 1,
        start_at: null,
        end_at: null,
      },
    ],
    cards: [
      { id: 1, card_key: 'star_traveler', card_name: '星穹旅人', rarity: 'SSR', score_value: 12, description: '', is_enabled: 1 },
      { id: 2, card_key: 'star_apprentice', card_name: '巡星学徒', rarity: 'SR', score_value: 5, description: '', is_enabled: 1 },
      { id: 3, card_key: 'wild_walker', card_name: '荒野旅者', rarity: 'R', score_value: 2, description: '', is_enabled: 1 },
      { id: 4, card_key: 'morning_recorder', card_name: '晨光记录员', rarity: 'N', score_value: 1, description: '', is_enabled: 1 },
    ],
    poolCards: [
      { id: 1, pool_id: 1, card_id: 1, weight: 5, is_up: 0 },
      { id: 2, pool_id: 1, card_id: 2, weight: 20, is_up: 0 },
      { id: 3, pool_id: 1, card_id: 3, weight: 40, is_up: 0 },
      { id: 4, pool_id: 1, card_id: 4, weight: 60, is_up: 0 },
    ],
    quotas: [],
    records: [],
    items: [],
    profiles: [],
    autoIncrement: { pools: 2, cards: 5, poolCards: 5, quotas: 1, records: 1, items: 1 },
  };
}

function createFakeDb() {
  const db = {
    state: createState(),
    snapshot: null,
    log: [],
    rollbackCount: 0,
    commitCount: 0,
  };

  const nextId = (table) => {
    const id = db.state.autoIncrement[table];
    db.state.autoIncrement[table] = id + 1;
    return id;
  };

  /**
   * 用 Promise 链模拟 InnoDB 的行锁：
   * 同一 (qq, date, pool) 上的第二条 `SELECT ... FOR UPDATE` 会一直等到前一个事务提交/回滚。
   * 这样并发抽卡测试才有意义 —— 否则内存替身会让人误以为「每日 1 次」防不住并发。
   */
  const keyLocks = new Map();

  function acquireKeyLock(key) {
    const previous = keyLocks.get(key) || Promise.resolve();
    let releaseGate;
    const gate = new Promise((resolve) => {
      releaseGate = resolve;
    });
    const tail = previous.then(() => gate);
    keyLocks.set(key, tail);
    return previous.then(() => {
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        releaseGate();
        if (keyLocks.get(key) === tail) {
          keyLocks.delete(key);
        }
      };
    });
  }

  const select = (rows) => [rows, []];
  const write = (insertId, affectedRows) => [{ insertId, affectedRows }, []];

  const poolRow = (row) => ({ ...row });
  const cardRow = (row) => ({ ...row });

  /**
   * 匹配表：按顺序取第一条命中的规则。
   * 每条规则返回 mysql2 风格的 [result, fields]。
   */
  const routes = [
    // ---------- daily_quota ----------
    {
      test: /INSERT INTO daily_quota/i,
      handle: (params) => {
        const [qqId, date, poolId, , , singleLimit, tenLimit] = params;
        let row = db.state.quotas.find(
          (item) => item.qq_id === qqId && item.quota_date === date && item.pool_id === poolId,
        );
        if (!row) {
          row = {
            id: nextId('quotas'),
            qq_id: qqId,
            quota_date: date,
            pool_id: poolId,
            single_used: 0,
            ten_used: 0,
            single_limit: singleLimit,
            ten_limit: tenLimit,
          };
          db.state.quotas.push(row);
        } else {
          row.single_limit = singleLimit;
          row.ten_limit = tenLimit;
        }
        return write(row.id, 1);
      },
    },
    {
      test: /SELECT id, qq_id, quota_date, pool_id, single_used, ten_used, single_limit, ten_limit\s+FROM daily_quota/i,
      handle: async (params) => {
        const [qqId, date, poolId] = params;
        if (/FOR UPDATE/i.test(db.currentSql)) {
          const release = await acquireKeyLock(`quota:${qqId}:${date}:${poolId}`);
          conn.heldLocks.push(release);
        }
        const row = db.state.quotas.find(
          (item) => item.qq_id === qqId && item.quota_date === date && item.pool_id === poolId,
        );
        return select(row ? [{ ...row }] : []);
      },
    },
    {
      test: /UPDATE daily_quota SET single_used = single_used \+ 1/i,
      handle: (params) => {
        const row = db.state.quotas.find((item) => item.id === params[0]);
        if (row) {
          row.single_used += 1;
        }
        return write(0, row ? 1 : 0);
      },
    },
    {
      test: /UPDATE daily_quota SET ten_used = ten_used \+ 1/i,
      handle: (params) => {
        const row = db.state.quotas.find((item) => item.id === params[0]);
        if (row) {
          row.ten_used += 1;
        }
        return write(0, row ? 1 : 0);
      },
    },
    {
      test: /UPDATE daily_quota SET single_used = 0, ten_used = 0/i,
      handle: (params) => {
        const [qqId, date, poolId] = params;
        let affected = 0;
        db.state.quotas.forEach((row) => {
          if (row.qq_id === qqId && row.quota_date === date && row.pool_id === poolId) {
            row.single_used = 0;
            row.ten_used = 0;
            affected += 1;
          }
        });
        return write(0, affected);
      },
    },
    { test: /DELETE FROM daily_quota WHERE pool_id = \?/i, handle: (params) => {
      const before = db.state.quotas.length;
      db.state.quotas = db.state.quotas.filter((row) => row.pool_id !== params[0]);
      return write(0, before - db.state.quotas.length);
    } },

    // ---------- card_pool ----------
    {
      test: /^\s*SELECT[\s\S]*?FROM card_pool WHERE pool_key = \?/i,
      handle: (params) => {
        const row = db.state.pools.find((item) => item.pool_key === params[0]);
        return select(row ? [poolRow(row)] : []);
      },
    },
    {
      test: /^\s*SELECT[\s\S]*?FROM card_pool WHERE id = \?/i,
      handle: (params) => {
        const row = db.state.pools.find((item) => item.id === params[0]);
        return select(row ? [poolRow(row)] : []);
      },
    },
    {
      test: /^\s*SELECT[\s\S]*?FROM card_pool WHERE is_enabled = 1/i,
      handle: () => select(db.state.pools.filter((item) => item.is_enabled === 1).map(poolRow)),
    },
    {
      test: /^\s*SELECT[\s\S]*?FROM card_pool\s+ORDER BY id ASC/i,
      handle: () => select(db.state.pools.map(poolRow)),
    },
    {
      test: /INSERT INTO card_pool/i,
      handle: (params) => {
        const id = nextId('pools');
        db.state.pools.push({
          id,
          pool_key: params[0],
          pool_name: params[1],
          description: params[2],
          is_enabled: params[3],
          allow_single_draw: params[4],
          allow_ten_draw: params[5],
          daily_single_quota: params[6],
          daily_ten_draw_quota: params[7],
          start_at: params[8] ?? null,
          end_at: params[9] ?? null,
        });
        return write(id, 1);
      },
    },
    {
      test: /UPDATE card_pool SET/i,
      handle: (params) => {
        const id = params[params.length - 1];
        const row = db.state.pools.find((item) => item.id === id);
        if (!row) {
          return write(0, 0);
        }
        const columns = /UPDATE card_pool SET (.*) WHERE id = \?/i.exec(db.currentSql)[1].split(', ');
        columns.forEach((assignment, index) => {
          const column = assignment.split(' = ')[0].trim();
          row[column] = params[index];
        });
        return write(0, 1);
      },
    },
    { test: /DELETE FROM card_pool WHERE id = \?/i, handle: (params) => {
      const before = db.state.pools.length;
      db.state.pools = db.state.pools.filter((row) => row.id !== params[0]);
      return write(0, before - db.state.pools.length);
    } },

    // ---------- card_item ----------
    {
      test: /^\s*SELECT[\s\S]*?FROM card_item\s+WHERE id = \?/i,
      handle: (params) => {
        const row = db.state.cards.find((item) => item.id === params[0]);
        return select(row ? [cardRow(row)] : []);
      },
    },
    {
      test: /^\s*SELECT[\s\S]*?FROM card_item/i,
      handle: (params) => {
        if (params && params.length === 2) {
          const keyword = String(params[0]).replace(/%/g, '');
          return select(
            db.state.cards
              .filter((card) => card.card_key.includes(keyword) || card.card_name.includes(keyword))
              .map(cardRow),
          );
        }
        return select(db.state.cards.map(cardRow));
      },
    },
    {
      test: /INSERT INTO card_item/i,
      handle: (params) => {
        const id = nextId('cards');
        db.state.cards.push({
          id,
          card_key: params[0],
          card_name: params[1],
          rarity: params[2],
          score_value: params[3],
          description: params[4],
          is_enabled: params[5],
        });
        return write(id, 1);
      },
    },
    { test: /UPDATE card_item SET/i, handle: () => write(0, 1) },
    { test: /DELETE FROM card_item WHERE id = \?/i, handle: (params) => {
      const before = db.state.cards.length;
      db.state.cards = db.state.cards.filter((row) => row.id !== params[0]);
      return write(0, before - db.state.cards.length);
    } },

    // ---------- pool_card ----------
    {
      test: /FROM pool_card pc\s+JOIN card_item c ON c\.id = pc\.card_id\s+WHERE pc\.pool_id = \? AND c\.is_enabled = 1 AND pc\.weight > 0/i,
      handle: (params) =>
        select(
          db.state.poolCards
            .filter((link) => link.pool_id === params[0] && link.weight > 0)
            .map((link) => {
              const card = db.state.cards.find((item) => item.id === link.card_id);
              if (!card || card.is_enabled !== 1) {
                return null;
              }
              return {
                card_id: card.id,
                card_key: card.card_key,
                card_name: card.card_name,
                rarity: card.rarity,
                score_value: card.score_value,
                weight: link.weight,
                is_up: link.is_up,
              };
            })
            .filter(Boolean),
        ),
    },
    {
      test: /FROM pool_card pc\s+JOIN card_item c/i,
      handle: (params) =>
        select(
          db.state.poolCards
            .filter((link) => link.pool_id === params[0])
            .map((link) => {
              const card = db.state.cards.find((item) => item.id === link.card_id) || {};
              return {
                pool_card_id: link.id,
                card_id: link.card_id,
                weight: link.weight,
                is_up: link.is_up,
                card_key: card.card_key,
                card_name: card.card_name,
                rarity: card.rarity,
                score_value: card.score_value,
                is_enabled: card.is_enabled,
              };
            }),
        ),
    },
    { test: /DELETE FROM pool_card WHERE pool_id = \?/i, handle: (params) => {
      db.state.poolCards = db.state.poolCards.filter((link) => link.pool_id !== params[0]);
      return write(0, 0);
    } },
    { test: /DELETE FROM pool_card WHERE card_id = \?/i, handle: (params) => {
      db.state.poolCards = db.state.poolCards.filter((link) => link.card_id !== params[0]);
      return write(0, 0);
    } },
    {
      test: /INSERT INTO pool_card \(pool_id, card_id, weight, is_up\) VALUES/i,
      handle: (params) => {
        for (let index = 0; index < params.length; index += 4) {
          db.state.poolCards.push({
            id: nextId('poolCards'),
            pool_id: params[index],
            card_id: params[index + 1],
            weight: params[index + 2],
            is_up: params[index + 3],
          });
        }
        return write(0, params.length / 4);
      },
    },

    // ---------- draw_record ----------
    {
      test: /INSERT INTO draw_record\b/i,
      handle: (params) => {
        const id = nextId('records');
        db.state.records.push({
          id,
          record_no: params[0],
          qq_id: params[1],
          pool_id: params[2],
          draw_mode: params[3],
          draw_count: params[4],
          total_score: params[5],
          highest_rarity: params[6],
          group_id: params[7],
          operator_context: params[8],
          created_at: params[9],
        });
        return write(id, 1);
      },
    },
    {
      test: /INSERT INTO draw_record_item/i,
      handle: (params) => {
        for (let index = 0; index < params.length; index += 6) {
          db.state.items.push({
            id: nextId('items'),
            record_id: params[index],
            card_id: params[index + 1],
            card_name_snapshot: params[index + 2],
            rarity_snapshot: params[index + 3],
            score_snapshot: params[index + 4],
            position_index: params[index + 5],
          });
        }
        return write(0, params.length / 6);
      },
    },
    {
      test: /SELECT COUNT\(\*\) AS total FROM draw_record WHERE qq_id = \?/i,
      handle: (params) =>
        select([{ total: db.state.records.filter((row) => row.qq_id === params[0]).length }]),
    },
    {
      test: /SELECT COUNT\(\*\) AS total FROM draw_record r/i,
      handle: (params) => {
        const filtered = filterRecords(db, params);
        return select([{ total: filtered.length }]);
      },
    },
    {
      test: /SELECT id FROM draw_record/i,
      handle: (params) => {
        const rows = db.state.records
          .filter((row) => row.qq_id === params[0] && row.pool_id === params[1])
          .sort((a, b) => b.id - a.id);
        return select(rows.length ? [{ id: rows[0].id }] : []);
      },
    },
    {
      test: /SELECT r\.record_no, r\.qq_id, r\.draw_mode/i,
      handle: (params) => {
        const filtered = filterRecords(db, params);
        const [limit, offset] = parseLimitOffset(db.currentSql);
        return select(paginate(filtered, limit, offset));
      },
    },
    {
      test: /SELECT r\.id, r\.record_no, r\.qq_id/i,
      handle: (params) => {
        const filtered = filterRecords(db, params);
        const [limit, offset] = parseLimitOffset(db.currentSql);
        return select(paginate(filtered, limit, offset));
      },
    },
    {
      test: /FROM draw_record_item\s+WHERE record_id = \?/i,
      handle: (params) =>
        select(
          db.state.items
            .filter((item) => item.record_id === params[0])
            .sort((a, b) => a.position_index - b.position_index),
        ),
    },
    {
      test: /FROM draw_record_item\s+WHERE record_id IN \(/i,
      handle: (params) =>
        select(db.state.items.filter((item) => params.includes(item.record_id))),
    },
    {
      test: /SELECT\s+COUNT\(\*\) AS total_records/i,
      handle: (params) => {
        const today = params[0];
        const records = db.state.records;
        return select([
          {
            total_records: records.length,
            total_score: records.reduce((sum, row) => sum + Number(row.total_score || 0), 0),
            total_users: new Set(records.map((row) => row.qq_id)).size,
            today_records: records.filter((row) => String(row.created_at).startsWith(today)).length,
            today_users: new Set(
              records.filter((row) => String(row.created_at).startsWith(today)).map((row) => row.qq_id),
            ).size,
          },
        ]);
      },
    },

    // ---------- user_profile ----------
    {
      test: /INSERT INTO user_profile/i,
      handle: (params) => {
        const [
          qqId,
          nickname,
          drawCount,
          singleCount,
          tenCount,
          score,
          ssrCount,
          urCount,
          ,
          nicknameForUpdate,
          ,
          ,
          ,
          ,
          ,
          ,
        ] = params;
        let row = db.state.profiles.find((item) => item.qq_id === qqId);
        if (!row) {
          row = {
            qq_id: qqId,
            nickname: nickname || '',
            total_draw_count: 0,
            total_single_draw_count: 0,
            total_ten_draw_count: 0,
            total_score: 0,
            total_ssr_count: 0,
            total_ur_count: 0,
            created_at: '2026-01-01 00:00:00',
            updated_at: '2026-01-01 00:00:00',
          };
          db.state.profiles.push(row);
        } else if (nicknameForUpdate) {
          row.nickname = nicknameForUpdate;
        }
        row.total_draw_count += drawCount;
        row.total_single_draw_count += singleCount;
        row.total_ten_draw_count += tenCount;
        row.total_score += score;
        row.total_ssr_count += ssrCount;
        row.total_ur_count += urCount;
        return write(0, 1);
      },
    },
    {
      test: /FROM user_profile WHERE qq_id = \?/i,
      handle: (params) => {
        const row = db.state.profiles.find((item) => item.qq_id === params[0]);
        return select(row ? [{ ...row }] : []);
      },
    },
    {
      test: /SELECT COUNT\(\*\) AS total FROM user_profile/i,
      handle: (params) => {
        const keyword = params && params.length ? String(params[0]).replace(/%/g, '') : '';
        const rows = db.state.profiles.filter(
          (row) => !keyword || row.qq_id.includes(keyword) || (row.nickname || '').includes(keyword),
        );
        return select([{ total: rows.length }]);
      },
    },
    {
      test: /FROM user_profile/i,
      handle: (params) => {
        const keyword = params && params.length ? String(params[0]).replace(/%/g, '') : '';
        const rows = db.state.profiles
          .filter((row) => !keyword || row.qq_id.includes(keyword) || (row.nickname || '').includes(keyword))
          .sort((a, b) => b.total_draw_count - a.total_draw_count);
        const [limit, offset] = parseLimitOffset(db.currentSql);
        return select(paginate(rows, limit, offset));
      },
    },
  ];

  const DEFAULT_LIMIT = 1000;

  function parseLimitOffset(sql) {
    const match = /LIMIT (\d+)(?:\s+OFFSET (\d+))?/i.exec(sql);
    if (!match) {
      return [DEFAULT_LIMIT, 0];
    }
    return [Number(match[1]), Number(match[2] || 0)];
  }

  function paginate(rows, limit, offset) {
    return rows.slice(offset, offset + limit);
  }

  /** 按参数顺序还原 listHistory / listRecordsForAdmin 的 WHERE 语义。 */
  function filterRecords(db, params) {
    const hasQq = /r\.qq_id = \?/i.test(db.currentSql);
    const hasPool = /r\.pool_id = \?/i.test(db.currentSql);
    let qqId = null;
    let poolId = null;
    let index = 0;
    if (hasQq) {
      qqId = params[index];
      index += 1;
    }
    if (hasPool) {
      poolId = params[index];
    }

    return db.state.records
      .filter((row) => (qqId ? row.qq_id === qqId : true))
      .filter((row) => (poolId ? row.pool_id === poolId : true))
      .sort((a, b) => b.id - a.id)
      .map((row) => {
        const pool = db.state.pools.find((item) => item.id === row.pool_id);
        return { ...row, pool_name: pool ? pool.pool_name : null };
      });
  }

  const conn = {
    heldLocks: [],
    async execute(sql, params = []) {
      db.log.push(sql.replace(/\s+/g, ' ').trim().slice(0, 120));
      db.currentSql = sql;
      for (const route of routes) {
        if (route.test.test(sql)) {
          return route.handle(params);
        }
      }
      throw new Error(`fakeDb 未覆盖的 SQL：${sql.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
    },
    async query(sql, params = []) {
      return conn.execute(sql, params);
    },
    async beginTransaction() {
      db.snapshot = clone({ ...db.state, autoIncrement: db.state.autoIncrement });
    },
    async commit() {
      db.commitCount += 1;
      db.snapshot = null;
      conn.releaseLocks();
    },
    async rollback() {
      db.rollbackCount += 1;
      if (db.snapshot) {
        db.state = db.snapshot;
        db.snapshot = null;
      }
      conn.releaseLocks();
    },
    releaseLocks() {
      const pending = conn.heldLocks;
      conn.heldLocks = [];
      pending.forEach((release) => release());
    },
    release() {},
  };

  db.pool = {
    async getConnection() {
      return conn;
    },
    async query(sql, params = []) {
      return conn.execute(sql, params);
    },
    async end() {},
  };

  return db;
}

module.exports = { createFakeDb };
