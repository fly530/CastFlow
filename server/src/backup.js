import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getAllPlaylists, getAllSchedules, restorePlaylistsAndSchedules } from './db.js';
import { getMusicBaseDir } from './playlists.js';

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
export function createBackup() {
  const backupDir = getBackupDir();
  const playlists = getAllPlaylists();
  const schedules = getAllSchedules();

  // 取得各歌單目前在磁碟上的曲目快照
  let totalTracks = 0;
  const baseDir = getMusicBaseDir();
  const enrichedPlaylists = playlists.map((pl) => {
    const plDir = path.join(baseDir, pl.folder);
    let tracks = [];
    if (fs.existsSync(plDir)) {
      try {
        tracks = fs
          .readdirSync(plDir)
          .filter((f) => f.toLowerCase().endsWith('.mp3') && !f.startsWith('.'));
      } catch {}
    }
    totalTracks += tracks.length;
    return {
      ...pl,
      trackCount: tracks.length,
      tracks
    };
  });

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `castflow_backup_${timestamp}.json`;
  const filePath = path.join(backupDir, filename);

  const backupData = {
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

  // 寫入 UTF-8 JSON 檔案
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

  // 1. 先產生包含曲目快照的 JSON 配置檔
  const jsonBackup = createBackup();

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const zipFilename = `castflow_full_backup_${timestamp}.zip`;
  const zipFilePath = path.join(backupDir, zipFilename);

  // 2. 將所有的歌單音訊資料夾打包進 ZIP，排除 backups、logs、sqlite db
  try {
    execSync(
      `cd "${baseDir}" && /usr/bin/zip -r -q "${zipFilePath}" . -x "backups/*" "logs/*" "*.db*" ".*"`,
      { stdio: 'ignore' }
    );
  } catch (err) {
    throw new Error(`打包 ZIP 失敗: ${err.message}`);
  }

  const stat = fs.statSync(zipFilePath);

  return {
    filename: zipFilename,
    path: zipFilePath,
    size: stat.size,
    isZip: true,
    createdAt: now.toISOString(),
    stats: jsonBackup.stats
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

  // 1. 還原至 SQLite 資料庫
  restorePlaylistsAndSchedules(backupData.playlists, backupData.schedules);

  // 2. 確保還原後的每個歌單實體資料夾存在
  const baseDir = getMusicBaseDir();
  for (const pl of backupData.playlists) {
    const folderName = pl.folder || pl.id;
    const dir = path.join(baseDir, folderName);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        console.warn(`[Backup] 無法自動建立歌單資料夾 ${folderName}:`, err.message);
      }
    }
  }

  return {
    success: true,
    playlistsRestored: backupData.playlists.length,
    schedulesRestored: backupData.schedules.length
  };
}

/**
 * 從 backups 目錄下的指定備份檔進行還原 (支援 .json 與 .zip)
 */
export function restoreBackupFile(filename) {
  const filePath = getBackupPath(filename);
  if (!filePath) {
    throw new Error('找不到指定的備份檔案');
  }

  const baseDir = getMusicBaseDir();

  // 若為 .zip 完整備份包，先自動解開檔案覆蓋回 /music
  if (filename.toLowerCase().endsWith('.zip')) {
    try {
      execSync(`/usr/bin/unzip -o -q "${filePath}" -d "${baseDir}"`, { stdio: 'ignore' });
    } catch (err) {
      throw new Error(`解壓縮備份包失敗: ${err.message}`);
    }
    // 解開後搜尋最近的 backup json 進行資料庫還原
    const backupsInFolder = listBackups().filter((b) => !b.isZip);
    if (backupsInFolder.length > 0) {
      return restoreBackupFile(backupsInFolder[0].filename);
    }
    return { success: true, message: '已成功解開全站歌曲音訊！' };
  }

  // 若為 .json 設定檔
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  return restoreBackupData(data);
}
