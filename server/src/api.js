import express from 'express';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { liquidsoap } from './telnet.js';
import { getRadioStatus } from './scheduler.js';
import {
  listPlaylists,
  getPlaylistTracks,
  deleteTrack,
  deleteTracks,
  moveTracks,
  uploadMiddleware,
  getPlaylistDir,
  getMusicBaseDir
} from './playlists.js';
import { extractCoverArt, findTrackPathByTitle } from './metadata.js';
import { requireAuth, loginUser, changePassword } from './auth.js';
import {
  getRecentHistory,
  getAllPlaylists,
  getPlaylistById,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  getAllSchedules,
  getScheduleById,
  createSchedule,
  updateSchedule,
  deleteSchedule
} from './db.js';
import { pushTrackToLiquidsoap, getPlaylistTracksFromDisk, skipCurrentTrack } from './scheduler.js';
import { broadcast } from './websocket.js';
import {
  createBackup,
  createFullZipBackup,
  listBackups,
  getBackupPath,
  deleteBackup,
  restoreBackupFile,
  restoreBackupData,
  getBackupDir
} from './backup.js';

export const router = express.Router();

// ==============================================================================
// 1. 認證相關 API (Auth Endpoints)
// ==============================================================================

/**
 * 管理員登入
 */
router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: '請提供帳號與密碼' });
    }
    const result = await loginUser(username, password);
    if (!result.success) {
      return res.status(401).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 檢查目前登入身分
 */
router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

/**
 * 變更管理員密碼 (需登入)
 */
router.post('/auth/change-password', requireAuth, async (req, res) => {
  try {
    const currentPassword = req.body.currentPassword || req.body.oldPassword;
    const newPassword = req.body.newPassword;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: '請提供目前密碼與新密碼' });
    }
    const result = await changePassword(req.user.username, currentPassword, newPassword);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// 2. 廣播狀態與播放歷史 (公開端點 Public)
// ==============================================================================

/**
 * 廣播系統即時狀態
 */
router.get('/status', async (req, res) => {
  try {
    const status = await getRadioStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 最近播放歷史清單 (SQLite 持久化記錄)
 */
router.get('/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '10', 10);
    const history = getRecentHistory(limit);
    res.json({ success: true, data: history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// 播放診斷與日誌記錄 (Playback Health & Diagnostic Logging)
// ==============================================================================
const LOGS_DIR = path.join(getMusicBaseDir(), 'logs');
if (!fs.existsSync(LOGS_DIR)) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  } catch (e) {
    console.error('Failed to create logs dir:', e);
  }
}
const PLAYBACK_LOG_FILE = path.join(LOGS_DIR, 'playback.log');
const inMemoryLogs = [];
const MAX_LOGS = 300;

function appendPlaybackLog(entry) {
  const line = `[${entry.timestamp || new Date().toISOString()}] [${entry.level || 'INFO'}] [${entry.streamType || 'unknown'}] [${entry.event || 'EVENT'}] ${entry.message || ''} ${entry.metrics ? JSON.stringify(entry.metrics) : ''}\n`;
  inMemoryLogs.unshift(entry);
  if (inMemoryLogs.length > MAX_LOGS) inMemoryLogs.pop();

  try {
    fs.appendFileSync(PLAYBACK_LOG_FILE, line, 'utf8');
  } catch (err) {
    console.error('Failed to append to playback.log:', err);
  }
}

/**
 * 接收客戶端播放診斷日誌
 */
router.post('/logs/playback', (req, res) => {
  const {
    level = 'INFO',
    event = 'LOG',
    message = '',
    streamType = 'hls',
    metrics = null,
    timestamp = new Date().toISOString()
  } = req.body || {};
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  const entry = {
    id: Date.now() + Math.random().toString(36).substr(2, 4),
    timestamp,
    level,
    event,
    streamType,
    message,
    metrics,
    clientIp
  };
  appendPlaybackLog(entry);
  res.json({ success: true });
});

/**
 * 查詢最新播放日誌
 */
router.get('/logs/playback', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, MAX_LOGS);
  res.json({
    success: true,
    count: inMemoryLogs.length,
    logFile: PLAYBACK_LOG_FILE,
    data: inMemoryLogs.slice(0, limit)
  });
});

/**
 * 清空播放日誌
 */
router.delete('/logs/playback', (req, res) => {
  inMemoryLogs.length = 0;
  try {
    if (fs.existsSync(PLAYBACK_LOG_FILE)) {
      fs.writeFileSync(PLAYBACK_LOG_FILE, '', 'utf8');
    }
  } catch (e) {
    console.error('Failed to clear playback.log:', e);
  }
  res.json({ success: true, message: '播放診斷日誌已清空' });
});

/**
 * 取得歌單清單 (A ~ G)
 */
router.get('/playlists', async (req, res) => {
  try {
    const playlists = await listPlaylists();
    res.json({ success: true, data: playlists });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 取得指定歌單中的曲目清單
 */
router.get('/playlists/:id/tracks', async (req, res) => {
  try {
    const tracks = await getPlaylistTracks(req.params.id);
    res.json({ success: true, playlist: req.params.id.toUpperCase(), data: tracks });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * 提取指定曲目之專輯封面圖
 */
router.get('/playlists/:id/tracks/:filename/cover', async (req, res) => {
  try {
    const dir = getPlaylistDir(req.params.id);
    const filePath = path.join(dir, path.basename(req.params.filename));
    const cover = await extractCoverArt(filePath);

    if (cover) {
      res.setHeader('Content-Type', cover.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(cover.buffer);
    }
    return sendDefaultCoverSvg(res);
  } catch {
    return sendDefaultCoverSvg(res);
  }
});

/**
 * 提取當前播放曲目之專輯封面圖
 */
router.get('/current/cover', async (req, res) => {
  try {
    const requestedTitle = req.query.title;
    const metadata = await liquidsoap.getMetadata().catch(() => ({}));
    const currentTitle = requestedTitle || metadata.title;

    let filePath = metadata.filename && fs.existsSync(metadata.filename) ? metadata.filename : null;
    if (!filePath && currentTitle) {
      filePath = await findTrackPathByTitle(currentTitle);
    }

    if (filePath && fs.existsSync(filePath)) {
      const cover = await extractCoverArt(filePath);
      if (cover && cover.buffer) {
        res.setHeader('Content-Type', cover.mimeType || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=10');
        return res.send(cover.buffer);
      }
    }
    return sendDefaultCoverSvg(res, currentTitle, metadata.artist);
  } catch {
    return sendDefaultCoverSvg(res);
  }
});

// ==============================================================================
// 3. 遠端控制與管理 (受保護端點，需驗證 JWT)
// ==============================================================================

/**
 * 控制指令：跳至下一首 (平滑淡出轉場，無爆音)
 */
router.post('/control/skip', requireAuth, async (req, res) => {
  try {
    const result = await skipCurrentTrack();
    setTimeout(async () => {
      try {
        const s = await getRadioStatus();
        broadcast({ type: 'RADIO_STATUS', data: s });
      } catch {}
    }, 400);
    res.json({ success: true, message: 'Skipped to next track smoothly', result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 控制指令：強制重新載入所有歌單
 */
router.post('/control/reload', requireAuth, async (req, res) => {
  try {
    const result = await liquidsoap.reloadPlaylists();
    res.json({ success: true, message: 'All playlists reloaded', result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 控制指令：發送自訂 Telnet 指令 (需驗證身分)
 */
router.post('/control/telnet', requireAuth, async (req, res) => {
  try {
    const { command } = req.body;
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ success: false, error: '缺少 command 指令參數' });
    }
    const result = await liquidsoap.sendCommand(command.trim());
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 上傳 MP3 音訊檔案或 ZIP 壓縮包至指定歌單 (需驗證身分)
 */
router.post('/playlists/:id/upload', requireAuth, uploadMiddleware.any(), async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ success: false, error: '未選取任何檔案' });
    }

    const destDir = getPlaylistDir(req.params.id);
    let extractedCount = 0;

    // 若有上傳 ZIP 壓縮包，自動於後端解開所有 MP3 音訊檔案
    for (const f of files) {
      const orig = f.originalname.toLowerCase();
      if (orig.endsWith('.zip') || f.filename.toLowerCase().endsWith('.zip')) {
        const zipFilePath = path.join(destDir, f.filename);
        try {
          // -j: 不要建立子目錄（全部平鋪進當前歌單資料夾）
          // -o: 覆蓋已有同名檔案
          // -q: 靜默執行
          execSync(`/usr/bin/unzip -j -o -q "${zipFilePath}" "*.mp3" "*.MP3" -d "${destDir}"`, { stdio: 'ignore' });
          extractedCount++;
        } catch (unzipErr) {
          console.warn('[Upload] Unzip error:', unzipErr.message);
        } finally {
          try {
            if (fs.existsSync(zipFilePath)) fs.unlinkSync(zipFilePath);
          } catch {}
        }
      }
    }

    // 上傳後通知 Liquidsoap 重新加載
    await liquidsoap.reloadPlaylists().catch(() => {});

    // 即時透過 WebSocket 推播最新曲目總數
    getRadioStatus().then((s) => broadcast({ type: 'RADIO_STATUS', data: s })).catch(() => {});

    const targetPl = getPlaylistById(req.params.id);
    const targetName = targetPl ? targetPl.name : req.params.id;

    res.json({
      success: true,
      message: `成功處理上傳檔案至「${targetName}」${
        extractedCount > 0 ? ` (已自動解開 ${extractedCount} 個 ZIP 壓縮包中的 MP3)` : ''
      }`,
      files: files.map((f) => f.filename)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 編輯指定歌單中的曲目檔名 (需驗證身分)
 */
router.put('/playlists/:id/tracks/:filename', requireAuth, async (req, res) => {
  try {
    const { newFilename } = req.body;
    if (!newFilename || !newFilename.trim()) {
      return res.status(400).json({ success: false, error: '請提供新的檔名' });
    }

    const destDir = getPlaylistDir(req.params.id);
    const oldPath = path.join(destDir, req.params.filename);

    let targetName = newFilename.trim();
    if (!targetName.toLowerCase().endsWith('.mp3')) {
      targetName += '.mp3';
    }
    const safeTargetName = targetName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const newPath = path.join(destDir, safeTargetName);

    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ success: false, error: '原曲目檔案不存在' });
    }
    if (oldPath !== newPath && fs.existsSync(newPath)) {
      return res.status(400).json({ success: false, error: '同名檔案已存在' });
    }

    if (oldPath !== newPath) {
      fs.renameSync(oldPath, newPath);
    }

    await liquidsoap.reloadPlaylists().catch(() => {});
    getRadioStatus().then((s) => broadcast({ type: 'RADIO_STATUS', data: s })).catch(() => {});

    res.json({ success: true, message: '曲目名稱已更新', filename: safeTargetName });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 刪除指定歌單中的曲目 (需驗證身分)
 */
router.delete('/playlists/:id/tracks/:filename', requireAuth, async (req, res) => {
  try {
    const success = await deleteTrack(req.params.id, req.params.filename);
    if (!success) {
      return res.status(404).json({ success: false, error: '檔案不存在' });
    }

    // 刪除後通知 Liquidsoap 重新載入
    await liquidsoap.reloadPlaylists().catch(() => {});

    // 即時透過 WebSocket 推播最新曲目總數
    getRadioStatus().then((s) => broadcast({ type: 'RADIO_STATUS', data: s })).catch(() => {});

    res.json({ success: true, message: `已成功刪除 ${req.params.filename}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 批次刪除曲目 (需驗證身分)
 */
router.post('/playlists/:id/tracks/batch-delete', requireAuth, async (req, res) => {
  try {
    const { filenames } = req.body;
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ success: false, error: '請提供欲刪除之曲目清單' });
    }

    const result = await deleteTracks(req.params.id, filenames);

    await liquidsoap.reloadPlaylists().catch(() => {});
    getRadioStatus().then((s) => broadcast({ type: 'RADIO_STATUS', data: s })).catch(() => {});

    res.json({
      success: true,
      message: `成功刪除 ${result.deleted.length} 首曲目`,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 批次移動曲目至目標歌單 (需驗證身分)
 */
router.post('/playlists/:id/tracks/move', requireAuth, async (req, res) => {
  try {
    const { targetPlaylistId, filenames } = req.body;
    if (!targetPlaylistId) {
      return res.status(400).json({ success: false, error: '未指定目標歌單' });
    }
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ success: false, error: '請提供欲移動之曲目清單' });
    }
    if (targetPlaylistId === req.params.id) {
      return res.status(400).json({ success: false, error: '目標歌單不能與來源歌單相同' });
    }

    const result = await moveTracks(req.params.id, targetPlaylistId, filenames);

    await liquidsoap.reloadPlaylists().catch(() => {});
    getRadioStatus().then((s) => broadcast({ type: 'RADIO_STATUS', data: s })).catch(() => {});

    res.json({
      success: true,
      message: `成功移動 ${result.moved.length} 首曲目`,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// 4. 動態歌單與排程管理 (需驗證身分)
// ==============================================================================

/**
 * 新增自訂歌單
 */
router.post('/playlists', requireAuth, (req, res) => {
  try {
    const { id, name, folder, description, color, play_mode, transition } = req.body;
    if (!id || !name) {
      return res.status(400).json({ success: false, error: '歌單 ID 與名稱不可為空' });
    }
    const cleanId = id.trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '_');
    const existing = getPlaylistById(cleanId);
    if (existing) {
      return res.status(400).json({ success: false, error: `歌單 ID「${cleanId}」已存在` });
    }

    const created = createPlaylist({
      id: cleanId,
      name: name.trim(),
      folder: (folder || cleanId).trim(),
      description: (description || '').trim(),
      color: color || '#8b5cf6',
      play_mode: play_mode || 'shuffle',
      transition: transition || 'smart'
    });

    // 確保資料夾存在
    getPlaylistDir(created.id);

    res.json({ success: true, message: `成功建立歌單「${created.name}」`, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 更新歌單設定
 */
router.put('/playlists/:id', requireAuth, (req, res) => {
  try {
    const updated = updatePlaylist(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: '歌單不存在' });
    }
    getRadioStatus().then((s) => broadcast({ type: 'RADIO_STATUS', data: s })).catch(() => {});
    res.json({ success: true, message: '歌單設定已更新', data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 刪除歌單及其排程 (若資料夾內仍有歌曲則禁止刪除)
 */
router.delete('/playlists/:id', requireAuth, (req, res) => {
  try {
    const playlistId = req.params.id;

    // 檢查歌單資料夾內是否仍有音訊歌曲
    const dir = getPlaylistDir(playlistId);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mp3'));
      if (files.length > 0) {
        return res.status(400).json({
          success: false,
          error: `無法刪除：此歌單內仍有 ${files.length} 首歌曲！請先清空或將歌曲移動至其他歌單後才能刪除。`
        });
      }
      // 資料夾為空，徹底刪除實體空資料夾避免殘留孤立目錄
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`無法清理空資料夾 ${dir}:`, err.message);
      }
    }

    deletePlaylist(playlistId);
    res.json({ success: true, message: `歌單已成功刪除` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 查詢所有排程規則 (公開或管理端皆可查詢)
 */
router.get('/schedules', (req, res) => {
  try {
    const schedules = getAllSchedules();
    res.json({ success: true, data: schedules });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 新增排程規則
 */
router.post('/schedules', requireAuth, (req, res) => {
  try {
    const created = createSchedule(req.body);
    res.json({ success: true, message: '排程已成功建立', data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 更新排程規則
 */
router.put('/schedules/:id', requireAuth, (req, res) => {
  try {
    const updated = updateSchedule(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: '排程不存在' });
    }
    res.json({ success: true, message: '排程已更新', data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 刪除排程規則
 */
router.delete('/schedules/:id', requireAuth, (req, res) => {
  try {
    deleteSchedule(req.params.id);
    res.json({ success: true, message: '排程已刪除' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 手動即時觸發某個排程立即播出
 */
router.post('/schedules/:id/trigger', requireAuth, async (req, res) => {
  try {
    const schedule = getScheduleById(req.params.id);
    if (!schedule) {
      return res.status(404).json({ success: false, error: '排程不存在' });
    }
    const tracks = getPlaylistTracksFromDisk(schedule.playlist_folder || schedule.playlist_id);
    if (tracks.length === 0) {
      return res.status(400).json({ success: false, error: '該歌單內目前無任何 MP3 曲目' });
    }
    const randomTrack = tracks[Math.floor(Math.random() * tracks.length)];
    const ok = await pushTrackToLiquidsoap(randomTrack.fullPath, schedule.interrupt_mode || 'wait_track_end');
    if (ok) {
      res.json({
        success: true,
        message: `已成功觸發「${schedule.title}」，準備播放「${randomTrack.filename}」`,
        track: randomTrack.filename
      });
    } else {
      res.status(500).json({ success: false, error: '推播至廣播引擎失敗' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// 9. 備份與設定 (Backup & Settings Endpoints)
// ==============================================================================

/**
 * 取得備份檔案清單
 */
router.get('/backups', requireAuth, (req, res) => {
  try {
    const list = listBackups();
    res.json({
      success: true,
      data: list,
      backupDir: 'music/backups'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 建立全新備份檔 (包含歌單配置、顏色、播放模式、智慧排程、曲目快照)
 */
router.post('/backups', requireAuth, (req, res) => {
  try {
    const backup = createBackup();
    res.json({
      success: true,
      message: `備份建立成功！已儲存至 music/backups/${backup.filename}`,
      data: backup
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 建立全站完整備份檔 (含所有歌單設定與 MP3 音訊，打包為 .zip)
 */
router.post('/backups/full-zip', requireAuth, (req, res) => {
  try {
    const backup = createFullZipBackup();
    res.json({
      success: true,
      message: `全站歌曲與設定備份已成功打包！已儲存至 music/backups/${backup.filename}`,
      data: backup
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 下載指定備份檔 (支援 .json 與 .zip)
 */
router.get('/backups/:filename/download', requireAuth, (req, res) => {
  try {
    const filePath = getBackupPath(req.params.filename);
    if (!filePath) {
      return res.status(404).json({ success: false, error: '找不到指定的備份檔案' });
    }
    const safeFilename = path.basename(filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
    if (safeFilename.toLowerCase().endsWith('.zip')) {
      res.setHeader('Content-Type', 'application/zip');
    } else {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 刪除指定備份檔
 */
router.delete('/backups/:filename', requireAuth, (req, res) => {
  try {
    const ok = deleteBackup(req.params.filename);
    if (ok) {
      res.json({ success: true, message: `已成功刪除備份檔「${req.params.filename}」` });
    } else {
      res.status(404).json({ success: false, error: '備份檔案不存在或已遭刪除' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 從 backups 目錄下的指定備份檔還原
 */
router.post('/backups/:filename/restore', requireAuth, async (req, res) => {
  try {
    const result = restoreBackupFile(req.params.filename);
    res.json({
      success: true,
      message: `備份還原成功！共還原 ${result.playlistsRestored} 個歌單與 ${result.schedulesRestored} 條排程`,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 從直接上傳的 JSON 資料內容還原
 */
router.post('/backups/restore-data', requireAuth, async (req, res) => {
  try {
    const backupData = req.body;
    const result = restoreBackupData(backupData);
    res.json({
      success: true,
      message: `上傳還原成功！共還原 ${result.playlistsRestored} 個歌單與 ${result.schedulesRestored} 條排程`,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function sendDefaultCoverSvg(res, title = 'CastFlow Live', artist = 'On Air') {
  const displayTitle = (title || 'CastFlow').replace(/[<>]/g, '').slice(0, 20);
  const displayArtist = (artist || 'Live Radio').replace(/[<>]/g, '').slice(0, 25);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#4338ca"/>
        <stop offset="50%" stop-color="#6b21a8"/>
        <stop offset="100%" stop-color="#0f172a"/>
      </linearGradient>
      <radialGradient id="vinyl" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#1e1b4b"/>
        <stop offset="60%" stop-color="#09090b"/>
        <stop offset="100%" stop-color="#000000"/>
      </radialGradient>
    </defs>
    <rect width="300" height="300" fill="url(#bg)"/>
    <circle cx="150" cy="150" r="130" fill="url(#vinyl)" stroke="#312e81" stroke-width="4"/>
    <circle cx="150" cy="150" r="110" fill="none" stroke="#27272a" stroke-width="1.5" stroke-dasharray="8 4"/>
    <circle cx="150" cy="150" r="90" fill="none" stroke="#3f3f46" stroke-width="1"/>
    <circle cx="150" cy="150" r="70" fill="none" stroke="#27272a" stroke-width="1.5"/>
    <circle cx="150" cy="150" r="50" fill="#6366f1" opacity="0.9"/>
    <circle cx="150" cy="150" r="12" fill="#09090b" stroke="#ffffff" stroke-width="2"/>
    <text x="150" y="240" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="bold" fill="#ffffff" text-anchor="middle">${displayTitle}</text>
    <text x="150" y="260" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="#c4b5fd" text-anchor="middle">${displayArtist}</text>
  </svg>`;
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.send(svg);
}
