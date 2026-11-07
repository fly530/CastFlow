import fs from 'fs';
import path from 'path';
import {
  getAllPlaylists,
  getAllSchedules,
  getPlaylistById,
  getScheduleRunKey,
  setScheduleRunKey,
  recordTrackHistory,
  pruneTrackHistory
} from './db.js';
import { sendTelnetCommand, liquidsoap } from './telnet.js';
import { icecast } from './icecast.js';
import { getAudioMetadata, findTrackPathByTitle } from './metadata.js';
import { resolvePlaylistDir, listMp3Files } from './playlists.js';

const lastExecutedFixedTimes = new Map(); // scheduleId -> 'YYYY-MM-DD HH:MM' (排定時間點，非實際執行時間)
const playlistOrderState = new Map(); // playlistId -> 播放順序狀態 (見 getNextTrackFromPlaylist)
// 間隔插播：每條規則「距上次插播已播了幾首一般曲目」；以及「每 X 首播 Y 首」還沒播完的部分
const intervalCounters = new Map(); // scheduleId -> 一般曲目數
let pendingIntervalInsert = null; // { scheduleId, remaining }
let isAutoDJRunning = false;
let autoDJTimer = null;
let currentPlayingTitle = null;
let currentTrackStartTime = Date.now();

// Liquidsoap 的兩條佇列 (radio.liq)：
//   priority_queue —— 定時插播與手動觸發，當前曲目一結束就優先播出
//   dynamic_queue  —— 一般輪播，平常預排 TARGET_QUEUE_LENGTH 首
export const QUEUE = { PRIORITY: 'priority_queue', DYNAMIC: 'dynamic_queue' };
const TARGET_QUEUE_LENGTH = 3;
// 立即插播：等插播曲目解析完成才跳歌的上限 (逾時仍會跳，最壞情況是先接一首別的再插播)
const PRIORITY_READY_TIMEOUT_MS = 3000;

// 定時規則 (fixed_time / hourly) 錯過排定分鐘時的補播窗口：排定時間起算 2 分鐘內仍會補播。
// 涵蓋 server 重啟、Telnet 暫時斷線等情況；超過窗口就放棄，避免很久以後才突然插播。
const CATCHUP_MINUTES = 2;

const pad2 = (n) => n.toString().padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 相同訊息在 intervalMs 內只印一次 (排程每 5 秒巡檢，直接印會洗版)
const lastLogAt = new Map();
function logThrottled(key, message, intervalMs = 60000) {
  const nowMs = Date.now();
  if (nowMs - (lastLogAt.get(key) || 0) < intervalMs) return;
  lastLogAt.set(key, nowMs);
  console.warn(message);
}

function getLastRunKey(scheduleId) {
  if (lastExecutedFixedTimes.has(scheduleId)) return lastExecutedFixedTimes.get(scheduleId);
  let key = null;
  try {
    key = getScheduleRunKey(scheduleId);
  } catch (err) {
    logThrottled('run-key-read', `[Scheduler] 讀取規則執行紀錄失敗: ${err.message}`);
  }
  lastExecutedFixedTimes.set(scheduleId, key);
  return key;
}

function markScheduleRun(scheduleId, runKey) {
  lastExecutedFixedTimes.set(scheduleId, runKey);
  try {
    setScheduleRunKey(scheduleId, runKey);
  } catch (err) {
    logThrottled('run-key-write', `[Scheduler] 寫入規則執行紀錄失敗 (重啟後可能重播): ${err.message}`);
  }
}

/**
 * 清除排程器的記憶體狀態 (播放順序、間隔計數、定時規則快取)。
 * 等同伺服器重啟後的狀態；測試用來隔離案例。
 */
export function resetSchedulerState() {
  lastExecutedFixedTimes.clear();
  playlistOrderState.clear();
  intervalCounters.clear();
  pendingIntervalInsert = null;
  plannedQueue = [];
}

/**
 * 定時規則晚了幾分鐘 (0 = 排定的那一分鐘)；不在補播窗口內回傳 null。
 * 只處理 fixed_time 與 hourly。
 */
