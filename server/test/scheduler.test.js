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
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

let tmp, db, scheduler;

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

  db = await import(`${SRC}/db.js`);
  db.initDatabase();
  // 清掉預設種子規則，避免干擾
  db.getDatabase().prepare('DELETE FROM playlist_schedules').run();

  db.createPlaylist({ id: 'T1', name: '有歌', folder: 'T1', color: '#000', play_mode: 'sequential', transition: 'smart' });
  db.createPlaylist({ id: 'T2', name: '空歌單', folder: 'T2', color: '#000', play_mode: 'sequential', transition: 'smart' });
  fs.mkdirSync(path.join(tmp, 'music', 'T1'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'music', 'T1', 'song.mp3'), '');

  scheduler = await import(`${SRC}/scheduler.js`);
});

after(() => {
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
    assert.equal(due.key, '2026-10-18 21:50');
    assert.equal(due.track.filename, 'song.mp3');
  });

  test('晚 1 分鐘仍補播，且 key 與準時相同 (才不會被當成新的一次)', () => {
    clearSchedules();
    makeFixed();
    const due = scheduler.findDueFixedRule(at(21, 51, 30));
    assert.ok(due, '補播窗口內應該到點');
    assert.equal(due.key, '2026-10-18 21:50');
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
    db.setScheduleRunKey(rule.id, '2026-10-18 21:50');
    assert.equal(scheduler.findDueFixedRule(at(21, 50, 30)), null);
    assert.equal(scheduler.findDueFixedRule(at(21, 51, 30)), null);
  });

  test('改了排定時間 = 新的時間點，不受舊紀錄影響', () => {
    clearSchedules();
    makeFixed({ target_time: '22:10:00' });
    const rule = db.getAllSchedules()[0];
    db.setScheduleRunKey(rule.id, '2026-10-18 21:50');
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
});

describe('hourly 到點與補播窗口', () => {
  test('每小時第 30 分準點與晚 1 分鐘都到點', () => {
    clearSchedules();
    db.createSchedule({ playlist_id: 'T1', title: '半點', schedule_type: 'hourly', is_all_day: true, target_time: '30' });
    assert.equal(scheduler.findDueFixedRule(at(14, 30, 2)).key, '2026-10-18 14:30');
    assert.equal(scheduler.findDueFixedRule(at(14, 31, 2)).key, '2026-10-18 14:30');
    assert.equal(scheduler.findDueFixedRule(at(14, 32, 0)), null);
  });

  test('第 59 分的補播跨過整點時，key 仍是前一小時的 59 分', () => {
    clearSchedules();
    db.createSchedule({ playlist_id: 'T1', title: '59分', schedule_type: 'hourly', is_all_day: true, target_time: '59' });
    assert.equal(scheduler.findDueFixedRule(at(12, 0, 10)).key, '2026-10-18 11:59');
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
