import fs from 'fs';
import path from 'path';
import { getAllPlaylists, getAllSchedules, getScheduleById, getPlaylistById } from './db.js';
import { sendTelnetCommand, liquidsoap } from './telnet.js';
import { icecast } from './icecast.js';
import { getAudioMetadata, findTrackPathByTitle } from './metadata.js';

let tracksPlayedCount = 0;
const lastExecutedFixedTimes = new Map(); // scheduleId -> 'YYYY-MM-DD HH:MM'
const playlistShuffleIndices = new Map(); // playlistId -> { list: [], index: 0 }
let isAutoDJRunning = false;
let autoDJTimer = null;
let currentPlayingTitle = null;
let currentTrackStartTime = Date.now();

const MUSIC_DIR = process.env.MUSIC_DIR || path.resolve(process.cwd(), '../music');

/**
 * 取得指定歌單目錄下的所有 MP3 檔案清單
 */
export function getPlaylistTracksFromDisk(folderName) {
  const dir = path.join(MUSIC_DIR, folderName);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      return [];
    }
  }

  try {
    const files = fs.readdirSync(dir);
    return files
      .filter((f) => f.toLowerCase().endsWith('.mp3') && !f.startsWith('.'))
      .map((f) => ({
        filename: f,
        fullPath: path.join(dir, f),
        relativePath: `${folderName}/${f}`
      }));
  } catch (e) {
    console.error(`[Scheduler] Failed to read dir ${dir}:`, e.message);
    return [];
  }
}

/**
 * 從指定歌單選取下一首曲目 (支援隨機打亂 Shuffle 與防連續重複)
 */
export function getNextTrackFromPlaylist(playlistId) {
  const playlist = getPlaylistById(playlistId);
  if (!playlist) return null;

  const tracks = getPlaylistTracksFromDisk(playlist.folder);
  if (tracks.length === 0) return null;

  if (playlist.play_mode === 'sequential') {
    let state = playlistShuffleIndices.get(playlistId) || { index: 0 };
    const selected = tracks[state.index % tracks.length];
    state.index = (state.index + 1) % tracks.length;
    playlistShuffleIndices.set(playlistId, state);
    return selected;
  }

  // 預設隨機打亂 (Shuffle)
  let state = playlistShuffleIndices.get(playlistId);
  if (!state || state.list.length !== tracks.length || state.index >= state.list.length) {
    // 產生新的一輪打亂序列
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    state = { list: shuffled, index: 0 };
  }

  const selected = state.list[state.index];
  state.index += 1;
  playlistShuffleIndices.set(playlistId, state);
  return selected;
}

/**
 * 檢查目前時間與星期是否符合排程要求
/**
 * 驗證當前時間是否座落於指定的開始與結束時段區間 (支援跨日夜間時段)
 */
export function isTimeInWindow(startTime, endTime, now = new Date()) {
  if (!startTime || !endTime) return true;
  const pad = (n) => n.toString().padStart(2, '0');
  const curTime = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const s = startTime.length === 5 ? `${startTime}:00` : startTime;
  const e = endTime.length === 5 ? `${endTime}:59` : endTime;

  if (s <= e) {
    return curTime >= s && curTime <= e;
  } else {
    // 跨日區間 (例如 22:00:00 ~ 08:00:59)
    return curTime >= s || curTime <= e;
  }
}

/**
 * 檢查排程規則於當前時間是否處於生效狀態
 */