function getMinutesLate(schedule, now) {
  if (schedule.schedule_type === 'hourly') {
    let targetMinute = 0;
    if (schedule.target_time !== undefined && schedule.target_time !== null) {
      const cleanMin = schedule.target_time.toString().replace(':', '').trim();
      targetMinute = parseInt(cleanMin, 10);
      if (isNaN(targetMinute)) targetMinute = 0;
    }
    const late = (now.getMinutes() - targetMinute + 60) % 60;
    return late < CATCHUP_MINUTES ? late : null;
  }

  if (schedule.schedule_type === 'fixed_time') {
    const [h, m] = (schedule.target_time || '').substring(0, 5).split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    const late = now.getHours() * 60 + now.getMinutes() - (h * 60 + m);
    return late >= 0 && late < CATCHUP_MINUTES ? late : null;
  }

  return null;
}

/**
 * 該次排定時間點的識別字串 'YYYY-MM-DD HH:MM'，用來確保同一個時間點只執行一次。
 * 以「排定時間」而非「當下時間」為準，補播時才不會被當成新的一次。
 */
function getTriggerKey(late, now) {
  const t = new Date(now.getTime() - late * 60000);
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())} ${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
}

/**
 * 找出此刻到點、且該時間點尚未執行過的定時規則，並取出要播的曲目 (不標記已執行)。
 */
export function findDueFixedRule(now = new Date()) {
  const prioritySchedules = getAllSchedules()
    .filter((s) => (s.schedule_type === 'fixed_time' || s.schedule_type === 'hourly') && s.is_active)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  for (const sch of prioritySchedules) {
    if (!isScheduleActiveNow(sch, now)) continue;
    const key = getTriggerKey(getMinutesLate(sch, now), now);
    if (getLastRunKey(sch.id) === key) continue;

    const track = getNextTrackFromPlaylist(sch.playlist_id);
    if (!track) {
      logThrottled(
        `empty-${sch.id}-${key}`,
        `[Scheduler] 規則「${sch.title}」(${key}) 到點，但歌單 ${sch.playlist_id} 不存在或沒有可播的 mp3，已略過`
      );
      continue;
    }
    return { sch, track, key };
  }
  return null;
}

/**
 * 取得歌單資料夾下的所有 MP3 檔案清單。可傳歌單 id 或資料庫列。
 * 路徑一律經過 playlists.js 的 resolvePlaylistDir (與上傳、刪除同一個資料夾)；
 * 純讀取，資料夾不存在就回傳空陣列，不會建立目錄。
 */
export function getPlaylistTracksFromDisk(playlistOrId) {
  const dir = resolvePlaylistDir(playlistOrId);
  const folderName = path.basename(dir);
  return listMp3Files(playlistOrId).map((f) => ({
    filename: f,
    fullPath: path.join(dir, f),
    relativePath: `${folderName}/${f}`
  }));
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const compareFilenames = (a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true });

/**
 * 從指定歌單選取下一首曲目。
 *
 * - sequential：依檔名排序，接在「上一首播的檔名」之後；增刪檔案也能接續，不會跳號或重播。
 * - shuffle：每輪一次 Fisher-Yates 洗牌；資料夾內容 (不只是數量) 有變就重洗，
 *   改名或換檔後不會推出已不存在的路徑；新一輪的第一首不會與上一首相同。
 */
