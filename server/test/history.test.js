// =============================================================================
// 播放歷史：記錄、去重與保留期限。
//
// 背景：舊版掛在 WebSocket 迴圈上 (沒人連線就整天不記錄)，且依標題去重
// (同一首連播兩次只留一筆)。現在改由排程器依 Liquidsoap 的 request id 記錄。
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

const rows = () => db.getDatabase().prepare('SELECT * FROM play_history ORDER BY id').all();
const clear = () => db.getDatabase().prepare('DELETE FROM play_history').run();

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'castflow-history-test-'));
  // 環境變數必須在 import 之前設好
  process.env.MUSIC_DIR = path.join(tmp, 'music');
  process.env.DATA_DIR = path.join(tmp, 'data');
  process.env.BACKUP_DIR = path.join(tmp, 'backups');
  process.env.JWT_SECRET = 'x'.repeat(64);
  for (const d of ['music', 'data', 'backups']) fs.mkdirSync(path.join(tmp, d), { recursive: true });

  db = await import(`${SRC}/db.js`);
  db.initDatabase();
  db.createPlaylist({ id: 'T1', name: '測試歌單', folder: 'TF', color: '#000', play_mode: 'sequential', transition: 'smart' });
  scheduler = await import(`${SRC}/scheduler.js`);
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('recordTrackHistory', () => {
  test('同一首歌連續記兩次就是兩筆 (去重是呼叫端的事，不再依標題)', () => {
    clear();
    db.recordTrackHistory({ title: '晚安再會', artist: 'A' });
    db.recordTrackHistory({ title: '晚安再會', artist: 'A' });
    assert.equal(rows().length, 2);
  });

  test('預設的站台佔位標題不記錄', () => {
    clear();
    db.recordTrackHistory({ title: 'CastFlow Live', artist: 'x' });
    db.recordTrackHistory({ title: '', artist: 'x' });
    assert.equal(rows().length, 0);
  });
});

describe('pruneTrackHistory', () => {
  test('只刪超過保留天數的紀錄，回傳刪除筆數', () => {
    clear();
    const ins = db.getDatabase().prepare(
      `INSERT INTO play_history (title, artist, played_at) VALUES (?, 'a', datetime('now', ?))`
    );
    ins.run('十天前', '-10 days');
    ins.run('八天前', '-8 days');
    ins.run('六天前', '-6 days');
    ins.run('剛剛', '-1 minutes');

    assert.equal(db.pruneTrackHistory(7), 2);
    assert.deepEqual(rows().map((r) => r.title), ['六天前', '剛剛']);
  });

  test('沒有過期資料時回傳 0', () => {
    assert.equal(db.pruneTrackHistory(7), 0);
  });
});

describe('recordNowPlaying (依 request id)', () => {
  const meta = (rid, title = '歌', extra = {}) => ({
    rid: String(rid),
    title,
    artist: '歌手',
    filename: '/music/TF/a.mp3',
    ...extra
  });

  test('第一次只記下目前播的那首，不寫入 (它在重啟前已記過)', () => {
    clear();
    assert.equal(scheduler.recordNowPlaying(meta(100)), false);
    assert.equal(rows().length, 0);
  });

  test('同一個 rid 重複輪詢不會重複寫入', () => {
    clear();
    assert.equal(scheduler.recordNowPlaying(meta(100)), false);
    assert.equal(scheduler.recordNowPlaying(meta(100)), false);
    assert.equal(rows().length, 0);
  });

  test('換成新的 rid 才寫入一筆，並由檔案資料夾反查歌單 id', () => {
    clear();
    assert.equal(scheduler.recordNowPlaying(meta(101, '新歌')), true);
    const r = rows();
    assert.equal(r.length, 1);
    assert.equal(r[0].title, '新歌');
    assert.equal(r[0].playlist, 'T1');
  });

  test('同一首歌連播兩次 (rid 不同) 要記兩筆', () => {
    clear();
    assert.equal(scheduler.recordNowPlaying(meta(102, '晚安再會')), true);
    assert.equal(scheduler.recordNowPlaying(meta(103, '晚安再會')), true);
    assert.equal(rows().length, 2);
  });

  test('找不到對應歌單時退回資料夾名稱；沒有標題的 metadata 忽略', () => {
    clear();
    assert.equal(scheduler.recordNowPlaying(meta(104, '外來歌', { filename: '/music/ZZ/b.mp3' })), true);
    assert.equal(rows()[0].playlist, 'ZZ');
    assert.equal(scheduler.recordNowPlaying({ rid: '105' }), false);
    assert.equal(scheduler.recordNowPlaying(null), false);
    assert.equal(rows().length, 1);
  });
});
