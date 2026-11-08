import * as mm from 'music-metadata';
import fs from 'fs';
import path from 'path';

// 記憶體快取以提升高頻查詢效能。
// 以檔案路徑為 key、記下 mtime 與大小 —— 原本 key 含 mtime，檔案每改一次就多一筆永遠不會被清掉的舊資料。
// 有上限，超過時淘汰最久沒用到的 (Map 依插入順序，命中時重新插入到尾端)。
const METADATA_CACHE_MAX = 20000;
const metadataCache = new Map(); // filePath -> { mtimeMs, size, result }

function cacheTouch(map, key, value, max) {
  map.delete(key);
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value);
}

/**
 * 讀取 MP3 檔案的 ID3 標籤與音訊屬性
 * @param {string} filePath 檔案路徑
 * @returns {Promise<object>} 音訊 Metadata
 */
export async function getAudioMetadata(filePath) {
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return null;
  }
  try {
    const cached = metadataCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      cacheTouch(metadataCache, filePath, cached, METADATA_CACHE_MAX);
      return cached.result;
    }

    // skipCovers：只是要列曲目資訊，不必把每首歌內嵌的封面圖 (常常幾百 KB) 讀進記憶體；
    // 封面由 extractCoverArt 另外按需讀取
    const metadata = await mm.parseFile(filePath, { duration: true, skipCovers: true });
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
      size: stat.size
    };

    cacheTouch(metadataCache, filePath, { mtimeMs: stat.mtimeMs, size: stat.size, result }, METADATA_CACHE_MAX);
    return result;
  } catch (err) {
    return {
      filename: path.basename(filePath),
      title: path.basename(filePath, path.extname(filePath)),
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      duration: 0,
      error: err.message
    };
  }
}

/**
 * 提取音訊檔案的內嵌封面圖片
 * @param {string} filePath 檔案路徑
 * @returns {Promise<{buffer: Buffer, mimeType: string}|null>}
 */
// 最近用過的封面 (含「沒有封面」)。換歌時每位聽眾幾乎同時來要同一張圖，
// 不快取的話每個請求都要把整個 mp3 的標籤重新解析一次。
const COVER_CACHE_MAX = 32;
const coverCache = new Map(); // filePath -> { mtimeMs, size, cover }
const coverInflight = new Map(); // filePath -> Promise

export async function extractCoverArt(filePath) {
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return null;
  }
  const cached = coverCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    cacheTouch(coverCache, filePath, cached, COVER_CACHE_MAX);
    return cached.cover;
  }
  // 同一首歌的並行請求共用同一次解析
  if (coverInflight.has(filePath)) return coverInflight.get(filePath);

  const job = (async () => {
    let cover = null;
    try {
      const metadata = await mm.parseFile(filePath, { duration: false });
      const pic = metadata.common.picture?.[0];
      if (pic) {
        cover = { buffer: Buffer.from(pic.data), mimeType: pic.format || 'image/jpeg' };
      }
    } catch {
      cover = null;
    }
    cacheTouch(coverCache, filePath, { mtimeMs: stat.mtimeMs, size: stat.size, cover }, COVER_CACHE_MAX);
    return cover;
  })();
  coverInflight.set(filePath, job);
  try {
    return await job;
  } finally {
    coverInflight.delete(filePath);
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