export function getNextTrackFromPlaylist(playlistId) {
  const playlist = getPlaylistById(playlistId);
  if (!playlist) return null;

  const tracks = getPlaylistTracksFromDisk(playlist);
  if (tracks.length === 0) return null;
  const byName = new Map(tracks.map((t) => [t.filename, t]));
  const names = [...byName.keys()].sort(compareFilenames);
  let state = playlistOrderState.get(playlistId);

  if (playlist.play_mode === 'sequential') {
    const last = state?.last;
    const next = (last && names.find((n) => compareFilenames(n, last) > 0)) || names[0];
    playlistOrderState.set(playlistId, { mode: 'sequential', last: next });
    return byName.get(next);
  }

  const signature = names.join('\n');
  if (!state || state.mode !== 'shuffle' || state.signature !== signature || state.index >= state.order.length) {
    const order = shuffleInPlace([...names]);
    if (order.length > 1 && order[0] === state?.last) {
      const j = 1 + Math.floor(Math.random() * (order.length - 1));
      [order[0], order[j]] = [order[j], order[0]];
    }
    state = { mode: 'shuffle', signature, order, index: 0, last: state?.last };
  }

  const selected = state.order[state.index];
  state.index += 1;
  state.last = selected;
  playlistOrderState.set(playlistId, state);
  return byName.get(selected);
}

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
  if (schedule.schedule_type === 'continuous' || schedule.schedule_type === 'interval') {
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

    // 檢查分鐘數 (例如 30 表示每小時第 30 分)；錯過時在補播窗口內仍算到點
    return getMinutesLate(schedule, now) !== null;
  }

  if (schedule.schedule_type === 'fixed_time') {
    // 若有指定單次日期
    if (schedule.target_date) {
      const currentDateStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
      if (schedule.target_date !== currentDateStr) return false;
    }

    return getMinutesLate(schedule, now) !== null;
  }

  return false;
}

/**
 * 一般輪播 (dynamic_queue) 的下一首：間隔插播 → 加權輪播 → 保底歌單。
 *
 * 定時規則 (fixed_time / hourly) 不在這裡處理 —— 它們由 checkAndFeedQueue 推進
 * priority_queue，才能在當前曲目結束後立刻播出，而不是排在預排的曲目後面。
 *
 * 間隔插播「每 X 首播 Y 首」：X 只計一般曲目 (插播本身不算)，到 X 首後連續插播 Y 首。
 */