function isScheduleActiveNow(schedule, now = new Date()) {
  if (!schedule.is_active) return false;

  // 1. 星期幾檢查 (0: 週日, 1: 週一 ... 6: 週六)
  const currentDay = now.getDay().toString();
  const allowedDays = (schedule.days_of_week || '0,1,2,3,4,5,6').split(',');
  if (!allowedDays.includes(currentDay)) {
    return false;
  }

  // 2. 時段檢查
  if (schedule.schedule_type === 'continuous') {
    if (schedule.is_all_day) return true;
    if (!schedule.start_time || !schedule.end_time) return true;
    return isTimeInWindow(schedule.start_time, schedule.end_time, now);
  }

  if (schedule.schedule_type === 'hourly') {
    // 檢查時段區間 (例如 11:00 ~ 22:00 或全天)
    if (!schedule.is_all_day && schedule.start_time && schedule.end_time) {
      if (!isTimeInWindow(schedule.start_time, schedule.end_time, now)) {
        return false;
      }
    }

    // 檢查分鐘數 (例如 30 表示每小時第 30 分)
    let targetMinute = 0;
    if (schedule.target_time !== undefined && schedule.target_time !== null) {
      const cleanMin = schedule.target_time.toString().replace(':', '').trim();
      targetMinute = parseInt(cleanMin, 10);
      if (isNaN(targetMinute)) targetMinute = 0;
    }

    return now.getMinutes() === targetMinute;
  }

  if (schedule.schedule_type === 'interval') {
    if (schedule.is_all_day) return true;
    if (!schedule.start_time || !schedule.end_time) return true;
    return isTimeInWindow(schedule.start_time, schedule.end_time, now);
  }

  if (schedule.schedule_type === 'fixed_time') {
    const pad = (n) => n.toString().padStart(2, '0');
    const targetHHMM = (schedule.target_time || '').substring(0, 5); // 'HH:MM'
    const currentHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    // 若有指定單次日期
    if (schedule.target_date) {
      const currentDateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      if (schedule.target_date !== currentDateStr) return false;
    }

    return targetHHMM === currentHHMM;
  }

  return false;
}

/**
 * 核心決策引擎：依權重、時段、間隔與指定時間計算下一首曲目
 */
export function decideNextTrack() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  const dateKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const allSchedules = getAllSchedules();

  // 1. 優先檢查：精確指定時間 (fixed_time) 與每小時整點/定分插播 (hourly)
  const prioritySchedules = allSchedules
    .filter((s) => (s.schedule_type === 'fixed_time' || s.schedule_type === 'hourly') && s.is_active)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  for (const sch of prioritySchedules) {
    if (isScheduleActiveNow(sch, now)) {
      const lastRan = lastExecutedFixedTimes.get(sch.id);
      if (lastRan !== dateKey) {
        // 本分鐘尚未執行過
        const track = getNextTrackFromPlaylist(sch.playlist_id);
        if (track) {
          lastExecutedFixedTimes.set(sch.id, dateKey);
          tracksPlayedCount++;
          return {
            track,
            playlistId: sch.playlist_id,
            schedule: sch,
            reason: sch.schedule_type,
            interruptMode: sch.interrupt_mode
          };
        }
      }
    }
  }

  // 2. 次要檢查：間隔插播 (interval - 每 X 首播 Y 首)
  const intervalSchedules = allSchedules.filter((s) => s.schedule_type === 'interval' && s.interval_every_tracks > 0);
  for (const sch of intervalSchedules) {
    if (isScheduleActiveNow(sch, now)) {
      if (tracksPlayedCount > 0 && tracksPlayedCount % sch.interval_every_tracks === 0) {
        const track = getNextTrackFromPlaylist(sch.playlist_id);
        if (track) {
          tracksPlayedCount++;
          return {
            track,
            playlistId: sch.playlist_id,
            schedule: sch,
            reason: 'interval',
            interruptMode: 'wait_track_end'
          };
        }
      }
    }
  }

  // 3. 常規輪播：依輪播權重 (Weights) 進行加權隨機抽選
  const activeContinuous = allSchedules.filter((s) => s.schedule_type === 'continuous' && isScheduleActiveNow(s, now));

  if (activeContinuous.length > 0) {
    // 計算總權重池
    const totalWeight = activeContinuous.reduce((sum, s) => sum + (Math.max(1, s.weight || 1)), 0);
    let randomNum = Math.random() * totalWeight;

    let selectedSchedule = activeContinuous[0];
    for (const sch of activeContinuous) {
      const w = Math.max(1, sch.weight || 1);
      if (randomNum < w) {
        selectedSchedule = sch;
        break;
      }
      randomNum -= w;
    }

    const track = getNextTrackFromPlaylist(selectedSchedule.playlist_id);
    if (track) {
      tracksPlayedCount++;
      return {
        track,
        playlistId: selectedSchedule.playlist_id,
        schedule: selectedSchedule,
        reason: 'continuous',
        interruptMode: 'wait_track_end'
      };
    }
  }

  // 4. 若皆無符合，隨機自 A 歌單或第一個有檔案的歌單保底
  const allPlaylists = getAllPlaylists().filter((p) => p.is_active);
  for (const pl of allPlaylists) {
    const track = getNextTrackFromPlaylist(pl.id);
    if (track) {
      tracksPlayedCount++;
      return {
        track,
        playlistId: pl.id,
        schedule: null,
        reason: 'fallback',
        interruptMode: 'wait_track_end'
      };
    }
  }

  return null;
}

