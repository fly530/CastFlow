// =============================================================================
// 定時規則 (fixed_time / hourly) 的到點判斷與補播窗口。
//
// 用真的 SQLite 與真的歌單資料夾跑 findDueFixedRule，時間用「本地時間」建構，
// 所以不受執行環境時區影響。
//
// 執行：cd server && npm test
// =============================================================================
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

let tmp, db, scheduler, telnet;

// 2026-10-18 是星期日；本地時間 hh:mm:ss
const at = (h, m, s = 0) => new Date(2026, 9, 18, h, m, s);

function makeFixed(overrides = {}) {
  return db.createSchedule({
    playlist_id: 'T1',
    title: '測試定時',
    schedule_type: 'fixed_time',
    is_all_day: true,
    target_time: '21:50:00',
    interrupt_mode: 'immediate_fade',
    ...overrides
  });
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'castflow-sched-test-'));
  // 環境變數必須在 import 之前設好
  process.env.MUSIC_DIR = path.join(tmp, 'music');
  process.env.DATA_DIR = path.join(tmp, 'data');
  process.env.BACKUP_DIR = path.join(tmp, 'backups');
  process.env.JWT_SECRET = 'x'.repeat(64);
  for (const d of ['music', 'data', 'backups']) fs.mkdirSync(path.join(tmp, d), { recursive: true });

  db = await import(pathToFileURL(path.join(SRC, 'db.js')).href);
  // 模擬升級前的既有資料庫，確認 initDatabase 會補上日期區間欄位。
  db.getDatabase().exec(`
    CREATE TABLE playlist_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id TEXT NOT NULL,
      title TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      days_of_week TEXT DEFAULT '0,1,2,3,4,5,6',
      is_all_day INTEGER DEFAULT 1,
      start_time TEXT,
      end_time TEXT,
      target_time TEXT,
      target_date TEXT,
      interrupt_mode TEXT DEFAULT 'wait_track_end',
      weight INTEGER DEFAULT 1,
      interval_every_tracks INTEGER DEFAULT 4,
      interval_play_tracks INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.getDatabase().prepare(
    "INSERT INTO playlist_schedules (playlist_id, title, schedule_type) VALUES ('A', '舊規則', 'continuous')"
  ).run();
  db.initDatabase();
  const columns = db.getDatabase().pragma('table_info(playlist_schedules)').map((column) => column.name);
  assert.ok(columns.includes('active_from') && columns.includes('active_until'));
  const legacyRule = db.getDatabase().prepare("SELECT active_from, active_until FROM playlist_schedules WHERE title = '舊規則'").get();
  assert.deepEqual(legacyRule, { active_from: null, active_until: null });
  // 清掉預設種子規則，避免干擾
  db.getDatabase().prepare('DELETE FROM playlist_schedules').run();

  db.createPlaylist({ id: 'T1', name: '有歌', folder: 'T1', color: '#000', play_mode: 'sequential', transition: 'smart' });
  db.createPlaylist({ id: 'T2', name: '空歌單', folder: 'T2', color: '#000', play_mode: 'sequential', transition: 'smart' });
  fs.mkdirSync(path.join(tmp, 'music', 'T1'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'music', 'T1', 'song.mp3'), '');

  scheduler = await import(pathToFileURL(path.join(SRC, 'scheduler.js')).href);
  telnet = await import(pathToFileURL(path.join(SRC, 'telnet.js')).href);
});

after(() => {
  db?.getDatabase().close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// 各測試開頭自行清除，規則 id 為 AUTOINCREMENT 不會重用，所以排程器的記憶體快取不會互相污染
function clearSchedules() {
  db.getDatabase().prepare('DELETE FROM playlist_schedules').run();
  db.getDatabase().prepare('DELETE FROM schedule_runs').run();
}

describe('fixed_time 到點與補播窗口', () => {
  test('排定的那一分鐘：到點，key 為排定時間點', () => {
    clearSchedules();
    makeFixed();
    const due = scheduler.findDueFixedRule(at(21, 50, 4));
    assert.ok(due, '21:50 應該到點');
    assert.equal(due.key, '2026-10-18 21:50:00');
    assert.equal(due.track.filename, 'song.mp3');
  });

  test('晚 1 分鐘仍補播，且 key 與準時相同 (才不會被當成新的一次)', () => {
    clearSchedules();
    makeFixed();
    const due = scheduler.findDueFixedRule(at(21, 51, 30));
    assert.ok(due, '補播窗口內應該到點');
    assert.equal(due.key, '2026-10-18 21:50:00');
  });

  test('晚 2 分鐘以上放棄，不要很久以後才突然插播', () => {
    clearSchedules();
    makeFixed();
    assert.equal(scheduler.findDueFixedRule(at(21, 52, 0)), null);
    assert.equal(scheduler.findDueFixedRule(at(23, 10, 0)), null);
  });

  test('還沒到點不觸發', () => {
    clearSchedules();
    makeFixed();
    assert.equal(scheduler.findDueFixedRule(at(21, 49, 59)), null);
  });

  test('該時間點已有執行紀錄 (例如重啟前已播過) 就不重播', () => {
    clearSchedules();
    makeFixed();
    const rule = db.getAllSchedules()[0];
    db.setScheduleRunKey(rule.id, '2026-10-18 21:50:00');
    assert.equal(scheduler.findDueFixedRule(at(21, 50, 30)), null);
    assert.equal(scheduler.findDueFixedRule(at(21, 51, 30)), null);
  });

  test('升級前只有時分的執行紀錄也不重播', () => {
    clearSchedules();
    makeFixed();
    const rule = db.getAllSchedules()[0];
    db.setScheduleRunKey(rule.id, '2026-10-18 21:50');
    assert.equal(scheduler.findDueFixedRule(at(21, 50, 30)), null);
  });

  test('改了排定時間 = 新的時間點，不受舊紀錄影響', () => {
    clearSchedules();
    makeFixed({ target_time: '22:10:00' });
    const rule = db.getAllSchedules()[0];
    db.setScheduleRunKey(rule.id, '2026-10-18 21:50:00');
    assert.ok(scheduler.findDueFixedRule(at(22, 10, 5)));
  });

  test('指定單次日期不符時不觸發', () => {
    clearSchedules();
    makeFixed({ target_date: '2026-10-19' });
    assert.equal(scheduler.findDueFixedRule(at(21, 50, 5)), null);
  });

  test('星期不符時不觸發', () => {
    clearSchedules();
    makeFixed({ days_of_week: '1,2,3' }); // 2026-10-18 是星期日 (0)
    assert.equal(scheduler.findDueFixedRule(at(21, 50, 5)), null);
  });

  test('未啟用的規則不觸發', () => {
    clearSchedules();
    makeFixed();
    const rule = db.getAllSchedules()[0];
    db.getDatabase().prepare('UPDATE playlist_schedules SET is_active = 0 WHERE id = ?').run(rule.id);
    assert.equal(scheduler.findDueFixedRule(at(21, 50, 5)), null);
  });

  test('歌單是空的：不丟例外、回傳 null', () => {
    clearSchedules();
    makeFixed({ playlist_id: 'T2' });
    assert.equal(scheduler.findDueFixedRule(at(21, 50, 5)), null);
  });

  test('秒數精度：指定秒數前不觸發，指定秒數後兩分鐘內補播', () => {
    clearSchedules();
    makeFixed({ target_time: '21:50:45' });
    assert.equal(scheduler.findDueFixedRule(at(21, 50, 44)), null);
    assert.equal(scheduler.findDueFixedRule(at(21, 50, 45)).key, '2026-10-18 21:50:45');
    assert.equal(scheduler.findDueFixedRule(at(21, 52, 44)).key, '2026-10-18 21:50:45');
    assert.equal(scheduler.findDueFixedRule(at(21, 52, 45)), null);
  });

  test('23:59 的補播跨過午夜仍以排定日期及星期判斷', () => {
    clearSchedules();
    makeFixed({ target_time: '23:59:30', target_date: '2026-10-18', days_of_week: '0' });
    assert.equal(scheduler.findDueFixedRule(new Date(2026, 9, 19, 0, 0, 10)).key, '2026-10-18 23:59:30');
  });

  test('停用歌單的定時規則不選曲', () => {
    clearSchedules();
    makeFixed();
    db.updatePlaylist('T1', { is_active: 0 });
    assert.equal(scheduler.findDueFixedRule(at(21, 50, 0)), null);
    db.updatePlaylist('T1', { is_active: 1 });
  });
});

describe('hourly 到點與補播窗口', () => {
  test('每小時第 30 分準點與晚 1 分鐘都到點', () => {
    clearSchedules();
    db.createSchedule({ playlist_id: 'T1', title: '半點', schedule_type: 'hourly', is_all_day: true, target_time: '30' });
    assert.equal(scheduler.findDueFixedRule(at(14, 30, 2)).key, '2026-10-18 14:30:00');
    assert.equal(scheduler.findDueFixedRule(at(14, 31, 2)).key, '2026-10-18 14:30:00');
    assert.equal(scheduler.findDueFixedRule(at(14, 32, 0)), null);
  });

  test('第 59 分的補播跨過整點時，key 仍是前一小時的 59 分', () => {
    clearSchedules();
    db.createSchedule({ playlist_id: 'T1', title: '59分', schedule_type: 'hourly', is_all_day: true, target_time: '59' });
    assert.equal(scheduler.findDueFixedRule(at(12, 0, 10)).key, '2026-10-18 11:59:00');
  });

  test('第 59 分跨午夜補播仍以週日規則判斷', () => {
    clearSchedules();
    db.createSchedule({ playlist_id: 'T1', title: '週日59分', schedule_type: 'hourly',
      is_all_day: true, target_time: '59', days_of_week: '0' });
    assert.equal(scheduler.findDueFixedRule(new Date(2026, 9, 19, 0, 0, 10)).key, '2026-10-18 23:59:00');
  });

  test('時段區間外不觸發', () => {
    clearSchedules();
    db.createSchedule({
      playlist_id: 'T1', title: '整點', schedule_type: 'hourly', is_all_day: false,
      start_time: '11:00', end_time: '21:00', target_time: '00'
    });
    assert.ok(scheduler.findDueFixedRule(at(15, 0, 5)));
    assert.equal(scheduler.findDueFixedRule(at(22, 0, 5)), null);
  });
});

describe('生效日期區間', () => {
  test('不填日期永久生效；起日和迄日都包含當天', () => {
    clearSchedules();
    const rule = db.createSchedule({ playlist_id: 'T1', schedule_type: 'continuous' });
    assert.equal(rule.active_from, null);
    assert.equal(rule.active_until, null);
    assert.equal(scheduler.isScheduleActiveNow(rule, new Date(2030, 0, 1, 12)), true);
    db.updateSchedule(rule.id, { active_from: '2026-12-20', active_until: '2026-12-31' });
    const dated = db.getScheduleById(rule.id);
    assert.equal(scheduler.isScheduleActiveNow(dated, new Date(2026, 11, 19, 23, 59)), false);
    assert.equal(scheduler.isScheduleActiveNow(dated, new Date(2026, 11, 20, 0, 0)), true);
    assert.equal(scheduler.isScheduleActiveNow(dated, new Date(2026, 11, 31, 23, 59)), true);
    assert.equal(scheduler.isScheduleActiveNow(dated, new Date(2027, 0, 1, 0, 0)), false);
  });

  test('只填一端有效，且間隔規則也受日期限制', () => {
    clearSchedules();
    const rule = db.createSchedule({ playlist_id: 'T1', schedule_type: 'interval', active_from: '2026-12-20' });
    assert.equal(scheduler.isScheduleActiveNow(rule, new Date(2026, 11, 19, 12)), false);
    assert.equal(scheduler.isScheduleActiveNow(rule, new Date(2027, 0, 1, 12)), true);
    db.updateSchedule(rule.id, { active_from: null, active_until: '2026-12-31' });
    const untilOnly = db.getScheduleById(rule.id);
    assert.equal(scheduler.isScheduleActiveNow(untilOnly, new Date(2026, 11, 1, 12)), true);
    assert.equal(scheduler.isScheduleActiveNow(untilOnly, new Date(2027, 0, 1, 12)), false);
  });

  test('每小時與指定時間規則在日期區間外不觸發', () => {
    clearSchedules();
    db.createSchedule({ playlist_id: 'T1', schedule_type: 'hourly', target_time: '30',
      active_from: '2026-10-19' });
    assert.equal(scheduler.findDueFixedRule(at(14, 30, 0)), null);
    assert.ok(scheduler.findDueFixedRule(new Date(2026, 9, 19, 14, 30, 0)));
    clearSchedules();
    makeFixed({ active_from: '2026-10-18', active_until: '2026-10-18' });
    assert.ok(scheduler.findDueFixedRule(at(21, 50, 0)));
    assert.equal(scheduler.findDueFixedRule(new Date(2026, 9, 19, 21, 50, 0)), null);
  });

  test('跨午夜補播以排定日期套用結束日期', () => {
    clearSchedules();
    makeFixed({ target_time: '23:59:30', active_until: '2026-10-18' });
    assert.ok(scheduler.findDueFixedRule(new Date(2026, 9, 19, 0, 0, 10)));
  });

  test('日期格式、日曆有效性與逆向區間會被拒絕', () => {
    clearSchedules();
    assert.throws(() => db.createSchedule({ playlist_id: 'T1', active_from: '2026-02-30' }), RangeError);
    assert.throws(() => db.createSchedule({ playlist_id: 'T1', active_from: '2026-12-31', active_until: '2026-12-01' }), RangeError);
    const rule = db.createSchedule({ playlist_id: 'T1', active_from: '2026-12-20', active_until: '2026-12-31' });
    assert.throws(() => db.updateSchedule(rule.id, { active_from: '2027-01-01' }), RangeError);
  });
});

test('間隔規則以實際開始播放的一般曲目計數，並優先排入 Y 首', async () => {
  clearSchedules();
  db.createSchedule({ playlist_id: 'T1', title: '每四首插二首', schedule_type: 'interval',
    is_all_day: true, interval_every_tracks: 4, interval_play_tracks: 2 });
  const queues = { dynamic_queue: [], priority_queue: [] };
  let nextRid = 1000;
  const originalSend = telnet.liquidsoap.sendCommand;
  telnet.liquidsoap.sendCommand = async (command) => {
    const [name, action] = command.split(/[ .]/);
    if (action === 'queue') return queues[name].join(' ');
    if (action === 'push') {
      const rid = String(++nextRid);
      queues[name].push(rid);
      return rid;
    }
    if (command.startsWith('request.metadata')) return '';
    throw new Error(`Unexpected command: ${command}`);
  };
  try {
    const track = scheduler.getNextTrackFromPlaylist('T1');
    const rids = [];
    for (let i = 0; i < 4; i++) {
      rids.push(await scheduler.pushTrackToLiquidsoap({ track, playlistId: 'T1', reason: 'continuous' }));
    }
    await scheduler.checkAndFeedQueue();
    assert.equal(queues.priority_queue.length, 0, '預填待播佇列不得觸發間隔規則');
    for (const rid of rids) {
      scheduler.countStartedTrack({ rid });
      scheduler.countStartedTrack({ rid }); // 重複輪詢不能重複計數
    }
    await scheduler.checkAndFeedQueue();
    assert.equal(queues.priority_queue.length, 2);
    assert.equal((await scheduler.getUpcomingTracks())[0].scheduleType, 'interval');
    assert.equal((await scheduler.getUpcomingTracks())[1].scheduleType, 'interval');
  } finally {
    telnet.liquidsoap.sendCommand = originalSend;
  }
});

test('等待播畢插播進優先佇列；立即插播先入隊再切歌', async () => {
  const commands = [];
  let nextRid = 2000;
  const originalSend = telnet.liquidsoap.sendCommand;
  telnet.liquidsoap.sendCommand = async (command) => {
    commands.push(command);
    return command.includes('.push ') ? String(++nextRid) : 'OK';
  };
  try {
    const track = scheduler.getNextTrackFromPlaylist('T1');
    await scheduler.pushTrackToLiquidsoap({ track, playlistId: 'T1', reason: 'fixed_time' }, 'wait_track_end');
    assert.deepEqual(commands.map((c) => c.split(' ')[0]), ['priority_queue.push']);
    commands.length = 0;
    await scheduler.pushTrackToLiquidsoap({ track, playlistId: 'T1', reason: 'fixed_time' }, 'immediate_fade');
    assert.deepEqual(commands.map((c) => c.split(' ')[0]), ['priority_queue.push', 'radio.skip']);
  } finally {
    telnet.liquidsoap.sendCommand = originalSend;
  }
});

test('停用間隔規則後不再累計或排入插播', async () => {
  clearSchedules();
  const rule = db.createSchedule({ playlist_id: 'T1', title: '停用測試', schedule_type: 'interval',
    is_all_day: true, interval_every_tracks: 1, interval_play_tracks: 2 });
  const originalSend = telnet.liquidsoap.sendCommand;
  const queues = { dynamic_queue: [], priority_queue: [] };
  let nextRid = 3000;
  telnet.liquidsoap.sendCommand = async (command) => {
    const [name, action] = command.split(/[ .]/);
    if (action === 'queue') return queues[name].join(' ');
    if (action === 'push') {
      const rid = String(++nextRid);
      queues[name].push(rid);
      return rid;
    }
    if (command.startsWith('request.metadata')) return '';
    throw new Error(`Unexpected command: ${command}`);
  };
  try {
    db.updateSchedule(rule.id, { is_active: 0 });
    const track = scheduler.getNextTrackFromPlaylist('T1');
    const rid = await scheduler.pushTrackToLiquidsoap({ track, playlistId: 'T1', reason: 'continuous' });
    scheduler.countStartedTrack({ rid });
    await scheduler.checkAndFeedQueue();
    assert.equal(queues.priority_queue.length, 0);
  } finally {
    telnet.liquidsoap.sendCommand = originalSend;
  }
});

test('重啟後對舊佇列曲目不誤觸發間隔規則', async () => {
  clearSchedules();
  db.createSchedule({ playlist_id: 'T1', title: '重啟測試', schedule_type: 'interval',
    is_all_day: true, interval_every_tracks: 1, interval_play_tracks: 2 });
  const restarted = await import(`${pathToFileURL(path.join(SRC, 'scheduler.js')).href}?restart=${Date.now()}`);
  const originalSend = telnet.liquidsoap.sendCommand;
  const queues = { dynamic_queue: ['old-rid'], priority_queue: [] };
  let nextRid = 4000;
  telnet.liquidsoap.sendCommand = async (command) => {
    const [name, action] = command.split(/[ .]/);
    if (action === 'queue') return queues[name].join(' ');
    if (action === 'push') {
      const rid = String(++nextRid);
      queues[name].push(rid);
      return rid;
    }
    if (command.startsWith('request.metadata')) return '';
    throw new Error(`Unexpected command: ${command}`);
  };
  try {
    restarted.countStartedTrack({ rid: 'old-rid' });
    await restarted.checkAndFeedQueue();
    assert.equal(queues.priority_queue.length, 0);
  } finally {
    telnet.liquidsoap.sendCommand = originalSend;
  }
});

test('備份還原保留日期區間，舊備份缺欄位時維持永久生效', () => {
  clearSchedules();
  db.createSchedule({ playlist_id: 'T1', schedule_type: 'continuous',
    active_from: '2026-12-20', active_until: '2026-12-31' });
  const playlists = db.getAllPlaylists();
  const schedules = db.getAllSchedules();
  db.restorePlaylistsAndSchedules(playlists, schedules);
  assert.equal(db.getAllSchedules()[0].active_from, '2026-12-20');
  assert.equal(db.getAllSchedules()[0].active_until, '2026-12-31');

  const oldSchedules = schedules.map(({ active_from, active_until, ...schedule }) => schedule);
  db.restorePlaylistsAndSchedules(playlists, oldSchedules);
  assert.equal(db.getAllSchedules()[0].active_from, null);
  assert.equal(db.getAllSchedules()[0].active_until, null);
});