export function decideNextTrack(now = new Date()) {
  const allSchedules = getAllSchedules();
  const activeIntervals = allSchedules.filter(
    (s) => s.schedule_type === 'interval' && s.interval_every_tracks > 0 && isScheduleActiveNow(s, now)
  );
  const intervalDecision = (sch, track) => ({
    track,
    playlistId: sch.playlist_id,
    schedule: sch,
    reason: 'interval',
    interruptMode: 'wait_track_end'
  });

  // 1. 「每 X 首播 Y 首」的第 2..Y 首
  if (pendingIntervalInsert) {
    const sch = activeIntervals.find((s) => s.id === pendingIntervalInsert.scheduleId);
    const track = sch ? getNextTrackFromPlaylist(sch.playlist_id) : null;
    if (track) {
      pendingIntervalInsert.remaining -= 1;
      if (pendingIntervalInsert.remaining <= 0) pendingIntervalInsert = null;
      return intervalDecision(sch, track);
    }
    pendingIntervalInsert = null; // 規則停用、離開時段或歌單空了：放棄剩下的插播
  }

  // 2. 間隔規則到點
  for (const sch of activeIntervals) {
    if ((intervalCounters.get(sch.id) || 0) < sch.interval_every_tracks) continue;
    const track = getNextTrackFromPlaylist(sch.playlist_id);
    if (!track) continue;
    intervalCounters.set(sch.id, 0);
    const playTracks = Math.max(1, Number(sch.interval_play_tracks) || 1);
    pendingIntervalInsert = playTracks > 1 ? { scheduleId: sch.id, remaining: playTracks - 1 } : null;
    return intervalDecision(sch, track);
  }

  const countRegularTrack = () => {
    for (const sch of activeIntervals) {
      intervalCounters.set(sch.id, (intervalCounters.get(sch.id) || 0) + 1);
    }
  };

  // 3. 常規輪播：依輪播權重 (Weights) 進行加權隨機抽選
  const activeContinuous = allSchedules.filter((s) => s.schedule_type === 'continuous' && isScheduleActiveNow(s, now));

  if (activeContinuous.length > 0) {
    const totalWeight = activeContinuous.reduce((sum, s) => sum + Math.max(1, s.weight || 1), 0);
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
      countRegularTrack();
      return {
        track,
        playlistId: selectedSchedule.playlist_id,
        schedule: selectedSchedule,
        reason: 'continuous',
        interruptMode: 'wait_track_end'
      };
    }
  }

  // 4. 若皆無符合，自第一個有檔案的啟用歌單保底
  const allPlaylists = getAllPlaylists().filter((p) => p.is_active);
  for (const pl of allPlaylists) {
    const track = getNextTrackFromPlaylist(pl.id);
    if (track) {
      countRegularTrack();
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

// 已推送到 Liquidsoap 兩條佇列、尚未播出的曲目 (每項帶 queue 欄位)。
// 排列順序 = 預計播出順序：priority_queue 的在前。
let plannedQueue = [];

// 只取數字 RID：佇列不存在時 Liquidsoap 回 "ERROR: unknown command ..."，不能當成 RID
function parseRids(output) {
  return output.replace(/END/g, '').trim().split(/\s+/).filter((r) => /^\d+$/.test(r));
}

const isUnknownCommand = (res) => /unknown command/i.test(res);

function upsertPlanned(item) {
  plannedQueue = plannedQueue.filter((i) => i.rid !== item.rid);
  plannedQueue.push(item);
  plannedQueue.sort((a, b) => (a.queue === b.queue ? 0 : a.queue === QUEUE.PRIORITY ? -1 : 1));
}

async function buildQueuedItem({ rid, queue, fullPath, playlistId, ruleTitle, scheduleType }) {
  const filename = path.basename(fullPath);
  const meta = await getAudioMetadata(fullPath).catch(() => null);
  const folderName = path.basename(path.dirname(fullPath));
  const playlist = playlistId
    ? getPlaylistById(playlistId)
    : getAllPlaylists().find((p) => path.basename(resolvePlaylistDir(p)) === folderName);
  return {
    rid,
    queue,
    filename,
    fullPath,
    title: meta?.title || filename.replace(/\.mp3$/i, ''),
    artist: meta?.artist || 'Unknown Artist',
    duration: meta?.duration || 0,
    playlistId: playlist?.id || 'A',
    playlistName: playlist?.name || '智慧歌單',
    playlistColor: playlist?.color || '#6366f1',
    ruleTitle,
    scheduleType
  };
}

/**
 * 等插播佇列的第一首解析完成 (立即插播在跳歌前呼叫)；逾時回傳 false。
 */
async function waitForPriorityReady(timeoutMs = PRIORITY_READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await sendTelnetCommand('radio.priority_ready')).trim() === 'true') return true;
    } catch {
      return false;
    }
    await sleep(100);
  }
  return false;
}

/**
 * 推送曲目到 Liquidsoap 佇列並登記到 plannedQueue；回傳 RID，失敗回傳 null。
 *
 * @param trackPathOrDecision decideNextTrack 的結果，或檔案完整路徑 (手動插播)
 * @param interruptMode 'immediate_fade' 會在插播曲目就緒後跳過目前曲目 (待播佇列保留)
 * @param options.queue QUEUE.DYNAMIC (一般輪播) 或 QUEUE.PRIORITY (插播)；
 *                      未指定時，立即插播走 priority_queue，其餘走 dynamic_queue
 */
