'use strict';

const express = require('express');

const { ok, unauthorized } = require('../http/responses');

/**
 * 管理接口的 Token 校验：与插件侧 api_token 对应（Authorization: Bearer <token>）。
 * 未配置 ADMIN_API_TOKEN 时直接放行，和之前的 Python 后端行为保持一致。
 */
function createAdminTokenMiddleware(config) {
  return function requireAdminToken(req, res, next) {
    if (!config.adminApiToken) {
      next();
      return;
    }
    const header = String(req.headers.authorization || '').trim();
    if (header !== `Bearer ${config.adminApiToken}`) {
      next(unauthorized('管理接口鉴权失败：Authorization 头缺失或不正确。'));
      return;
    }
    next();
  };
}

/**
 * 插件侧管理接口，路径同样对齐插件契约：
 *   GET  /admin/pools
 *   POST /admin/reset-quota
 *   GET  /admin/user-records
 */
function createPluginAdminRoutes({ config, services }) {
  const router = express.Router();
  router.use(createAdminTokenMiddleware(config));

  router.get('/admin/pools', async (req, res, next) => {
    try {
      res.json(ok(await services.pool.listPools(), '查询成功'));
    } catch (error) {
      next(error);
    }
  });

  router.post('/admin/reset-quota', async (req, res, next) => {
    try {
      const body = req.body || {};
      const data = await services.admin.resetQuota({
        qqId: body.qq_id,
        poolId: body.pool_id,
      });
      res.json(ok(data, '重置成功'));
    } catch (error) {
      next(error);
    }
  });

  router.get('/admin/user-records', async (req, res, next) => {
    try {
      const data = await services.admin.listUserRecords({
        qqId: req.query.qq_id,
        page: req.query.page ?? 1,
        pageSize: req.query.page_size ?? 20,
      });
      res.json(ok(data, '查询成功'));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createPluginAdminRoutes, createAdminTokenMiddleware };