// 實時保存已推送到 Liquidsoap dynamic_queue 的真實待播曲目 (保證穩定不跳動)
let plannedQueue = [];

/**
 * 透過 Telnet 將曲目推送至 Liquidsoap dynamic_queue 並登記至 plannedQueue
 */
export async function pushTrackToLiquidsoap(trackPathOrDecision, interruptMode = 'wait_track_end') {
  try {
    const isDecisionObj = typeof trackPathOrDecision === 'object' && trackPathOrDecision.track;
    const trackPath = isDecisionObj ? trackPathOrDecision.track.fullPath : trackPathOrDecision;
    const filename = isDecisionObj ? trackPathOrDecision.track.filename : path.basename(trackPath);

    const pushCmd = `dynamic_queue.push ${trackPath}`;
    const pushRes = await sendTelnetCommand(pushCmd);
    const rid = pushRes.replace(/END/g, '').trim();
    console.log(`[Scheduler] Pushed track: ${trackPath} -> RID ${rid}`);

    const meta = await getAudioMetadata(trackPath).catch(() => null);
    const folderName = path.basename(path.dirname(trackPath));
    const allPlaylists = getAllPlaylists();
    const playlist = isDecisionObj
      ? getPlaylistById(trackPathOrDecision.playlistId)
      : allPlaylists.find((p) => p.folder === folderName);

    const queuedItem = {
      rid,
      filename,
      fullPath: trackPath,
      title: meta?.title || filename.replace(/\.mp3$/i, ''),
      artist: meta?.artist || 'Unknown Artist',
      duration: meta?.duration || 0,
      playlistId: playlist?.id || 'A',
      playlistName: playlist?.name || '智慧歌單',
      playlistColor: playlist?.color || '#6366f1',
      ruleTitle: isDecisionObj
        ? trackPathOrDecision.schedule?.title || (trackPathOrDecision.reason === 'interval' ? '間隔插播' : '智慧輪播')
        : '手動插播',
      scheduleType: isDecisionObj ? trackPathOrDecision.reason : 'manual'
    };

    plannedQueue.push(queuedItem);

    if (interruptMode === 'immediate_fade') {
      // 即時強制切入 (淡出當前曲目)
      await sendTelnetCommand('dynamic_queue.flush_and_skip');
      console.log(`[Scheduler] Triggered immediate fade skip.`);
    }

    return rid;
  } catch (err) {
    console.error(`[Scheduler] Failed to push track to Liquidsoap:`, err.message);
    return null;
  }
}

/**
 * 檢查並自動填充 Liquidsoap 的動態佇列 (精確維持 3 首待播曲目)
 */