export async function pushTrackToLiquidsoap(trackPathOrDecision, interruptMode = 'wait_track_end', options = {}) {
  try {
    const isDecisionObj = typeof trackPathOrDecision === 'object' && trackPathOrDecision.track;
    const trackPath = isDecisionObj ? trackPathOrDecision.track.fullPath : trackPathOrDecision;
    const immediate = interruptMode === 'immediate_fade';
    let queue = options.queue || (immediate ? QUEUE.PRIORITY : QUEUE.DYNAMIC);
    let legacyImmediate = false;

    let pushRes = await sendTelnetCommand(`${queue}.push ${trackPath}`);
    if (queue === QUEUE.PRIORITY && isUnknownCommand(pushRes)) {
      // Liquidsoap 還在跑舊版 radio.liq (沒有 priority_queue)：compose 更新 server 映像時
      // 不會重啟 liquidsoap。退回舊做法 —— 插播排進 dynamic_queue，立即模式先清空再推。
      logThrottled(
        'no-priority-queue',
        '[Scheduler] Liquidsoap 沒有 priority_queue (radio.liq 未更新或未重啟)，插播退回 dynamic_queue，會排在預排曲目之後。請重啟 liquidsoap 容器。',
        10 * 60 * 1000
      );
      queue = QUEUE.DYNAMIC;
      if (immediate) {
        await sendTelnetCommand(`${QUEUE.DYNAMIC}.flush_and_skip`);
        plannedQueue = plannedQueue.filter((i) => i.queue !== QUEUE.DYNAMIC);
        legacyImmediate = true;
      }
      pushRes = await sendTelnetCommand(`${queue}.push ${trackPath}`);
    }
    const rid = pushRes.replace(/END/g, '').trim();
    if (!/^\d+$/.test(rid)) {
      throw new Error(`Liquidsoap 回應非預期: ${rid}`);
    }
    console.log(`[Scheduler] Pushed track to ${queue}: ${trackPath} -> RID ${rid}`);

    upsertPlanned(
      await buildQueuedItem({
        rid,
        queue,
        fullPath: trackPath,
        playlistId: isDecisionObj ? trackPathOrDecision.playlistId : null,
        ruleTitle: isDecisionObj
          ? trackPathOrDecision.schedule?.title || (trackPathOrDecision.reason === 'interval' ? '間隔插播' : '智慧輪播')
          : options.ruleTitle || '手動插播',
        scheduleType: isDecisionObj ? trackPathOrDecision.reason : 'manual'
      })
    );

    if (immediate && !legacyImmediate) {
      const ready = await waitForPriorityReady();
      if (!ready) {
        console.warn('[Scheduler] 插播曲目逾時仍未就緒，照常跳歌');
      }
      await sendTelnetCommand('radio.skip');
      console.log('[Scheduler] Triggered immediate fade skip.');
    }

    return rid;
  } catch (err) {
    console.error(`[Scheduler] Failed to push track to Liquidsoap:`, err.message);
    return null;
  }
}

/**
 * 檢查並自動填充 Liquidsoap 的佇列 (定時插播進 priority_queue；dynamic_queue 維持 3 首待播)
 *
 * 5 秒巡檢、狀態 API (getUpcomingTracks)、skip 後的補隊列都會呼叫這裡；
 * 若上一輪還沒跑完 (Telnet 指令最長等 5 秒) 就直接略過，避免兩輪同時讀到
 * 「佇列不足」而各自重複推送。
 */
let isFeedingQueue = false;
export async function checkAndFeedQueue() {
  if (isFeedingQueue) return;
  isFeedingQueue = true;
  try {
    await feedQueueOnce();
  } finally {
    isFeedingQueue = false;
  }
}

/**
 * 讓 plannedQueue 與 Liquidsoap 實際佇列一致：移除已播出的，
 * 補回不認得的 RID (例如伺服器重啟後) —— 向 Liquidsoap 查回檔案路徑與元資料。
 * 回傳各佇列目前的 RID。
 */
async function syncPlannedQueue() {
  const rids = {};
  for (const queue of [QUEUE.PRIORITY, QUEUE.DYNAMIC]) {
    rids[queue] = parseRids(await sendTelnetCommand(`${queue}.queue`));
  }
  const alive = new Set([...rids[QUEUE.PRIORITY], ...rids[QUEUE.DYNAMIC]]);
  plannedQueue = plannedQueue.filter((item) => alive.has(item.rid));

  for (const queue of [QUEUE.PRIORITY, QUEUE.DYNAMIC]) {
    for (const rid of rids[queue]) {
      if (plannedQueue.some((item) => item.rid === rid)) continue;
      try {
        const metaRes = await sendTelnetCommand(`request.metadata ${rid}`);
        const fileMatch = metaRes.match(/filename="([^"]+)"/) || metaRes.match(/initial_uri="([^"]+)"/);
        if (fileMatch) {
          upsertPlanned(
            await buildQueuedItem({
              rid,
              queue,
              fullPath: fileMatch[1],
              playlistId: null,
              ruleTitle: queue === QUEUE.PRIORITY ? '插播佇列' : '排程佇列',
              scheduleType: 'queued'
            })
          );
        }
      } catch {
        // 忽略
      }
    }
  }
  return rids;
}

