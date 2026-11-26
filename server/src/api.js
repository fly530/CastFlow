import express from 'express';
import path from 'path';
import fs from 'fs';
import { liquidsoap } from './telnet.js';
import { getRadioStatus, invalidateRadioStatus } from './scheduler.js';
import {
  listPlaylists,
  getPlaylistTracks,
  deleteTrack,
  deleteTracks,
  moveTracks,
  uploadMiddleware,
  getPlaylistDir,
  getMusicBaseDir,
  sanitizeTrackFilename,
  extractMp3sFromZip
} from './playlists.js';
import { extractCoverArt, findTrackPathByTitle } from './metadata.js';
import {
  requireAuth,
  loginUser,
  changePassword,
  signDownloadToken,
  verifyDownloadToken,
  DOWNLOAD_TOKEN_TTL_SECONDS,
  loginLimiter
} from './auth.js';
import { createRateLimiter } from './rateLimit.js';
import {
  findUserByUsername,
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
import { pushTrackToLiquidsoap, getNextTrackFromPlaylist, skipCurrentTrack, QUEUE } from './scheduler.js';
import { broadcast } from './websocket.js';
import { normalizeSchedule } from './scheduleValidation.js';
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

// 狀態有 1 秒快取：任何管理操作 (跳歌、上傳、改歌單或排程…) 完成後就作廢，
// 前端緊接著抓 /api/status 時才不會拿到操作前的舊資料。聽眾的日誌回報不算。
router.use((req, res, next) => {
  if (req.method !== 'GET' && !req.path.startsWith('/logs/')) {
    res.on('finish', invalidateRadioStatus);
  }
  next();
});

// ==============================================================================
// 1. 認證相關 API (Auth Endpoints)
// ==============================================================================

/**
 * 管理員登入
 */
router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, error: '請提供帳號與密碼' });
    }
    // 依 req.ip 計次 (經 nginx 轉發時靠 app 的 trust proxy 取得真正的來源 IP)
    const limit = loginLimiter.hit(req.ip);
    if (limit.limited) {
      res.setHeader('Retry-After', String(limit.retryAfterSec));
      return res.status(429).json({
        success: false,
        error: `登入嘗試次數過多，請於 ${Math.ceil(limit.retryAfterSec / 60)} 分鐘後再試`
      });
    }
    const result = await loginUser(username, password);
    if (!result.success) {
      return res.status(401).json(result);
    }
    loginLimiter.reset(req.ip);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 檢查目前登入身分
 */
