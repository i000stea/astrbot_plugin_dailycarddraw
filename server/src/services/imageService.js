'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

/**
 * 稀有度颜色（6~1）：橙、黄、紫、蓝、白、灰。
 * 最终效果为「中心颜色最浓，向上下两端透明」。
 */
const RARITY_COLORS = Object.freeze({
  1: '#8A8F98',
  2: '#E5E7EB',
  3: '#3B82F6',
  4: '#A855F7',
  5: '#FACC15',
  6: '#F97316',
});

const BACKGROUND_COLOR = '#2B2B2B';

function safeFileName(value, fallback = 'draw') {
  const text = String(value || '').trim();
  const safe = text.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return safe || fallback;
}

function safeResourceName(value) {
  return path.basename(String(value || '').trim()).replace(/[\\/]/g, '_');
}

function normalizeRarity(value) {
  const rarity = Number.parseInt(value, 10);
  return Number.isFinite(rarity) && rarity >= 1 && rarity <= 6 ? rarity : null;
}

function buildBackgroundSvg(cards, imageConfig) {
  const cardWidth = imageConfig.cardWidth;
  const cardHeight = imageConfig.cardHeight;
  const totalWidth = cardWidth * cards.length;

  const gradients = cards
    .map((card, index) => {
      const rarity = normalizeRarity(card.rarity);
      const color = RARITY_COLORS[rarity] || '#6B7280';
      return [
        `<linearGradient id="rarityGradient${index}" x1="0" y1="0" x2="0" y2="1">`,
        `<stop offset="0%" stop-color="${color}" stop-opacity="0"/>`,
        `<stop offset="50%" stop-color="${color}" stop-opacity="0.82"/>`,
        `<stop offset="100%" stop-color="${color}" stop-opacity="0"/>`,
        '</linearGradient>',
      ].join('');
    })
    .join('');

  const cells = cards
    .map((card, index) => {
      const x = index * cardWidth;
      return [
        `<rect x="${x}" y="0" width="${cardWidth}" height="${cardHeight}" fill="${BACKGROUND_COLOR}"/>`,
        `<rect x="${x}" y="0" width="${cardWidth}" height="${cardHeight}" fill="url(#rarityGradient${index})"/>`,
      ].join('');
    })
    .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${cardHeight}" viewBox="0 0 ${totalWidth} ${cardHeight}">`,
    '<defs>',
    gradients,
    '</defs>',
    cells,
    '</svg>',
  ].join('');
}

async function resizePng(sharp, sourcePath, width, height) {
  try {
    await fsp.access(sourcePath, fs.constants.R_OK);
  } catch (error) {
    return null;
  }

  try {
    return await sharp(sourcePath)
      .resize({
        width,
        height,
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
  } catch (error) {
    console.warn(`[image] 读取素材失败：${sourcePath}，${error.message}`);
    return null;
  }
}

async function cleanupExpiredImages(cacheDir, ttlSeconds) {
  try {
    const entries = await fsp.readdir(cacheDir, { withFileTypes: true });
    const cutoff = Date.now() - ttlSeconds * 1000;
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
        .map(async (entry) => {
          const filePath = path.join(cacheDir, entry.name);
          try {
            const stat = await fsp.stat(filePath);
            if (stat.mtimeMs < cutoff) {
              await fsp.unlink(filePath);
            }
          } catch (error) {
            // 清理失败不影响本次渲染。
          }
        }),
    );
  } catch (error) {
    // 缓存目录不存在时无需处理。
  }
}

function createImageService({ config }) {
  const imageConfig = config.image;
  const resourceDir = config.resourceDir;
  const cacheDir = config.imageCacheDir;
  const ttlSeconds = config.imageCacheTtlSeconds;
  const urlPrefix = `${config.apiPrefix}/images`;

  async function renderDrawImage({ recordNo, cards }) {
    if (!Array.isArray(cards) || cards.length === 0) {
      return null;
    }

    let sharp;
    try {
      // 延迟加载：即使服务器尚未安装 sharp，也不应该让抽卡业务整体失败。
      sharp = require('sharp');
    } catch (error) {
      console.error(`[image] 未安装 sharp，跳过图片生成：${error.message}`);
      return null;
    }

    const fileName = `${safeFileName(recordNo, 'draw')}.png`;
    const outputPath = path.join(cacheDir, fileName);

    await fsp.mkdir(cacheDir, { recursive: true });
    await cleanupExpiredImages(cacheDir, ttlSeconds);

    try {
      const stat = await fsp.stat(outputPath);
      if (Date.now() - stat.mtimeMs <= ttlSeconds * 1000) {
        return { fileName, urlPath: `${urlPrefix}/${fileName}` };
      }
    } catch (error) {
      // 缓存不存在，继续生成。
    }

    const cardWidth = imageConfig.cardWidth;
    const cardHeight = imageConfig.cardHeight;
    const padding = imageConfig.padding;
    const avatarSize = imageConfig.avatarSize;
    const professionSize = imageConfig.professionSize;
    const raritySize = imageConfig.raritySize;
    const layers = [];

    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index] || {};
      const offsetX = index * cardWidth;

      const cardKey = safeResourceName(card.card_key);
      if (cardKey) {
        const avatarPath = path.join(resourceDir, 'avatar', `${cardKey}.png`);
        const avatarBuffer = await resizePng(sharp, avatarPath, avatarSize, avatarSize);
        if (avatarBuffer) {
          layers.push({
            input: avatarBuffer,
            left: offsetX + Math.round((cardWidth - avatarSize) / 2),
            top: Math.round((cardHeight - avatarSize) / 2),
          });
        }
      }

      const profession = safeResourceName(card.profession);
      if (profession) {
        const professionPath = path.join(resourceDir, 'profession', `${profession}.png`);
        const professionBuffer = await resizePng(
          sharp,
          professionPath,
          professionSize,
          professionSize,
        );
        if (professionBuffer) {
          layers.push({
            input: professionBuffer,
            left: offsetX + padding,
            top: padding,
          });
        }
      }

      const rarity = normalizeRarity(card.rarity);
      if (rarity) {
        const rarityPath = path.join(resourceDir, 'rarity', `rarity${rarity}.png`);
        const rarityBuffer = await resizePng(sharp, rarityPath, raritySize, raritySize);
        if (rarityBuffer) {
          layers.push({
            input: rarityBuffer,
            left: offsetX + cardWidth - raritySize - padding,
            top: cardHeight - raritySize - padding,
          });
        }
      }
    }

    const backgroundColor = buildBackgroundSvg(cards, imageConfig);

    try {
      let pipeline = sharp(Buffer.from(backgroundColor)).png();
      if (layers.length > 0) {
        pipeline = pipeline.composite(layers);
      }
      await pipeline.toFile(outputPath);
    } catch (error) {
      console.error(`[image] 生成抽卡图片失败：${error.message}`);
      return null;
    }

    return { fileName, urlPath: `${urlPrefix}/${fileName}` };
  }

  function getImagePath(fileName) {
    const safeName = path.basename(String(fileName || ''));
    if (!/^[a-zA-Z0-9_.-]+\.png$/.test(safeName)) {
      return null;
    }
    const filePath = path.join(cacheDir, safeName);
    const relative = path.relative(cacheDir, filePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return null;
    }
    return filePath;
  }

  return {
    renderDrawImage,
    getImagePath,
  };
}

module.exports = { createImageService };