async function feedQueueOnce() {
  try {
    const rids = await syncPlannedQueue();

    // 優先檢查是否有到點定時插播 (fixed_time 或 hourly)；錯過排定分鐘時會在補播窗口內補上
    const due = findDueFixedRule(new Date());
    if (due) {
      const rid = await pushTrackToLiquidsoap(
        {
          track: due.track,
          playlistId: due.sch.playlist_id,
          schedule: due.sch,
          reason: due.sch.schedule_type
        },
        due.sch.interrupt_mode,
        { queue: QUEUE.PRIORITY }
      );

      if (rid) {
        // 推送成功才標記已執行；失敗則留在補播窗口內，下一輪巡檢重試
        markScheduleRun(due.sch.id, due.key);
        console.log(`[Scheduler] 觸發定時規則「${due.sch.title}」(${due.key}, ${due.sch.interrupt_mode})`);
      } else {
        logThrottled(`push-${due.sch.id}-${due.key}`, `[Scheduler] 定時規則「${due.sch.title}」推送失敗，將於補播窗口內重試`, 10000);
      }
      return;
    }

    // dynamic_queue 待播少於 3 首時，才調用決策引擎逐首補充
    // (避免在佇列充裕時無效推進 shuffle 索引與間隔計數)
    const dynamicRids = rids[QUEUE.DYNAMIC];
    while (dynamicRids.length < TARGET_QUEUE_LENGTH) {
      const decision = decideNextTrack();
      if (!decision) break;
      const rid = await pushTrackToLiquidsoap(decision, 'wait_track_end', { queue: QUEUE.DYNAMIC });
      if (!rid) break;
      dynamicRids.push(rid);
    }
  } catch (err) {
    // 不讓例外中斷巡檢迴圈，但要留下紀錄 (Telnet 離線時每分鐘最多印一次)
    logThrottled('feed-error', `[Scheduler] 補充佇列失敗: ${err.message}`);
  }
}

/**
 * 平滑切換至下一首曲目 (無爆音轉場)。
 * radio.skip 跳的是「目前播出中」的曲目，不論它來自插播、輪播或保底歌單。
 */
