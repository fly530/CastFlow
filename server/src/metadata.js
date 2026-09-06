import * as mm from 'music-metadata';
import fs from 'fs';
import path from 'path';

// 記憶體快取以提升高頻查詢效能
const metadataCache = new Map();

/**
 * 讀取 MP3 檔案的 ID3 標籤與音訊屬性
 * @param {string} filePath 檔案路徑
 * @returns {Promise<object>} 音訊 Metadata
 */
export async function getAudioMetadata(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const stat = fs.statSync(filePath);
    const cacheKey = `${filePath}:${stat.mtimeMs}`;
    if (metadataCache.has(cacheKey)) {
      return metadataCache.get(cacheKey);
    }

    const metadata = await mm.parseFile(filePath, { duration: true, skipCovers: false });
    const { common, format } = metadata;

    const result = {
      filename: path.basename(filePath),
      title: common.title || path.basename(filePath, path.extname(filePath)),
      artist: common.artist || 'Unknown Artist',
      album: common.album || 'Unknown Album',
      year: common.year || null,
      genre: common.genre ? common.genre.join(', ') : null,
      duration: format.duration ? Math.round(format.duration) : 0,
      bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : null,
      sampleRate: format.sampleRate || null,
      size: stat.size,
      hasPicture: !!(common.picture && common.picture.length > 0)
    };

    metadataCache.set(cacheKey, result);
    return result;
  } catch (err) {
    return {
      filename: path.basename(filePath),
      title: path.basename(filePath, path.extname(filePath)),
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      duration: 0,
      hasPicture: false,
      error: err.message
    };
  }
}

/**
 * 提取音訊檔案的內嵌封面圖片
 * @param {string} filePath 檔案路徑
 * @returns {Promise<{buffer: Buffer, mimeType: string}|null>}
 */
export async function extractCoverArt(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const metadata = await mm.parseFile(filePath, { duration: false });
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const pic = metadata.common.picture[0];
      return {
        buffer: pic.data,
        mimeType: pic.format || 'image/jpeg'
      };
    }
    return null;
  } catch {
    return null;
  }
}

const titleToPathMap = new Map();

/**
 * 依據歌曲標題於音訊庫中搜尋對應之 MP3 檔案實體路徑
 */
export async function findTrackPathByTitle(targetTitle) {
  if (!targetTitle) return null;
  const cleanTarget = targetTitle.replace(/[《》\[\]()（）\-_]/g, ' ').trim().toLowerCase();
  if (!cleanTarget) return null;

  if (titleToPathMap.has(cleanTarget)) {
    const cached = titleToPathMap.get(cleanTarget);
    if (fs.existsSync(cached)) return cached;
  }

  const musicBase = process.env.MUSIC_DIR || path.resolve(process.cwd(), '../music');
  if (!fs.existsSync(musicBase)) return null;

  try {
    const dirs = fs.readdirSync(musicBase);
    for (const d of dirs) {
      const fullDir = path.join(musicBase, d);
      if (!fs.statSync(fullDir).isDirectory()) continue;
      const files = fs.readdirSync(fullDir);
      for (const f of files) {
        if (!f.toLowerCase().endsWith('.mp3')) continue;
        const fullPath = path.join(fullDir, f);

        // 1. 檔名字串比對
        const cleanFile = f.replace(/[《》\[\]()（）\-_]/g, ' ').toLowerCase();
        if (cleanFile.includes(cleanTarget) || cleanTarget.includes(cleanFile.replace('.mp3', '').trim())) {
          titleToPathMap.set(cleanTarget, fullPath);
          return fullPath;
        }

        // 2. ID3 標籤 Title 比對
        const meta = await getAudioMetadata(fullPath).catch(() => null);
        if (meta && meta.title) {
          const metaTitle = meta.title.replace(/[《》\[\]()（）\-_]/g, ' ').trim().toLowerCase();
          titleToPathMap.set(metaTitle, fullPath);
          if (metaTitle.includes(cleanTarget) || cleanTarget.includes(metaTitle)) {
            titleToPathMap.set(cleanTarget, fullPath);
            return fullPath;
          }
        }
      }
    }
  } catch {}

  return null;
}
