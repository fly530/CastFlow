// =============================================================================
// API 行為測試：用 app.js 的 createApp() (與正式環境相同的中介軟體與錯誤處理)，
// 真的 SQLite、真的檔案系統、真的 /usr/bin/unzip。
//
// 執行：cd server && npm test
// =============================================================================
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

let tmp, db, auth, backup, server, baseUrl, token;
const MUSIC = () => process.env.MUSIC_DIR;

/** 最小的 ZIP 產生器 (stored，不壓縮)：測試不依賴主機有沒有裝 zip 指令 */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 檔名
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

const authHeaders = (extra = {}) => ({ Authorization: `Bearer ${token}`, ...extra });
const jsonHeaders = () => authHeaders({ 'Content-Type': 'application/json' });

async function api(method, url, body) {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: jsonHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

async function upload(playlistId, files) {
  const form = new FormData();
  for (const [name, content] of Object.entries(files)) form.append('files', new Blob([content]), name);
  const res = await fetch(`${baseUrl}/api/playlists/${playlistId}/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: form
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'castflow-api-test-'));
  process.env.MUSIC_DIR = path.join(tmp, 'music');
  process.env.DATA_DIR = path.join(tmp, 'data');
  process.env.BACKUP_DIR = path.join(tmp, 'backups');
  process.env.JWT_SECRET = 'y'.repeat(64);
  delete process.env.ADMIN_PASSWORD;
  for (const d of ['music', 'data', 'backups']) fs.mkdirSync(path.join(tmp, d), { recursive: true });

  db = await import(`${SRC}/db.js`);
  auth = await import(`${SRC}/auth.js`);
  backup = await import(`${SRC}/backup.js`);
  db.initDatabase();
  const { createApp } = await import(`${SRC}/app.js`);
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  token = auth.signJwtToken({ id: 1, username: 'admin' });
});

after(() => {
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------
describe('曲目改名', () => {
  test('保留中文檔名 (舊版會變成底線)', async () => {
    fs.writeFileSync(path.join(MUSIC(), 'A', 'old.mp3'), 'a');
    const r = await api('PUT', '/api/playlists/A/tracks/old.mp3', { newFilename: '晴天 - 周杰倫' });
    assert.equal(r.status, 200);
    assert.equal(r.body.filename, '晴天 - 周杰倫.mp3');
    assert.ok(fs.existsSync(path.join(MUSIC(), 'A', '晴天 - 周杰倫.mp3')));
  });

  test('來源檔名不能穿越目錄，也不能改非 mp3', async () => {
    fs.writeFileSync(path.join(MUSIC(), 'B', 'keep.txt'), 'x');
    const traversal = await api('PUT', `/api/playlists/A/tracks/${encodeURIComponent('../B/keep.txt')}`, {
      newFilename: 'stolen'
    });
    assert.equal(traversal.status, 400);
    const notMp3 = await api('PUT', '/api/playlists/B/tracks/keep.txt', { newFilename: 'x' });
    assert.equal(notMp3.status, 400);
    assert.ok(fs.existsSync(path.join(MUSIC(), 'B', 'keep.txt')));
  });
});

// -----------------------------------------------------------------------------
describe('上傳', () => {
  test('ZIP：只解出 mp3 (不分大小寫)、攤平目錄、同名不覆蓋，並回報加入數量', async () => {
    const dir = path.join(MUSIC(), 'C');
    fs.writeFileSync(path.join(dir, 'dup.mp3'), 'original');
    const zip = makeZip({ 'sub/dup.mp3': 'new', 'LOUD.MP3': 'b', 'notes.txt': 'c' });
    const r = await upload('C', { 'pack.zip': zip });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([...r.body.files].sort(), ['LOUD.MP3', 'dup_1.mp3']);
    assert.equal(fs.readFileSync(path.join(dir, 'dup.mp3'), 'utf8'), 'original', '同名曲目被覆蓋');
    assert.ok(!fs.existsSync(path.join(dir, 'notes.txt')));
    assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.zip') || f.startsWith('.unzip-')), '殘留暫存檔');
  });

  test('非 mp3/zip 檔略過並回報，同一批的 mp3 照常加入', async () => {
    const r = await upload('C', { 'song.mp3': 'a', 'cover.jpg': 'b' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.files, ['song.mp3']);
    assert.deepEqual(r.body.skipped, ['cover.jpg']);
  });

  test('ZIP 內沒有 mp3：回報失敗而不是成功', async () => {
    const r = await upload('C', { 'empty.zip': makeZip({ 'a.txt': 'x' }) });
    assert.equal(r.status, 400);
    assert.equal(r.body.success, false);
  });
});

// -----------------------------------------------------------------------------
describe('排程驗證', () => {
  test('interval 的「每 X 首」不可為 0 或空白 (舊版存成 0，規則默默失效)', async () => {
    const r = await api('POST', '/api/schedules', {
      playlist_id: 'C', title: 'x', schedule_type: 'interval', is_all_day: 1, interval_every_tracks: ''
    });
    assert.equal(r.status, 400);
  });

  test('fixed_time 時間格式錯誤、歌單不存在都會擋下', async () => {
    const badTime = await api('POST', '/api/schedules', {
      playlist_id: 'D', title: 'x', schedule_type: 'fixed_time', target_time: '25:99'
    });
    assert.equal(badTime.status, 400);
    const noPlaylist = await api('POST', '/api/schedules', {
      playlist_id: 'nope', title: 'x', schedule_type: 'continuous', is_all_day: 1
    });
    assert.equal(noPlaylist.status, 400);
  });

  test('正規化：HH:MM 補秒數、布林轉 0/1，只送 is_active 的切換不受其他欄位影響', async () => {
    const created = await api('POST', '/api/schedules', {
      playlist_id: 'D', title: '定時', schedule_type: 'fixed_time', target_time: '21:30', is_all_day: true
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.data.target_time, '21:30:00');

    const toggled = await api('PUT', `/api/schedules/${created.body.data.id}`, { is_active: false });
    assert.equal(toggled.status, 200, JSON.stringify(toggled.body));
    assert.equal(toggled.body.data.is_active, 0);
    assert.equal(toggled.body.data.target_time, '21:30:00');
  });

  test('改成全天時清掉舊時段，不會留下看不到的限定時段', async () => {
    const created = await api('POST', '/api/schedules', {
      playlist_id: 'C', title: '間隔', schedule_type: 'interval', is_all_day: 0,
      start_time: '08:00', end_time: '22:00', interval_every_tracks: 4
    });
    const updated = await api('PUT', `/api/schedules/${created.body.data.id}`, { is_all_day: 1 });
    assert.equal(updated.body.data.start_time, null);
    assert.equal(updated.body.data.end_time, null);
  });
});

// -----------------------------------------------------------------------------
describe('備份還原', () => {
  const playlistsPayload = (folder) => ({
    playlists: [{ id: 'A', name: 'A', folder, tracks: Array.from({ length: 6000 }, (_, i) => `track-${i}-padding-padding.mp3`) }],
    schedules: [
      { playlist_id: 'A', title: '輪播', schedule_type: 'continuous' },
      { playlist_id: 'ghost', title: '孤兒', schedule_type: 'continuous' }
    ]
  });

  test('上傳還原：超過 100kb 的備份也能還原 (express.json 預設上限)', async () => {
    const payload = playlistsPayload('A');
    assert.ok(JSON.stringify(payload).length > 150 * 1024);
    const r = await api('POST', '/api/backups/restore-data', payload);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.schedulesSkipped, 1);
  });

  test('還原寫入資料庫前清洗 folder，不能跳出 MUSIC_DIR', async () => {
    const r = await api('POST', '/api/backups/restore-data', playlistsPayload('../../../../tmp/castflow-restore-pwned'));
    assert.equal(r.status, 200);
    const folder = db.getPlaylistById('A').folder;
    assert.ok(!folder.includes('/') && !folder.includes('..'), `folder 未清洗：${folder}`);
    assert.ok(!fs.existsSync('/tmp/castflow-restore-pwned'));
  });

  test('完整備份 ZIP 以內附的設定檔還原，而不是 backups 資料夾裡最新的 JSON', () => {
    const zipName = 'castflow_full_backup_test.zip';
    const config = {
      playlists: [{ id: 'Z', name: '來自 ZIP', folder: 'Z' }],
      schedules: [{ playlist_id: 'Z', title: 'ZIP 排程', schedule_type: 'continuous' }]
    };
    fs.writeFileSync(
      path.join(process.env.BACKUP_DIR, zipName),
      makeZip({ 'castflow-backup.json': JSON.stringify(config), 'Z/zip-song.mp3': 'audio' })
    );
    // 干擾項：較新的、內容不同的 JSON 備份
    backup.createBackup();

    const result = backup.restoreBackupFile(zipName);
    assert.equal(result.playlistsRestored, 1);
    assert.deepEqual(db.getAllPlaylists().map((p) => p.id), ['Z']);
    assert.ok(fs.existsSync(path.join(MUSIC(), 'Z', 'zip-song.mp3')));
    assert.ok(!fs.existsSync(path.join(MUSIC(), 'castflow-backup.json')), '設定檔不該解到曲庫裡');
  });

  test('舊版 ZIP (沒有內附設定)：只還原音訊，不套用不相干的 JSON', () => {
    const zipName = 'castflow_full_backup_legacy.zip';
    fs.writeFileSync(path.join(process.env.BACKUP_DIR, zipName), makeZip({ 'Z/legacy.mp3': 'audio' }));
    const before = db.getAllPlaylists().map((p) => p.id);
    const result = backup.restoreBackupFile(zipName);
    assert.equal(result.configRestored, false);
    assert.deepEqual(db.getAllPlaylists().map((p) => p.id), before);
    assert.ok(fs.existsSync(path.join(MUSIC(), 'Z', 'legacy.mp3')));
  });

  test('完整備份 ZIP 內附設定檔', { skip: !fs.existsSync('/usr/bin/zip') && '主機沒有 /usr/bin/zip' }, () => {
    const result = backup.createFullZipBackup();
    const listing = fs.readFileSync(result.path);
    assert.ok(listing.includes(Buffer.from('castflow-backup.json')));
  });
});

// -----------------------------------------------------------------------------
describe('驗證與錯誤處理', () => {
  test('播放日誌的查詢與清空需要登入 (含聽眾 IP)', async () => {
    assert.equal((await fetch(`${baseUrl}/api/logs/playback`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/logs/playback`, { method: 'DELETE' })).status, 401);
    // 聽眾端的回報維持公開
    const post = await fetch(`${baseUrl}/api/logs/playback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'TEST' })
    });
    assert.equal(post.status, 200);
  });

  test('JSON 格式錯誤回 400 而不是 500', async () => {
    const res = await fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: '{bad json'
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).success, false);
  });

  test('系統產生初始密碼時，登入回報需要改密碼；改過之後就不再提示', async () => {
    const { findUserByUsername } = db;
    assert.equal(findUserByUsername('admin').must_change_password, 1);
    const bcrypt = (await import('bcryptjs')).default;
    db.updateUserPassword('admin', bcrypt.hashSync('temp-pass-1', 4));
    db.getDatabase().prepare('UPDATE users SET must_change_password = 1').run();

    const login = await auth.loginUser('admin', 'temp-pass-1');
    assert.equal(login.passwordNeedsChange, true);
    const changed = await auth.changePassword('admin', 'temp-pass-1', 'new-pass-2');
    assert.equal(changed.success, true);
    assert.equal((await auth.loginUser('admin', 'new-pass-2')).passwordNeedsChange, false);
  });
});

// -----------------------------------------------------------------------------
describe('備份下載連結', () => {
  const name = 'castflow-full-backup-test.zip';
  before(() => {
    fs.writeFileSync(path.join(process.env.BACKUP_DIR, name), 'zip-bytes');
    fs.writeFileSync(path.join(process.env.BACKUP_DIR, 'other.zip'), 'other');
  });

  const linkFor = async (filename) => {
    const r = await api('POST', `/api/backups/${encodeURIComponent(filename)}/download-link`);
    return r;
  };

  test('短效連結不用 Authorization header 就能下載，且帶正確的下載檔名', async () => {
    const r = await linkFor(name);
    assert.equal(r.status, 200);
    const res = await fetch(`${baseUrl}${r.body.url}`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'zip-bytes');
    assert.match(res.headers.get('content-disposition'), /attachment; filename="castflow-full-backup-test\.zip"/);
    assert.equal(res.headers.get('content-type'), 'application/zip');
  });

  test('連結綁定檔名：不能拿去下載別的備份', async () => {
    const r = await linkFor(name);
    const token = new URL(r.body.url, baseUrl).searchParams.get('token');
    const res = await fetch(`${baseUrl}/api/backups/other.zip/download?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 401);
  });

  test('下載 token 不能當登入憑證，登入 token 也不能放進網址下載', async () => {
    const r = await linkFor(name);
    const dlToken = new URL(r.body.url, baseUrl).searchParams.get('token');
    const asBearer = await fetch(`${baseUrl}/api/backups`, { headers: { Authorization: `Bearer ${dlToken}` } });
    assert.equal(asBearer.status, 401);
    const loginInUrl = await fetch(`${baseUrl}/api/backups/${name}/download?token=${encodeURIComponent(token)}`);
    assert.equal(loginInUrl.status, 401);
  });

  test('取得連結需要登入；不存在的檔案回 404；原本用 header 下載的方式照常可用', async () => {
    const anon = await fetch(`${baseUrl}/api/backups/${name}/download-link`, { method: 'POST' });
    assert.equal(anon.status, 401);
    assert.equal((await linkFor('nope.zip')).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/backups/${name}/download`)).status, 401);
    const withHeader = await fetch(`${baseUrl}/api/backups/${name}/download`, { headers: authHeaders() });
    assert.equal(withHeader.status, 200);
  });
});
