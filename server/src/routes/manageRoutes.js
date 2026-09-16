'use strict';

const express = require('express');

const { ok } = require('../http/responses');
const { verifyCredentials, issueToken, requirePanelAuth } = require('../middleware/panelAuth');

/** 把异步处理器的异常统一转交给错误中间件。 */
function wrap(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * 前端管理后台接口，前缀 /manage/api。
 * 登录后返回 JWT，前端存起来放到 Authorization 头里。
 */
function createManageRoutes({ config, services }) {
  const router = express.Router();

  router.post(
    '/login',
    wrap(async (req, res) => {
      const { username, password } = req.body || {};
      if (!verifyCredentials(config, username, password)) {
        res.status(401).json({ success: false, message: '账号或密码不正确。', data: null });
        return;
      }
      res.json(
        ok({ token: issueToken(config, config.panel.username), username: config.panel.username }, '登录成功'),
      );
    }),
  );

  // 以下接口都需要登录。
  router.use(requirePanelAuth(config));

  router.get(
    '/me',
    wrap(async (req, res) => {
      res.json(ok({ username: req.panelUser }, 'ok'));
    }),
  );

  router.get(
    '/overview',
    wrap(async (req, res) => {
      res.json(ok(await services.admin.overview(), 'ok'));
    }),
  );

  router.get(
    '/pools',
    wrap(async (req, res) => {
      res.json(ok(await services.pool.listPoolsForAdmin(), 'ok'));
    }),
  );

  router.post(
    '/pools',
    wrap(async (req, res) => {
      res.json(ok(await services.pool.createPool(req.body || {}), '卡池已创建'));
    }),
  );

  router.put(
    '/pools/:id',
    wrap(async (req, res) => {
      res.json(ok(await services.pool.updatePool(req.params.id, req.body || {}), '卡池已保存'));
    }),
  );

  router.delete(
    '/pools/:id',
    wrap(async (req, res) => {
      res.json(ok(await services.pool.deletePool(req.params.id), '卡池已删除'));
    }),
  );

  router.get(
    '/pools/:id/cards',
    wrap(async (req, res) => {
      res.json(ok(await services.pool.listPoolCards(req.params.id), 'ok'));
    }),
  );

  router.put(
    '/pools/:id/cards',
    wrap(async (req, res) => {
      const items = (req.body || {}).items;
      res.json(ok(await services.pool.replacePoolCards(req.params.id, items, (req.body || {}).rarity_items), '卡池配置已保存'));
    }),
  );

  router.get(
    '/cards',
    wrap(async (req, res) => {
      res.json(ok(await services.pool.listCards({ keyword: req.query.keyword }), 'ok'));
    }),
  );

  router.post(
    '/cards',
    wrap(async (req, res) => {
      res.json(ok(await services.pool.createCard(req.body || {}), '卡牌已创建'));
    }),
  );

  router.put(
    '/cards/:id',
    wrap(async (req, res) => {
      res.json(ok(await services.pool.updateCard(req.params.id, req.body || {}), '卡牌已保存'));
    }),
  );

  router.delete(
    '/cards/:id',
    wrap(async (req, res) => {
      res.json(ok(await services.pool.deleteCard(req.params.id), '卡牌已删除'));
    }),
  );

  router.get(
    /*
    router.post(
      '/cards/import',
      wrap(async (req, res) => {
        res.json(ok(await services.pool.importCards(req.body || {}), '卡牌数据已导入'));
      }),
    );

*/
      '/users',
    wrap(async (req, res) => {
      const data = await services.admin.listProfiles({
        keyword: req.query.keyword,
        page: req.query.page,
        pageSize: req.query.page_size,
      });
      res.json(ok(data, 'ok'));
    }),
  );

  router.get(
    '/users/:qqId/records',
    wrap(async (req, res) => {
      const data = await services.admin.listUserRecords({
        qqId: req.params.qqId,
        page: req.query.page,
        pageSize: req.query.page_size,
      });
      res.json(ok(data, 'ok'));
    }),
  );

  router.post(
    '/users/:qqId/reset-quota',
    wrap(async (req, res) => {
      const data = await services.admin.resetQuota({
        qqId: req.params.qqId,
        poolId: (req.body || {}).pool_id,
      });
      res.json(ok(data, '次数已重置'));
    }),
  );

  router.get(
    '/records',
    wrap(async (req, res) => {
      const data = await services.admin.listRecords({
        qqId: req.query.qq_id,
        poolId: req.query.pool_id,
        page: req.query.page,
        pageSize: req.query.page_size,
      });
      res.json(ok(data, 'ok'));
    }),
  );

  // 上传 JSON 批量录入卡牌（gacha_YYYY-MM-DD.json 格式）。
    router.post(
      '/cards/import',
      wrap(async (req, res) => {
        res.json(ok(await services.pool.importCards(req.body || {}), '卡牌数据已导入'));
      }),
    );

    // 复制卡池（含卡牌权重与稀有度权重）。
    router.post(
      '/pools/:id/copy',
      wrap(async (req, res) => {
        res.json(ok(await services.pool.copyPool(req.params.id, req.body || {}), '卡池已复制'));
      }),
    );

return router;
}

module.exports = { createManageRoutes };