router.get('/auth/me', requireAuth, (req, res) => {
  const user = findUserByUsername(req.user.username);
  if (!user) {
    return res.status(401).json({ success: false, error: '帳號不存在，請重新登入' });
  }
  res.json({
    success: true,
    user: { id: user.id, username: user.username },
    passwordNeedsChange: Boolean(user.must_change_password)
  });
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
 * 廣播系統即時狀態 (內部格式，供前端面板使用)
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
 * AzuraCast 相容格式端點，供外部整合使用
 * 格式：now_playing.song.title / .artist / .art
 */
router.get('/nowplaying/coolradio', async (req, res) => {
  try {
    const status = await getRadioStatus();
    const track = status.currentTrack || {};

    // 封面圖片 URL：使用現有的 /api/current/cover 端點
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const artUrl = `${baseUrl}/api/current/cover?title=${encodeURIComponent(track.title || '')}`;

    res.json({
      now_playing: {
        song: {
          title: track.title || '',
          artist: track.artist || '',
          album: track.album || '',
          art: artUrl
        },
        elapsed: track.elapsed || 0,
        remaining: track.remaining || 0,
        duration: track.duration || 0
      },
      listeners: {
        current: status.icecast?.listeners || 0,
        unique: status.icecast?.listeners || 0
      },
      is_online: status.online || false
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 最近播放歷史清單 (SQLite 持久化記錄)
 */
router.get('/history', (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 200);
    const history = getRecentHistory(limit);
    res.json({ success: true, data: history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// 播放診斷與日誌記錄 (Playback Health & Diagnostic Logging)
// ==============================================================================
const LOGS_DIR = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'logs') : path.join(getMusicBaseDir(), 'logs');
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
// playback.log 超過這個大小就輪替成 playback.log.1 (只留一份舊檔)，原本會無限長大
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024;
// 公開端點：每個 IP 每分鐘最多收 30 筆，超過的直接丟掉
const playbackLogLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });
const LOG_LEVELS = new Set(['INFO', 'WARN', 'ERROR']);

let logWriteChain = Promise.resolve();
function appendPlaybackLog(entry) {
  const line = `[${entry.timestamp}] [${entry.level}] [${entry.streamType}] [${entry.event}] ${entry.message} ${entry.metrics ? JSON.stringify(entry.metrics) : ''}\n`;
  inMemoryLogs.unshift(entry);
  if (inMemoryLogs.length > MAX_LOGS) inMemoryLogs.pop();

  // 非同步依序寫入，不卡住 event loop
  logWriteChain = logWriteChain
    .then(async () => {
      const stat = await fs.promises.stat(PLAYBACK_LOG_FILE).catch(() => null);
      if (stat && stat.size > MAX_LOG_FILE_BYTES) {
        await fs.promises.rename(PLAYBACK_LOG_FILE, `${PLAYBACK_LOG_FILE}.1`);
      }
      await fs.promises.appendFile(PLAYBACK_LOG_FILE, line, 'utf8');
    })
    .catch((err) => console.error('Failed to append to playback.log:', err.message));
}

/** 聽眾端送來的字串欄位：轉成字串並截斷，避免一筆就塞進幾 MB */
function clip(value, max) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').slice(0, max);
}

/**
 * 接收客戶端播放診斷日誌
 */
router.post('/logs/playback', (req, res) => {
  const clientIp = req.ip || 'unknown';
  if (playbackLogLimiter.hit(clientIp).limited) {
    return res.status(429).json({ success: false, error: '日誌回報過於頻繁' });
  }
  const body = req.body || {};
  const level = LOG_LEVELS.has(body.level) ? body.level : 'INFO';
  let metrics = null;
  if (body.metrics && typeof body.metrics === 'object') {
    const json = JSON.stringify(body.metrics);
    metrics = json.length <= 1000 ? body.metrics : null;
  }

  const entry = {
    id: Date.now() + Math.random().toString(36).slice(2, 6),
    // 時間以伺服器收到的為準：客戶端時鐘不可信，也可能塞任意字串
    timestamp: new Date().toISOString(),
    level,
    event: clip(body.event || 'LOG', 64),
    streamType: clip(body.streamType || 'unknown', 16),
    message: clip(body.message, 500),
    metrics,
    clientIp
  };
  appendPlaybackLog(entry);
  res.json({ success: true });
});

/**
 * 查詢最新播放日誌
 */
router.get('/logs/playback', requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, MAX_LOGS);
  res.json({
    success: true,
    count: inMemoryLogs.length,
    data: inMemoryLogs.slice(0, limit)
  });
});

/**
 * 清空播放日誌
 */
router.delete('/logs/playback', requireAuth, async (req, res) => {
  inMemoryLogs.length = 0;
  // 排在尚未寫完的日誌之後清空，否則清完又被補寫回來
  logWriteChain = logWriteChain.then(async () => {
    await fs.promises.truncate(PLAYBACK_LOG_FILE, 0).catch((e) => {
      if (e.code !== 'ENOENT') console.error('Failed to clear playback.log:', e.message);
    });
    await fs.promises.rm(`${PLAYBACK_LOG_FILE}.1`, { force: true }).catch(() => {});
  });
  await logWriteChain;
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
    // 每位聽眾每次換歌都會打這支：沿用狀態快取裡的 on-air 檔案，不再每次各問 Liquidsoap 兩道 Telnet 指令
    const status = await getRadioStatus().catch(() => null);
    const onAir = status?.currentTrack || {};
    const requestedTitle = typeof req.query.title === 'string' ? req.query.title : '';
    const currentTitle = requestedTitle || onAir.title;

    let filePath = null;
    if ((!requestedTitle || requestedTitle === onAir.title) && onAir.uri && fs.existsSync(onAir.uri)) {
      filePath = onAir.uri;
    }
    if (!filePath && currentTitle) {
      filePath = await findTrackPathByTitle(currentTitle);
    }

    if (filePath && fs.existsSync(filePath)) {
      const cover = await extractCoverArt(filePath);
      if (cover && cover.buffer) {
        res.setHeader('Content-Type', cover.mimeType || 'image/jpeg');
        // 網址帶著曲名，同一個網址就是同一首歌的封面
        res.setHeader('Cache-Control', requestedTitle ? 'public, max-age=3600' : 'public, max-age=10');
        return res.send(cover.buffer);
      }
    }
    return sendDefaultCoverSvg(res, currentTitle, onAir.artist);
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
        const s = await getRadioStatus({ maxAgeMs: 0 });
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
  const files = req.files || [];
  const skipped = req.skippedFiles || [];
  try {
    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        error: skipped.length > 0 ? `僅支援 MP3 或 ZIP，已略過 ${skipped.length} 個檔案` : '未選取任何檔案',
        skipped
      });
    }

    const destDir = getPlaylistDir(req.params.id);
    const added = [];
    const errors = [];

    for (const f of files) {
      if (path.extname(f.filename).toLowerCase() !== '.zip') {
        added.push(f.filename);
        continue;
      }
      // ZIP：解出其中的 mp3 (攤平目錄、同名加序號)，壓縮包本身不保留
      const zipFilePath = path.join(destDir, f.filename);
      try {
        const extracted = await extractMp3sFromZip(zipFilePath, destDir);
        if (extracted.length === 0) {
          errors.push({ filename: f.originalname, error: '壓縮包內沒有 MP3' });
        }
        added.push(...extracted);
      } catch (unzipErr) {
        console.warn('[Upload] Unzip error:', unzipErr.message);
        errors.push({ filename: f.originalname, error: unzipErr.message });
      } finally {
        try {
          fs.rmSync(zipFilePath, { force: true });
        } catch {}
      }
    }

    // 上傳後通知 Liquidsoap 重新加載保底歌單
    await liquidsoap.reloadPlaylists().catch(() => {});
    getRadioStatus({ maxAgeMs: 0 }).then((s) => broadcast({ type: 'RADIO_STATUS', data: s })).catch(() => {});

    const targetPl = getPlaylistById(req.params.id);
    const targetName = targetPl ? targetPl.name : req.params.id;
    const notes = [];
    if (skipped.length > 0) notes.push(`略過 ${skipped.length} 個非 MP3/ZIP 檔案`);
    if (errors.length > 0) notes.push(`${errors.length} 個壓縮包處理失敗`);

    res.status(added.length > 0 ? 200 : 400).json({
      success: added.length > 0,
      message: `已加入 ${added.length} 首曲目至「${targetName}」${notes.length ? `（${notes.join('，')}）` : ''}`,
      ...(added.length === 0 && { error: errors[0]?.error || '沒有可加入的曲目' }),
      files: added,
      skipped,
      errors
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

    // 與刪除／移動同一條規則：只接受 mp3 的 basename (擋路徑穿越與改其他檔案)
    const oldName = path.basename(req.params.filename);
    if (oldName !== req.params.filename || path.extname(oldName).toLowerCase() !== '.mp3') {
      return res.status(400).json({ success: false, error: '只能修改 .mp3 曲目' });
    }
    const destDir = getPlaylistDir(req.params.id);
    const oldPath = path.join(destDir, oldName);

    // 與上傳同一套清洗：保留中文檔名 (舊版把非英數字元全換成底線，「晴天」會變成「__」)
    const safeTargetName = sanitizeTrackFilename(newFilename.trim());
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
    getRadioStatus({ maxAgeMs: 0 }).then((s) => broadcast({ type: 'RADIO_STATUS', data: s })).catch(() => {});

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
    getRadioStatus({ maxAgeMs: 0 }).then((s) => broadcast({ type: 'RADIO_STATUS', data: s })).catch(() => {});

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
    getRadioStatus({ maxAgeMs: 0 }).then((s) => broadcast({ type: 'RADIO_STATUS', data: s })).catch(() => {});

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
    getRadioStatus({ maxAgeMs: 0 }).then((s) => broadcast({ type: 'RADIO_STATUS', data: s })).catch(() => {});

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
      // ★ folder 會被拿去組檔案系統路徑（playlists.js 的 getPlaylistDir），
      //   必須與 id 套用同一套清洗。原本只有 .trim()，"../../../../app/src"
      //   這種值可以讓後續的上傳／刪除操作跳出 MUSIC_DIR。
      //   getPlaylistDir 也擋了一層（既有髒資料列一併失效），兩層都要有。
      folder: (folder || cleanId).trim().replace(/[^a-zA-Z0-9_\-]/g, '_') || cleanId,
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
    getRadioStatus({ maxAgeMs: 0 }).then((s) => broadcast({ type: 'RADIO_STATUS', data: s })).catch(() => {});
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
const playlistExists = (id) => Boolean(getPlaylistById(id));

router.post('/schedules', requireAuth, (req, res) => {
  try {
    const { error, data } = normalizeSchedule(req.body, { playlistExists });
    if (error) return res.status(400).json({ success: false, error });
    const created = createSchedule(data);
    res.json({ success: true, message: '排程已成功建立', data: created });
  } catch (err) {
    res.status(err instanceof RangeError ? 400 : 500).json({ success: false, error: err.message });
  }
});

/**
 * 更新排程規則
 */
router.put('/schedules/:id', requireAuth, (req, res) => {
  try {
    const existing = getScheduleById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: '排程不存在' });
    }
    const { error, data } = normalizeSchedule(req.body, { existing, playlistExists });
    if (error) return res.status(400).json({ success: false, error });
    const updated = updateSchedule(req.params.id, data);
    res.json({ success: true, message: '排程已更新', data: updated });
  } catch (err) {
    res.status(err instanceof RangeError ? 400 : 500).json({ success: false, error: err.message });
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
    // 與排程器同一套選曲 (shuffle / sequential)，手動觸發不會打亂該歌單的播放順序
    const track = getNextTrackFromPlaylist(schedule.playlist_id);
    if (!track) {
      return res.status(400).json({ success: false, error: '該歌單內目前無任何 MP3 曲目' });
    }
    // 手動觸發一律走插播佇列：等當前曲目結束就播 (immediate_fade 則立即切換)，
    // 不會排在預排的輪播曲目後面
    const ok = await pushTrackToLiquidsoap(
      { track, playlistId: schedule.playlist_id, schedule, reason: 'manual' },
      schedule.interrupt_mode || 'wait_track_end',
      { queue: QUEUE.PRIORITY }
    );
    if (ok) {
      res.json({
        success: true,
        message: `已成功觸發「${schedule.title}」，準備播放「${track.filename}」`,
        track: track.filename
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
      backupDir: process.env.BACKUP_DIR ? 'backups' : 'music/backups'
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
      message: `備份建立成功！已儲存至 backups/${backup.filename}`,
      data: backup
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 建立全站完整備份檔 (含所有歌單設定與 MP3 音訊，打包為 .zip)
 */
router.post('/backups/full-zip', requireAuth, async (req, res) => {
  try {
    const backup = await createFullZipBackup();
    res.json({
      success: true,
      message: `全站歌曲與設定備份已成功打包！已儲存至 backups/${backup.filename}`,
      data: backup
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

/**
 * 取得備份檔的短效下載網址 (2 分鐘內有效、只能下載這一個檔案)。
 * 前端拿到網址後直接交給瀏覽器下載，幾 GB 的 ZIP 也不會先整包讀進分頁記憶體。
 */
router.post('/backups/:filename/download-link', requireAuth, (req, res) => {
  const filePath = getBackupPath(req.params.filename);
  if (!filePath) {
    return res.status(404).json({ success: false, error: '找不到指定的備份檔案' });
  }
  const filename = path.basename(filePath);
  const token = signDownloadToken(filename);
  res.json({
    success: true,
    url: `/api/backups/${encodeURIComponent(filename)}/download?token=${encodeURIComponent(token)}`,
    filename,
    expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS
  });
});

/** 下載端點接受兩種憑證：網址上的下載 token (瀏覽器直接下載)，或一般的 Authorization header */
function requireAuthOrDownloadToken(req, res, next) {
  if (req.query.token !== undefined) {
    if (verifyDownloadToken(req.query.token, req.params.filename)) return next();
    return res.status(401).json({ success: false, error: '下載連結已過期或無效，請重新點選下載' });
  }
  return requireAuth(req, res, next);
}

/**
 * 下載指定備份檔 (支援 .json 與 .zip)
 */
router.get('/backups/:filename/download', requireAuthOrDownloadToken, (req, res) => {
  try {
    const filePath = getBackupPath(req.params.filename);
    if (!filePath) {
      return res.status(404).json({ success: false, error: '找不到指定的備份檔案' });
    }
    const safeFilename = path.basename(filePath);
    // attachment() 會正確產生 filename / filename*=UTF-8'' 兩種寫法
    res.attachment(safeFilename);
    if (safeFilename.toLowerCase().endsWith('.zip')) {
      res.setHeader('Content-Type', 'application/zip');
    } else {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.setHeader('Cache-Control', 'no-store');
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
    const result = await restoreBackupFile(req.params.filename);
    res.json({
      success: true,
      message: result.configRestored === false ? result.message : restoreMessage('備份還原成功！', result),
      data: result
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
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
      message: restoreMessage('上傳還原成功！', result),
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function restoreMessage(prefix, result) {
  const skipped = result.schedulesSkipped ? `（略過 ${result.schedulesSkipped} 條找不到歌單的排程）` : '';
  const audio = result.audioRestored ? '已還原歌曲音訊，' : '';
  return `${prefix}${audio}共還原 ${result.playlistsRestored} 個歌單與 ${result.schedulesRestored} 條排程${skipped}`;
}

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
