'use strict';

const { createDrawService } = require('./services/drawService');
const { createQueryService } = require('./services/queryService');
const { createPoolService } = require('./services/poolService');
const { createAdminService } = require('./services/adminService');

const poolRepository = require('./repositories/poolRepository');
const quotaRepository = require('./repositories/quotaRepository');
const drawRecordRepository = require('./repositories/drawRecordRepository');
const userRepository = require('./repositories/userRepository');
const cardRepository = require('./repositories/cardRepository');

/**
 * 组装仓储与服务。
 * 单独抽出来是为了让冒烟测试能注入假的仓储/连接，无需真实 MySQL。
 */
function buildContainer({ pool, config, repositories }) {
  const repos = repositories || {
    poolRepository,
    quotaRepository,
    drawRecordRepository,
    userRepository,
    cardRepository,
  };

  return {
    draw: createDrawService({ pool, config, repositories: repos }),
    query: createQueryService({ pool, config, repositories: repos }),
    pool: createPoolService({ pool, config, repositories: repos }),
    admin: createAdminService({ pool, config, repositories: repos }),
  };
}

module.exports = { buildContainer };
