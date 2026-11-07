import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { getAllPlaylists, getAllSchedules, restorePlaylistsAndSchedules } from './db.js';
import { getMusicBaseDir, resolvePlaylistDir, listMp3Files, normalizeFolderName } from './playlists.js';

// 完整備份 ZIP 內附的設定檔名 (位於壓縮包根目錄)；還原時以它為準
const EMBEDDED_CONFIG_NAME = 'castflow-backup.json';

/**
 * 取得備份檔案儲存目錄 (/music/backups)
 */
export function getBackupDir() {
  const dir = process.env.BACKUP_DIR || path.resolve(process.cwd(), '../backups');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 建立設定備份檔 (.json) 並寫入 backups 目錄
 */
function timestampOf(now) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** 組出備份內容 (歌單、排程、各歌單目前在磁碟上的曲目快照) */
function buildBackupData(now = new Date()) {
  const playlists = getAllPlaylists();
  const schedules = getAllSchedules();

  let totalTracks = 0;
  const enrichedPlaylists = playlists.map((pl) => {
    const tracks = listMp3Files(pl);
    totalTracks += tracks.length;
    return { ...pl, trackCount: tracks.length, tracks };
  });

  return {
    version: '1.0',
    appName: 'CastFlow',
    createdAt: now.toISOString(),
    description: 'CastFlow 歌單配置與智慧排程完整備份',
    stats: {
      playlistsCount: playlists.length,
      schedulesCount: schedules.length,
      totalTracks
    },
    playlists: enrichedPlaylists,
    schedules
  };
}

/**
 * 建立設定備份檔 (.json) 並寫入 backups 目錄
 */
export function createBackup() {
  const backupDir = getBackupDir();
  const now = new Date();
  const backupData = buildBackupData(now);
  const filename = `castflow_backup_${timestampOf(now)}.json`;
  const filePath = path.join(backupDir, filename);

  fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf-8');
  const stat = fs.statSync(filePath);

  return {
    filename,
    path: filePath,
    size: stat.size,
    isZip: false,
    createdAt: now.toISOString(),
    stats: backupData.stats,
    data: backupData
  };
}

/**
 * 建立全站完整備份檔 (.zip，含所有歌單設定與 MP3 音訊檔案)
 */
export function createFullZipBackup() {
  const backupDir = getBackupDir();
  const baseDir = getMusicBaseDir();
  const now = new Date();
  const backupData = buildBackupData(now);
  const zipFilename = `castflow_full_backup_${timestampOf(now)}.zip`;
  const zipFilePath = path.join(backupDir, zipFilename);

  // 設定檔放進 ZIP 根目錄：還原時才能確定用的是「同一次」備份的設定，
  // 而不是 backups 資料夾裡剛好最新的那份 JSON (下載到別台機器時根本不存在)。
  const tmpDir = fs.mkdtempSync(path.join(backupDir, '.zip-'));
  const configPath = path.join(tmpDir, EMBEDDED_CONFIG_NAME);
  try {
    fs.writeFileSync(configPath, JSON.stringify(backupData, null, 2), 'utf-8');
    // cwd 選項取代 `cd "..." &&`，不需要 shell；-x 的樣式由 zip 自己解讀。
    execFileSync(
      '/usr/bin/zip',
      ['-r', '-q', zipFilePath, '.', '-x', 'backups/*', 'logs/*', '*.db*', '.*'],
      { cwd: baseDir, stdio: 'ignore' }
    );
    execFileSync('/usr/bin/zip', ['-j', '-q', zipFilePath, configPath], { stdio: 'ignore' });
  } catch (err) {
    fs.rmSync(zipFilePath, { force: true });
    throw new Error(`打包 ZIP 失敗: ${err.message}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const stat = fs.statSync(zipFilePath);

  return {
    filename: zipFilename,
    path: zipFilePath,
    size: stat.size,
    isZip: true,
    createdAt: now.toISOString(),
    stats: backupData.stats
  };
}

/**
 * 列出 backups 目錄下所有備份檔案 (.json 與 .zip)
 */
export function listBackups() {
  const backupDir = getBackupDir();
  const files = fs.readdirSync(backupDir).filter((f) => (f.toLowerCase().endsWith('.json') || f.toLowerCase().endsWith('.zip')) && !f.startsWith('.'));
  const backups = [];

  for (const file of files) {
    try {
      const filePath = path.join(backupDir, file);
      const stat = fs.statSync(filePath);
      const isZip = file.toLowerCase().endsWith('.zip');

      let content = null;
      if (!isZip) {
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          content = JSON.parse(raw);
        } catch {}
      }

      backups.push({
        filename: file,
        size: stat.size,
        isZip,
        createdAt: content?.createdAt || stat.mtime.toISOString(),
        version: content?.version || '1.0',
        stats: content?.stats || {
          playlistsCount: content?.playlists?.length || (isZip ? '全曲目' : 0),
          schedulesCount: content?.schedules?.length || 0,
          totalTracks: content?.playlists?.reduce((sum, p) => sum + (p.trackCount || p.tracks?.length || 0), 0) || (isZip ? '含 MP3' : 0)
        }
      });
    } catch (e) {
      console.error(`[Backup] Error reading backup file ${file}:`, e.message);
    }
  }

  // 依照建立時間降序排列 (最新在前)
  backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return backups;
}

/**
 * 安全取得備份檔案完整路徑 (防止目錄穿越)
 */
export function getBackupPath(filename) {
  const safeName = path.basename(filename);
  const filePath = path.join(getBackupDir(), safeName);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return filePath;
}

/**
 * 刪除指定的備份檔案
 */
export function deleteBackup(filename) {
  const safeName = path.basename(filename);
  const filePath = path.join(getBackupDir(), safeName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * 從備份物件資料還原歌單與排程
 */
export function restoreBackupData(backupData) {
  if (!backupData || !Array.isArray(backupData.playlists) || !Array.isArray(backupData.schedules)) {
    throw new Error('備份格式不正確：缺少 playlists 或 schedules 清單陣列');
  }

  // ★ folder 會被拿去組檔案系統路徑，寫進資料庫前要和 POST /api/playlists 套用同一套清洗；
  //   備份檔是使用者上傳的內容，"../../app/src" 這種值不能原樣寫入。
  const playlists = backupData.playlists
    .filter((pl) => pl && typeof pl.id === 'string' && pl.id.trim() && pl.name)
    .map((pl) => ({ ...pl, id: pl.id.trim(), folder: normalizeFolderName(pl.folder || pl.id, pl.id.trim()) }));
  if (playlists.length === 0) {
    throw new Error('備份格式不正確：沒有有效的歌單');
  }
  // 指向不存在歌單的排程寫進去也看不到 (排程查詢是 JOIN)，直接略過
  const ids = new Set(playlists.map((pl) => pl.id));
  const schedules = backupData.schedules.filter((sch) => sch && ids.has(sch.playlist_id));

  // 1. 還原至 SQLite 資料庫
  restorePlaylistsAndSchedules(playlists, schedules);

  // 2. 確保還原後的每個歌單實體資料夾存在
  for (const pl of playlists) {
    const dir = resolvePlaylistDir(pl);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.warn(`[Backup] 無法自動建立歌單資料夾 ${dir}:`, err.message);
    }
  }

  return {
    success: true,
    playlistsRestored: playlists.length,
    schedulesRestored: schedules.length,
    schedulesSkipped: backupData.schedules.length - schedules.length
  };
}

/** 讀出完整備份 ZIP 內附的設定檔；舊版 ZIP 沒有內附時回傳 null */
function readEmbeddedConfig(zipPath) {
  try {
    const raw = execFileSync('/usr/bin/unzip', ['-p', zipPath, EMBEDDED_CONFIG_NAME], {
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return JSON.parse(raw.toString('utf-8'));
  } catch (err) {
    if (err.status === 11) return null; // 壓縮包內沒有這個檔案
    throw new Error(`讀取備份包內的設定檔失敗: ${err.message}`);
  }
}

/**
 * 從 backups 目錄下的指定備份檔進行還原 (支援 .json 與 .zip)
 */
export function restoreBackupFile(filename) {
  const filePath = getBackupPath(filename);
  if (!filePath) {
    throw new Error('找不到指定的備份檔案');
  }

  if (filePath.toLowerCase().endsWith('.zip')) {
    const config = readEmbeddedConfig(filePath);
    try {
      execFileSync('/usr/bin/unzip', ['-o', '-q', filePath, '-x', EMBEDDED_CONFIG_NAME, '-d', getMusicBaseDir()], {
        stdio: 'ignore'
      });
    } catch (err) {
      throw new Error(`解壓縮備份包失敗: ${err.message}`);
    }
    if (config) {
      return { ...restoreBackupData(config), audioRestored: true };
    }
    // 舊版 ZIP 不含設定檔：只還原音訊，不去猜要套用哪一份 JSON
    return {
      success: true,
      audioRestored: true,
      configRestored: false,
      playlistsRestored: 0,
      schedulesRestored: 0,
      message: '已還原全站歌曲音訊；此備份包為舊版格式、不含歌單設定，如需還原設定請另外套用對應的 JSON 備份'
    };
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  return restoreBackupData(JSON.parse(raw));
}
