'use strict';

const express = require('express');

const { ok } = require('../http/responses');

/**
 * 插件侧接口：路径与字段严格对齐 astrbot_plugin_dailycarddraw 的 app/infrastructure/api_client.py，
 * 这样插件只需要把 api_base_url 指过来，不用改一行代码。
 */
function createPluginRoutes({ services }) {
  const router = express.Router();

  router.get('/health', (req, res) => {
    res.json(ok({ status: 'ok', service: 'daily-carddraw-server' }, '服务正常'));
  });

  /** 公开的卡池列表，供前端查询页下拉使用（插件不用这个接口）。 */
  router.get('/pools', async (req, res, next) => {
    try {
      res.json(ok(await services.pool.listPublicPools(), 'ok'));
    } catch (error) {
      next(error);
    }
  });

  router.post('/draw', async (req, res, next) => {
    try {
      const body = req.body || {};
      const data = await services.draw.draw({
        qqId: body.qq_id,
        nickname: body.nickname,
        groupId: body.group_id,
        poolKey: body.pool_key,
        drawMode: body.draw_mode,
      });
      res.json(ok(data, '抽卡成功'));
    } catch (error) {
      next(error);
    }
  });

  router.get('/today', async (req, res, next) => {
    try {
      const data = await services.query.today({
        qqId: req.query.qq_id,
        poolKey: req.query.pool_key,
      });
      res.json(ok(data, '查询成功'));
    } catch (error) {
      next(error);
    }
  });

  router.get('/history', async (req, res, next) => {
    try {
      const data = await services.query.history({
        qqId: req.query.qq_id,
        page: req.query.page,
        pageSize: req.query.page_size,
      });
      res.json(ok(data, '查询成功'));
    } catch (error) {
      next(error);
    }
  });

  router.get('/stats', async (req, res, next) => {
    try {
      const data = await services.query.stats({ qqId: req.query.qq_id });
      res.json(ok(data, '查询成功'));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createPluginRoutes };
