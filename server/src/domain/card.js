'use strict';

/**
 * 获取方式（obtain）工具。
 *
 * 真实数据 gacha_YYYY-MM-DD.json 里 obtain 是用英文逗号分隔的多值字符串，
 * 例如 "公开招募,中坚寻访"；导入时统一转成数组，并以下面的形式存进 card_item.obtain：
 *     ["公开招募","中坚寻访"]
 *
 * 为兼容历史数据，纯字符串（含中文逗号）也能被正确拆分。
 */

function toObtainArray(value) {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  const text = String(value).trim();
  if (!text) {
    return [];
  }
  // 已是 JSON 数组文本（读取历史数据/二次导入时）
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return toObtainArray(parsed);
      }
    } catch (error) {
      // 不是合法 JSON，按普通字符串处理
    }
  }
  return text
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 数据库存储用：统一序列化成 JSON 数组文本。 */
function serializeObtain(value) {
  return JSON.stringify(toObtainArray(value));
}

module.exports = { toObtainArray, serializeObtain };