export async function checkAndFeedQueue() {
  try {
    // 查詢當前佇列長度 (以空格解析 RID 陣列)
    const queueOutput = await sendTelnetCommand('dynamic_queue.queue');
    const currentRids = queueOutput.replace(/END/g, '').trim().split(/\s+/).filter(Boolean);

    // 同步 plannedQueue：僅保留仍在 Liquidsoap 待播佇列中的項目
    plannedQueue = plannedQueue.filter((item) => currentRids.includes(item.rid));

    // 若 plannedQueue 缺少某些已在 Liquidsoap 待播中的 RID (例如伺服器重啟時)，主動向 Liquidsoap 查回元資料補全
    for (const rid of currentRids) {
      if (!plannedQueue.some((item) => item.rid === rid)) {
        try {
          const metaRes = await sendTelnetCommand(`request.metadata ${rid}`);
          const fileMatch = metaRes.match(/filename="([^"]+)"/) || metaRes.match(/initial_uri="([^"]+)"/);
          if (fileMatch) {
            const fullPath = fileMatch[1];
            const filename = path.basename(fullPath);
            const meta = await getAudioMetadata(fullPath).catch(() => null);
            const folderName = path.basename(path.dirname(fullPath));
            const allPlaylists = getAllPlaylists();
            const playlist = allPlaylists.find((p) => p.folder === folderName);
            plannedQueue.push({
              rid,
              filename,
              fullPath,
              title: meta?.title || filename.replace(/\.mp3$/i, ''),
              artist: meta?.artist || 'Unknown Artist',
              duration: meta?.duration || 0,
              playlistId: playlist?.id || 'A',
              playlistName: playlist?.name || '智慧歌單',
              playlistColor: playlist?.color || '#6366f1',
              ruleTitle: '排程佇列',
              scheduleType: 'queued'
            });
          }
        } catch {
          // 忽略
        }
      }
    }

    // 優先檢查是否有到點定時插播 (fixed_time 或 hourly)
    const now = new Date();
    const allSchedules = getAllSchedules();
    const prioritySchedules = allSchedules
      .filter((s) => (s.schedule_type === 'fixed_time' || s.schedule_type === 'hourly') && s.is_active)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const sch of prioritySchedules) {
      if (isScheduleActiveNow(sch, now)) {
        const pad = (n) => n.toString().padStart(2, '0');
        const dateKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const lastRan = lastExecutedFixedTimes.get(sch.id);
        if (lastRan !== dateKey) {
          const track = getNextTrackFromPlaylist(sch.playlist_id);
          if (track) {
            lastExecutedFixedTimes.set(sch.id, dateKey);
            tracksPlayedCount++;
            await pushTrackToLiquidsoap({
              track,
              playlistId: sch.playlist_id,
              schedule: sch,
              reason: sch.schedule_type
            }, sch.interrupt_mode);
            return;
          }
        }
      }
    }

    // 當佇列待播少於 3 首時，才調用決策引擎逐首補充至 3 首
    // (避免在佇列充裕時無效推進 shuffle 索引與重複計數)
    while (currentRids.length < 3) {
      const decision = decideNextTrack();
      if (!decision) break;
      const rid = await pushTrackToLiquidsoap(decision, decision.interruptMode);
      if (!rid) break;
      currentRids.push(rid);
    }
  } catch (err) {
    // Telnet 暫態離線時不崩潰
  }
}

/**
 * 平滑切換至下一首曲目 (無爆音轉場)
 */
export async function skipCurrentTrack() {
  try {
    const queueOutput = await sendTelnetCommand('dynamic_queue.queue');
    const currentRids = queueOutput.replace(/END/g, '').trim().split(/\s+/).filter(Boolean);

    if (currentRids.length === 0) {
      const decision = decideNextTrack();
      if (decision) {
        await pushTrackToLiquidsoap(decision);
      }
    }

    // 透過 dynamic_queue.skip 觸發平滑淡出轉場 (絕不直接切斷輸出端)
    const skipRes = await sendTelnetCommand('dynamic_queue.skip');
    currentPlayingTitle = null;
    console.log(`[Scheduler] Smoothly skipped current track via dynamic_queue: ${skipRes}`);

    // 切換後立即補足隊列維持 3 首待播
    setTimeout(checkAndFeedQueue, 300);

    return skipRes;
  } catch (err) {
    console.error('[Scheduler] Failed to skip current track:', err.message);
    throw err;
  }
}

/**
 * 啟動 AutoDJ 背景巡檢迴圈 (每 5 秒檢查一次)
 */
export function startAutoDJScheduler() {
  if (isAutoDJRunning) return;
  isAutoDJRunning = true;
  console.log('[Scheduler] AutoDJ Scheduling Engine started.');

  // 初始巡檢
  setTimeout(checkAndFeedQueue, 2000);

  autoDJTimer = setInterval(checkAndFeedQueue, 5000);
}

