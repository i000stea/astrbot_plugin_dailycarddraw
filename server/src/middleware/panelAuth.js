'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const { unauthorized } = require('../http/responses');

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left), 'utf8');
  const rightBuffer = Buffer.from(String(right), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

/** 校验面板登录口令：优先用 PANEL_PASSWORD_SHA256，其次比对明文 PANEL_PASSWORD。 */
function verifyCredentials(config, username, password) {
  if (!safeEqual(String(username || ''), config.panel.username)) {
    return false;
  }
  if (config.panel.passwordSha256) {
    return safeEqual(sha256(String(password || '')).toLowerCase(), config.panel.passwordSha256);
  }
  if (!config.panel.password) {
    return false;
  }
  return safeEqual(String(password || ''), config.panel.password);
}

function issueToken(config, username) {
  return jwt.sign({ sub: username, scope: 'panel' }, config.panel.jwtSecret, {
    expiresIn: config.panel.jwtExpiresIn,
  });
}

/** 后台接口鉴权：Authorization: Bearer <jwt>。 */
function requirePanelAuth(config) {
  return function panelAuth(req, res, next) {
    const header = String(req.headers.authorization || '').trim();
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      next(unauthorized('未登录或登录已过期。'));
      return;
    }
    try {
      const payload = jwt.verify(token, config.panel.jwtSecret);
      if (payload.scope !== 'panel') {
        next(unauthorized('Token 无效。'));
        return;
      }
      req.panelUser = payload.sub;
      next();
    } catch (error) {
      next(unauthorized('登录状态无效或已过期，请重新登录。'));
    }
  };
}

module.exports = { verifyCredentials, issueToken, requirePanelAuth, sha256 };
