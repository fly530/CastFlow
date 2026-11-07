import fs from 'fs';
import path from 'path';
import multer from 'multer';
// ★ execFileSync 而非 execSync：參數以陣列傳遞，不經過 shell。
// 上傳檔名的清洗規則不會過濾 $ ` ( ) ; &，而 execSync 的字串在雙引號內
// 仍會被 shell 展開 —— 一個叫 "$(...).zip" 的上傳檔就是容器內的任意指令執行。
import { execFileSync } from 'child_process';
import { getAudioMetadata } from './metadata.js';

export const PLAYLIST_DEFS = {
  A: { name: 'Playlist A', role: '日常主力歌單 (75% 權重輪播)' },
  B: { name: 'Playlist B', role: '日常插播歌單 (25% 權重插播)' },
  C: { name: 'Playlist C', role: '整點專屬單曲插播' },
  D: { name: 'Playlist D', role: '21:30 定時插播單曲' },
  E: { name: 'Playlist E', role: '21:40 定時插播單曲' },
  F: { name: 'Playlist F', role: '21:50 定時插播單曲' },
  G: { name: 'Playlist G', role: '夜間輪播 (22:00~23:00 與 A 1:1 輪替)' }
};

import { getAllPlaylists, getPlaylistById } from './db.js';

export function getMusicBaseDir() {
  return process.env.MUSIC_DIR || path.resolve(process.cwd(), '../music');
}

/**
 * 取得歌單所在資料夾路徑 (支援 SQLite 動態歌單)
 */
/**
 * 資料夾名稱正規化。
 *
 * ★ 這是所有檔案操作的收口點，穿越必須擋在這裡而不是各個呼叫端。
 *
 * 資料庫裡的 `folder` 欄位是使用者可設的（POST /api/playlists 的 body），
 * 原本只做 .trim() 就直接送進 path.join()。搭配下方的 mkdirSync
 * ({ recursive: true })，`folder: "../../../../app/src"` 這種值可以在容器內
 * 任意位置建目錄並寫入檔案，deleteTrack 也會跟著能刪任意路徑的檔案。
 *
 * 在建立端（api.js）也做了同樣的清洗，但那只保護「之後」寫入的資料；
 * 這裡再擋一次，既有的髒資料列也一併失效。兩層都要有。
 */
function isSafeFolderName(name) {
  return typeof name === 'string' && name.length > 0 && /^[a-zA-Z0-9_-]+$/.test(name);
}

/**
 * 決定歌單實際使用的資料夾名。
 *
 * 不安全的值不做「就地取代成底線」—— 那會讓「爵士」與「藍調」雙雙變成 `__`
 * 而共用同一個資料夾，兩個歌單的曲目混在一起。改為退回歌單 id：
 * 它是主鍵（唯一），而且在 api.js 建立時就已清洗成 [a-z0-9_-]。
 */
