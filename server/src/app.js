'use strict';

const path = require('path');

const express = require('express');

const { createPluginRoutes } = require('./routes/pluginRoutes');
const { createPluginAdminRoutes } = require('./routes/pluginAdminRoutes');
const { createManageRoutes } = require('./routes/manageRoutes');
const { ApiError } = require('./http/responses');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp({ config, services, enableRequestLog = true }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  if (enableRequestLog) {
    app.use((req, res, next) => {
      const startedAt = Date.now();
      res.on('finish', () => {
        const line = `${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`;
        if (res.statusCode >= 500) {
          console.error(`[http] ${line}`);
        } else {
          console.log(`[http] ${line}`);
        }
      });
      next();
    });
  }

  app.get('/health', (req, res) => {
    res.json({ success: true, message: '服务正常', data: { status: 'ok' } });
  });

  app.use(config.apiPrefix, createPluginRoutes({ services }));
  app.use(config.apiPrefix, createPluginAdminRoutes({ config, services }));
  app.use('/manage/api', createManageRoutes({ config, services }));

  // 静态前端：/ -> 查询页，/admin -> 管理后台（由 extensions 自动补 .html）
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], index: 'index.html' }));

  app.use((req, res) => {
    res.status(404).json({ success: false, message: `接口不存在：${req.method} ${req.originalUrl}`, data: null });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({ success: false, message: error.message, data: null });
      return;
    }
    if (error && error.type === 'entity.parse.failed') {
      res.status(400).json({ success: false, message: '请求体不是合法 JSON。', data: null });
      return;
    }
    console.error('[http] unhandled error:', error);
    res.status(500).json({
      success: false,
      message: `服务器内部错误：${error && error.message ? error.message : '未知错误'}`,
      data: null,
    });
  });

  return app;
}

module.exports = { createApp, PUBLIC_DIR };