export function stopAutoDJScheduler() {
  if (autoDJTimer) clearInterval(autoDJTimer);
  isAutoDJRunning = false;
}

/**
 * 取得即將播送的未來曲目佇列 (直接返回真實待播陣列，穩定不跳動)
 */
export async function getUpcomingTracks(count = 3) {
  try {
    if (plannedQueue.length === 0) {
      // 若尚未填充，嘗試觸發一次檢查
      await checkAndFeedQueue();
    }

    return plannedQueue.slice(0, count).map((item, idx) => ({
      order: idx + 1,
      playlistId: item.playlistId,
      playlistName: item.playlistName,
      playlistColor: item.playlistColor,
      filename: item.filename,
      title: item.title,
      artist: item.artist,
      duration: item.duration,
      ruleTitle: item.ruleTitle,
      scheduleType: item.scheduleType
    }));
  } catch {
    return [];
  }
}

/**
 * 彙整整體廣播即時狀態 (提供 REST API 與 WebSocket 廣播)
 */
export async function getRadioStatus() {
  const [iceStats, metadata, remaining, upcomingTracks] = await Promise.all([
    icecast.getStats().catch(() => ({ online: false })),
    liquidsoap.getMetadata().catch(() => ({})),
    liquidsoap.getRemaining().catch(() => null),
    getUpcomingTracks(3).catch(() => [])
  ]);

  const rawTitle = metadata.title || iceStats.title || 'CastFlow Live';
  const artist = metadata.artist || '雲原生自動化廣播電台';
  const album = metadata.album || '';
  const onAir = metadata.on_air || null;
  const initialUri = metadata.initial_uri || metadata.filename || '';

  if (rawTitle && rawTitle !== currentPlayingTitle) {
    currentPlayingTitle = rawTitle;
    currentTrackStartTime = Date.now();
  }

  let duration = metadata.duration ? parseFloat(metadata.duration) : null;
  let remainingSec = remaining !== null && !isNaN(remaining) ? Math.round(remaining) : null;

  // 若 Liquidsoap telnet 未回傳 duration，則由檔案 ID3 標籤或音訊解析取得
  if (!duration || duration <= 0) {
    let filePath = initialUri;
    if (!filePath || !fs.existsSync(filePath)) {
      filePath = await findTrackPathByTitle(rawTitle);
    }
    if (filePath && fs.existsSync(filePath)) {
      const audioMeta = await getAudioMetadata(filePath).catch(() => null);
      if (audioMeta && audioMeta.duration > 0) {
        duration = audioMeta.duration;
      }
    }
  }

  let elapsed = 0;
  let progress = 0;

  if (duration && duration > 0) {
    if (remainingSec !== null && remainingSec <= duration) {
      elapsed = Math.max(0, Math.min(duration, Math.round(duration - remainingSec)));
    } else {
      elapsed = Math.min(duration, Math.max(0, Math.round((Date.now() - currentTrackStartTime) / 1000)));
      if (remainingSec === null) {
        remainingSec = Math.max(0, duration - elapsed);
      }
    }
    progress = Math.min(100, Math.max(0, Math.round((elapsed / duration) * 100)));
  } else if (remainingSec !== null) {
    elapsed = Math.max(0, Math.round((Date.now() - currentTrackStartTime) / 1000));
  }

  // 取得所有動態歌單摘要
  const dbPlaylists = getAllPlaylists();
  const playlistsSummary = dbPlaylists.map((p) => {
    const tracks = getPlaylistTracksFromDisk(p.folder);
    return {
      id: p.id,
      name: p.name,
      folder: p.folder,
      color: p.color,
      count: tracks.length,
      trackCount: tracks.length,
      is_active: p.is_active,
      play_mode: p.play_mode,
      transition: p.transition
    };
  });

  return {
    online: (iceStats.online ?? false) && liquidsoap.isConnected,
    liquidsoap: {
      connected: liquidsoap.isConnected,
      onAir
    },
    icecast: iceStats,
    currentTrack: {
      title: rawTitle,
      artist,
      album,
      duration,
      remaining: remainingSec,
      elapsed,
      progress,
      uri: initialUri
    },
    upcomingTracks,
    playlistsSummary
  };
}