function resolveFolderName(folder, playlistId) {
  if (isSafeFolderName(folder)) return folder;
  if (isSafeFolderName(playlistId)) return playlistId;
  return String(playlistId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
}

/**
 * 寫入端 (建立歌單、還原備份) 用的資料夾名正規化：不安全字元換成底線，
 * 換完若只剩底線 (例如全中文) 就退回歌單 id，避免不同歌單共用 `__` 資料夾。
 */
export function normalizeFolderName(rawFolder, fallbackId) {
  const cleaned = String(rawFolder ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  if (/[a-zA-Z0-9]/.test(cleaned)) return cleaned;
  return resolveFolderName(fallbackId, fallbackId);
}

/**
 * 歌單資料夾的實際路徑 (不建立目錄)。可傳歌單 id 或資料庫列。
 *
 * ★ 排程器、狀態 API、備份、手動插播都必須經過這裡 —— 曾經各自用 `pl.folder`
 *   直接組路徑，遇到不安全的 folder 時，上傳寫進 id 資料夾、播放卻讀另一個路徑。
 */
export function resolvePlaylistDir(playlistOrId) {
  const isRow = playlistOrId !== null && typeof playlistOrId === 'object';
  const pl = isRow ? playlistOrId : getPlaylistById(playlistOrId);
  const id = isRow ? playlistOrId.id : playlistOrId;
  return path.join(getMusicBaseDir(), resolveFolderName(pl ? pl.folder : id, id));
}

/** 同 resolvePlaylistDir，但目錄不存在時會建立 (上傳、移動等寫入操作用) */
export function getPlaylistDir(playlistId) {
  const dir = resolvePlaylistDir(playlistId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** 歌單資料夾內的 mp3 檔名清單 (資料夾不存在時回傳空陣列，不會建立) */
export function listMp3Files(playlistOrId) {
  const dir = resolvePlaylistDir(playlistOrId);
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mp3') && !f.startsWith('.'));
  } catch {
    return [];
  }
}

/**
 * 取得所有歌單摘要 (從 SQLite 讀取動態清單)
 */
export async function listPlaylists() {
  const dbPlaylists = getAllPlaylists();
  const result = [];

  for (const pl of dbPlaylists) {
    const trackCount = listMp3Files(pl).length;
    result.push({
      id: pl.id,
      name: pl.name,
      folder: pl.folder,
      description: pl.description || '',
      color: pl.color || '#8b5cf6',
      play_mode: pl.play_mode || 'shuffle',
      transition: pl.transition || 'smart',
      is_active: pl.is_active,
      count: trackCount,
      trackCount
    });
  }

  return result;
}

/**
 * 取得指定歌單內所有曲目之詳細 Metadata
 */
export async function getPlaylistTracks(playlistId) {
  const dir = getPlaylistDir(playlistId);
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mp3'));

  const tracks = await Promise.all(
    files.map(async (filename) => {
      const filePath = path.join(dir, filename);
      return await getAudioMetadata(filePath);
    })
  );

  return tracks;
}

/**
 * 這個曲目是否允許被刪除／移動。
 *
 * path.basename() 擋住了「跳出目錄」，但沒有限制「刪什麼」—— 沒有這道檢查時，
 * 曲庫目錄裡的任何檔案都能被刪除（radio.db、.htaccess、備份⋯⋯）。
 * 檔案管理 API 的職責只有 mp3，就只放行 mp3。
 */
function isDeletableTrack(safeFilename) {
  return path.extname(safeFilename).toLowerCase() === '.mp3';
}

/**
 * 刪除指定歌單中的曲目
 */
export async function deleteTrack(playlistId, filename) {
  const dir = getPlaylistDir(playlistId);
  const safeFilename = path.basename(filename);
  if (!isDeletableTrack(safeFilename)) {
    return false;
  }
  const filePath = path.join(dir, safeFilename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * 批次刪除指定歌單中的曲目
 */
export async function deleteTracks(playlistId, filenames) {
  const dir = getPlaylistDir(playlistId);
  const deleted = [];
  const errors = [];

  for (const filename of filenames) {
    const safeFilename = path.basename(filename);
    if (!isDeletableTrack(safeFilename)) {
      errors.push({ filename: safeFilename, error: '只能刪除 .mp3 檔案' });
      continue;
    }
    const filePath = path.join(dir, safeFilename);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deleted.push(safeFilename);
      }
    } catch (err) {
      errors.push({ filename: safeFilename, error: err.message });
    }
  }

  return { deleted, errors };
}

/**
 * 批次移動曲目至目標歌單
 */
export async function moveTracks(sourcePlaylistId, targetPlaylistId, filenames) {
  const srcDir = getPlaylistDir(sourcePlaylistId);
  const destDir = getPlaylistDir(targetPlaylistId);
  const moved = [];
  const errors = [];

  for (const filename of filenames) {
    const safeFilename = path.basename(filename);
    if (!isDeletableTrack(safeFilename)) {
      errors.push({ filename: safeFilename, error: '只能移動 .mp3 檔案' });
      continue;
    }
    const srcPath = path.join(srcDir, safeFilename);

    try {
      if (fs.existsSync(srcPath)) {
        let destPath = path.join(destDir, safeFilename);
        if (fs.existsSync(destPath)) {
          const ext = path.extname(safeFilename);
          const base = path.basename(safeFilename, ext);
          destPath = path.join(destDir, `${base}_${Date.now()}${ext}`);
        }
        fs.renameSync(srcPath, destPath);
        moved.push(safeFilename);
      }
    } catch (err) {
      errors.push({ filename: safeFilename, error: err.message });
    }
  }

  return { moved, errors };
}

/**
 * 曲目檔名清洗 (上傳、改名共用)：只過濾路徑跳脫與檔案系統不允許的字元，
 * 保留中文等原始檔名。副檔名不在 allowedExts 內時補上 .mp3。
 */
export function sanitizeTrackFilename(rawName, { allowedExts = ['.mp3'] } = {}) {
  let cleanName = path
    .basename(String(rawName ?? ''))
    .replace(/[\/\\?%*:|"<>\x00-\x1f]/g, '_')
    .trim();
  if (!cleanName || cleanName === '.' || cleanName === '..' || cleanName.startsWith('.')) {
    cleanName = `track_${Date.now()}${cleanName.startsWith('.') ? cleanName : ''}`;
  }
  if (!allowedExts.includes(path.extname(cleanName).toLowerCase())) {
    cleanName += '.mp3';
  }
  return cleanName;
}

/** 目標資料夾已有同名檔案時加上序號 _1, _2 …，避免互相覆蓋 */
export function uniqueFilename(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let finalName = name;
  let counter = 1;
  while (fs.existsSync(path.join(dir, finalName))) {
    finalName = `${base}_${counter}${ext}`;
    counter++;
  }
  return finalName;
}

/**
 * 解開上傳的 ZIP：只取 mp3 (不分大小寫)、攤平目錄，檔名衝突時加序號而不是覆蓋。
 * 回傳實際加入歌單的檔名。
 *
 * 先解到暫存子目錄再逐一搬入 —— 直接 `unzip -o` 到歌單資料夾會無聲覆蓋同名曲目。
 * `-C` 讓 *.mp3 不分大小寫；舊寫法 "*.mp3" "*.MP3" 只要其中一個樣式沒對到，
 * unzip 就以 exit 11 結束，上傳流程把它當成失敗。
 */
export function extractMp3sFromZip(zipFilePath, destDir) {
  const tmpDir = fs.mkdtempSync(path.join(destDir, '.unzip-'));
  try {
    try {
      execFileSync('/usr/bin/unzip', ['-j', '-o', '-q', '-C', zipFilePath, '*.mp3', '-d', tmpDir], {
        stdio: 'ignore'
      });
    } catch (err) {
      // exit 11 = 壓縮包內沒有任何 mp3；其他代碼才是真的解壓失敗
      if (err.status !== 11) throw new Error(`解壓縮失敗 (unzip exit ${err.status ?? '?'})`);
    }
    const added = [];
    for (const f of fs.readdirSync(tmpDir)) {
      if (path.extname(f).toLowerCase() !== '.mp3') continue;
      const finalName = uniqueFilename(destDir, sanitizeTrackFilename(f));
      fs.renameSync(path.join(tmpDir, f), path.join(destDir, finalName));
      added.push(finalName);
    }
    return added;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Multer 上傳中介軟體設定
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const playlistId = req.params.id;
      const dir = getPlaylistDir(playlistId);
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    // Multer 預設以 latin1 解析 multipart 標頭，UTF-8 中文檔名要轉回來
    let rawName = file.originalname;
    try {
      const recovered = Buffer.from(file.originalname, 'latin1').toString('utf8');
      if (recovered && !recovered.includes('\ufffd')) {
        rawName = recovered;
      }
    } catch {}

    let cleanName = sanitizeTrackFilename(rawName, { allowedExts: ['.mp3', '.zip'] });
    try {
      cb(null, uniqueFilename(getPlaylistDir(req.params.id), cleanName));
    } catch {
      cb(null, cleanName);
    }
  }
});

export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 單檔最大 200MB (支援大型 ZIP 壓縮包)
  // 只收 .mp3 與 .zip (以副檔名判斷；瀏覽器給的 MIME 不可靠)。
  // 其他檔案略過而不是丟錯 —— 丟錯會讓同一批的其他曲目一起失敗
  // (例如選資料夾上傳時夾帶的 cover.jpg)。略過的檔名放在 req.skippedFiles 回報給前端。
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.mp3' || ext === '.zip') {
      cb(null, true);
    } else {
      (req.skippedFiles ||= []).push(file.originalname);
      cb(null, false);
    }
  }
});
