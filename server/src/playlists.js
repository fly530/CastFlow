import fs from 'fs';
import path from 'path';
import multer from 'multer';
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
export function getPlaylistDir(playlistId) {
  const pl = getPlaylistById(playlistId);
  const folderName = pl ? pl.folder : playlistId.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const dir = path.join(getMusicBaseDir(), folderName);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 取得所有歌單摘要 (從 SQLite 讀取動態清單)
 */
export async function listPlaylists() {
  const baseDir = getMusicBaseDir();
  const dbPlaylists = getAllPlaylists();
  const result = [];

  for (const pl of dbPlaylists) {
    const dir = path.join(baseDir, pl.folder);
    let trackCount = 0;
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mp3'));
      trackCount = files.length;
    }
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
 * 刪除指定歌單中的曲目
 */
export async function deleteTrack(playlistId, filename) {
  const dir = getPlaylistDir(playlistId);
  const safeFilename = path.basename(filename);
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
    // 解決中文檔名被轉為底線並相互覆蓋的重大 Bug
    let rawName = file.originalname;
    try {
      // 處理 multipart 編碼可能造成的 latin1 亂碼 (Multer 預設以 latin1 解析 UTF-8 標頭)
      const recovered = Buffer.from(file.originalname, 'latin1').toString('utf8');
      if (recovered && !recovered.includes('\ufffd')) {
        rawName = recovered;
      }
    } catch {}

    // 僅過濾路徑跳脫與危險字元，保留完整的繁體中文、英文等原始檔名
    let cleanName = path.basename(rawName).replace(/[\/\\?%*:|"<>]/g, '_').trim();
    if (!cleanName) {
      cleanName = `track_${Date.now()}`;
    }

    const ext = path.extname(cleanName).toLowerCase();
    if (ext !== '.mp3' && ext !== '.zip') {
      cleanName += path.extname(file.originalname).toLowerCase() || '.mp3';
    }

    // 衝突防覆蓋：若目標資料夾已有同名檔案，自動加上序號 _1, _2
    try {
      const destDir = getPlaylistDir(req.params.id);
      let finalName = cleanName;
      let counter = 1;
      const baseWithoutExt = path.basename(cleanName, path.extname(cleanName));
      const finalExt = path.extname(cleanName);

      while (fs.existsSync(path.join(destDir, finalName))) {
        finalName = `${baseWithoutExt}_${counter}${finalExt}`;
        counter++;
      }
      cb(null, finalName);
    } catch {
      cb(null, cleanName);
    }
  }
});

export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 單檔最大 200MB (支援大型 ZIP 壓縮包)
  fileFilter: (req, file, cb) => {
    const orig = file.originalname.toLowerCase();
    if (
      file.mimetype.includes('audio') ||
      file.mimetype.includes('zip') ||
      file.mimetype.includes('compressed') ||
      file.mimetype === 'application/octet-stream' ||
      orig.endsWith('.mp3') ||
      orig.endsWith('.zip')
    ) {
      cb(null, true);
    } else {
      cb(new Error('僅支援 MP3 音訊檔案或 ZIP 壓縮包上傳'));
    }
  }
});