export async function skipCurrentTrack() {
  try {
    const queued = parseRids(await sendTelnetCommand(`${QUEUE.DYNAMIC}.queue`));
    if (queued.length === 0) {
      const decision = decideNextTrack();
      if (decision) {
        await pushTrackToLiquidsoap(decision, 'wait_track_end', { queue: QUEUE.DYNAMIC });
      }
    }

    const skipRes = await sendTelnetCommand('radio.skip');
    currentPlayingTitle = null;
    console.log(`[Scheduler] Smoothly skipped current track: ${skipRes}`);

    // 切換後立即補足隊列維持 3 首待播
    setTimeout(checkAndFeedQueue, 300);

    return skipRes;
  } catch (err) {
    console.error('[Scheduler] Failed to skip current track:', err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 播放歷史：由排程器巡檢記錄，不依賴有沒有人開著頁面 (舊版掛在 WebSocket 迴圈上，
// 沒有連線時整天都不記錄)。
// ---------------------------------------------------------------------------
const HISTORY_RETENTION_DAYS = parseInt(process.env.HISTORY_RETENTION_DAYS || '7', 10) || 7;
const HISTORY_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

let lastHistoryKey = null;
let historySeeded = false;
let isPollingNowPlaying = false;
let lastPruneAt = 0;

/** 由 Liquidsoap 回報的檔案路徑反查歌單 id；對不到就退回資料夾名稱 */
function resolveHistoryPlaylist(meta) {
  const filePath = meta.filename || meta.initial_uri || '';
  const folderName = path.basename(path.dirname(filePath));
  const playlist = getAllPlaylists().find((p) => path.basename(resolvePlaylistDir(p)) === folderName);
  return playlist?.id || folderName || 'A';
}

/**
 * 依「目前播出」的 metadata 記錄播放歷史；回傳這次是否新增了一筆。
 *
 * 以 Liquidsoap 的 request id (rid) 去重：同一首歌連播兩次 rid 不同，會各記一筆。
 * 重啟後的第一次只記下 key 不寫入 —— 當時正在播的那首在重啟前已經記過了。
 */
export function recordNowPlaying(meta) {
  if (!meta || !meta.title) return false;

  const key = meta.rid ? `rid:${meta.rid}` : `${meta.title}::${meta.artist || ''}`;
  if (!historySeeded) {
    historySeeded = true;
    lastHistoryKey = key;
    return false;
  }
  if (key === lastHistoryKey) return false;
  lastHistoryKey = key;

  recordTrackHistory({
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    playlist: resolveHistoryPlaylist(meta)
  });
  return true;
}

async function pollNowPlaying() {
  if (isPollingNowPlaying || !liquidsoap.isConnected) return;
  isPollingNowPlaying = true;
  try {
    recordNowPlaying(await liquidsoap.getMetadata());
  } catch (err) {
    logThrottled('history-error', `[Scheduler] 記錄播放歷史失敗: ${err.message}`);
  } finally {
    isPollingNowPlaying = false;
  }
}

function maybePruneHistory() {
  const nowMs = Date.now();
  if (nowMs - lastPruneAt < HISTORY_PRUNE_INTERVAL_MS) return;
  lastPruneAt = nowMs;
  try {
    const removed = pruneTrackHistory(HISTORY_RETENTION_DAYS);
    if (removed > 0) {
      console.log(`[Scheduler] 已清除 ${removed} 筆超過 ${HISTORY_RETENTION_DAYS} 天的播放歷史`);
    }
  } catch (err) {
    logThrottled('history-prune', `[Scheduler] 清除舊播放歷史失敗: ${err.message}`);
  }
}

async function autoDJTick() {
  await checkAndFeedQueue();
  await pollNowPlaying();
  maybePruneHistory();
}

/**
 * 啟動 AutoDJ 背景巡檢迴圈 (每 5 秒檢查一次)
 */
export function startAutoDJScheduler() {
  if (isAutoDJRunning) return;
  isAutoDJRunning = true;
  console.log('[Scheduler] AutoDJ Scheduling Engine started.');

  // 初始巡檢
  setTimeout(autoDJTick, 2000);

  autoDJTimer = setInterval(autoDJTick, 5000);
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
      rid: item.rid,
      playlistId: item.playlistId,
      playlistName: item.playlistName,
      playlistColor: item.playlistColor,
      filename: item.filename,
      title: item.title,
      artist: item.artist,
      duration: item.duration,
      ruleTitle: item.ruleTitle,
      scheduleType: item.scheduleType,
      isPriority: item.queue === QUEUE.PRIORITY
    }));
  } catch {
    return [];
  }
}

/**
 * 彙整整體廣播即時狀態 (提供 REST API 與 WebSocket 廣播)
 */
export async function getRadioStatus() {
  const [iceStats, metadata, remaining, upcomingRaw] = await Promise.all([
    icecast.getStats().catch(() => ({ online: false })),
    liquidsoap.getMetadata().catch(() => ({})),
    liquidsoap.getRemaining().catch(() => null),
    getUpcomingTracks(4).catch(() => [])
  ]);
  // 剛開始播的曲目在下一輪巡檢同步前仍留在 plannedQueue，用 on-air 的 rid 排除
  const upcomingTracks = upcomingRaw
    .filter((t) => !metadata.rid || t.rid !== metadata.rid)
    .slice(0, 3)
    .map(({ rid, ...t }, idx) => ({ ...t, order: idx + 1 }));

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
    const tracks = getPlaylistTracksFromDisk(p);
    return {
      id: p.id,
      name: p.name,
      description: p.description || '',
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

