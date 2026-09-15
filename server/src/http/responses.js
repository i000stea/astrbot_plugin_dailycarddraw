'use strict';

/**
 * 业务异常：带 HTTP 状态码，由统一错误中间件转成 {success:false,message} 响应。
 * 插件侧对 success=false 会直接把 message 当作失败原因展示。
 */
class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function badRequest(message) {
  return new ApiError(message, 400);
}

function notFound(message) {
  return new ApiError(message, 404);
}

function unauthorized(message) {
  return new ApiError(message, 401);
}

/** 统一成功响应外壳，与插件期望的 {success,message,data} 对齐。 */
function ok(data, message = 'ok') {
  return { success: true, message, data };
}

module.exports = { ApiError, badRequest, notFound, unauthorized, ok };
