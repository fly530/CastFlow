// =============================================================================
// 針對 2026-09-06 修掉的四個安全問題的回歸測試。
//
// 這四項都是「加一道檢查」型的修正，最容易的回歸方式是有人覺得限制太嚴
// 而放寬它 —— 沒有測試就沒有東西會擋住。
//
// ★ 原則：測真正的程式碼路徑，不要在測試裡重寫一份清洗規則。
//   複製一份正規表示式來斷言，只證明那份副本正確，證明不了它有接上去。
//   所以底下用真的 SQLite、真的 express router、真的檔案系統。
//
// 執行：cd server && npm test
// =============================================================================
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

let tmp, playlists, db, auth, server, baseUrl, token;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'castflow-test-'));
  // 環境變數必須在 import 之前設好：auth.js 在模組載入時就讀 JWT_SECRET。
  process.env.MUSIC_DIR = path.join(tmp, 'music');
  process.env.DATA_DIR = path.join(tmp, 'data');
  process.env.BACKUP_DIR = path.join(tmp, 'backups');
  process.env.JWT_SECRET = 'x'.repeat(64);
  for (const d of ['music', 'data', 'backups']) fs.mkdirSync(path.join(tmp, d), { recursive: true });

  playlists = await import(`${SRC}/playlists.js`);
  db = await import(`${SRC}/db.js`);
  auth = await import(`${SRC}/auth.js`);
  db.initDatabase();

  const express = (await import('express')).default;
  const { router } = await import(`${SRC}/api.js`);
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  token = auth.signJwtToken({ id: 1, username: 'admin' });
});

after(() => {
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------
describe('① 命令注入', () => {
  test('server/src 不得再出現 execSync —— 字串參數會經過 shell', () => {
    const offenders = [];
    for (const f of fs.readdirSync(SRC).filter((f) => f.endsWith('.js'))) {
      const body = fs.readFileSync(path.join(SRC, f), 'utf8');
      // 只看實際呼叫，不看註解裡提到的名字
      for (const line of body.split('\n')) {
        if (/^\s*(\/\/|\*)/.test(line)) continue;
        if (/\bexecSync\s*\(/.test(line)) offenders.push(`${f}: ${line.trim()}`);
      }
    }
    assert.deepEqual(offenders, [], '請改用 execFileSync（參數陣列，不經 shell）');
  });

  test('execFileSync 不展開 shell metacharacter', () => {
    const evil = '/music/A/$(echo INJECTED).zip';
    const out = execFileSync('/bin/echo', [evil]).toString().trim();
    assert.equal(out, evil);
    assert.ok(!out.includes('INJECTED\n') && out.includes('$('), '指令替換被展開了');
  });
});

// -----------------------------------------------------------------------------
describe('② 路徑穿越', () => {
  const evil = '../../../../tmp/castflow-pwned';

  test('getPlaylistDir 不會跳出 MUSIC_DIR（資料庫已被污染時也一樣）', () => {
    // 直接寫進資料庫，繞過 API 層的清洗 —— 模擬既有的髒資料列
    db.createPlaylist({ id: 'dirty', name: 'dirty', folder: evil });
    const dir = playlists.getPlaylistDir('dirty');
    const base = path.resolve(process.env.MUSIC_DIR);
    assert.ok(path.resolve(dir).startsWith(base + path.sep), `逃出曲庫：${dir}`);
    assert.ok(!fs.existsSync('/tmp/castflow-pwned'));
  });

  test('不安全的 folder 退回歌單 id，不同歌單不得共用資料夾', () => {
    db.createPlaylist({ id: 'jazz', name: '爵士', folder: '爵士' });
    db.createPlaylist({ id: 'blues', name: '藍調', folder: '藍調' });
    assert.notEqual(playlists.getPlaylistDir('jazz'), playlists.getPlaylistDir('blues'));
  });

  test('POST /api/playlists 在寫入前就清洗 folder', async () => {
    const res = await fetch(`${baseUrl}/api/playlists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: 'evil', name: 'evil', folder: evil })
    });
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(!body.data.folder.includes('/'), `folder 未清洗：${body.data.folder}`);
    assert.ok(!body.data.folder.includes('..'), `folder 未清洗：${body.data.folder}`);
  });
});

// -----------------------------------------------------------------------------
describe('③ 任意檔案刪除', () => {
  test('只能刪 .mp3；其他副檔名一律拒絕', async () => {
    db.createPlaylist({ id: 'del', name: 'del', folder: 'del' });
    const dir = playlists.getPlaylistDir('del');
    const keep = path.join(dir, 'radio.db');
    const song = path.join(dir, 'song.mp3');
    fs.writeFileSync(keep, 'important');
    fs.writeFileSync(song, 'audio');

    assert.equal(await playlists.deleteTrack('del', 'radio.db'), false);
    assert.ok(fs.existsSync(keep), 'radio.db 被刪掉了');

    // 對照組：正常功能不能一起壞掉
    assert.equal(await playlists.deleteTrack('del', 'song.mp3'), true);
    assert.ok(!fs.existsSync(song), 'mp3 沒被刪除，功能壞了');
  });

  test('deleteTracks / moveTracks 同樣受限', async () => {
    const dir = playlists.getPlaylistDir('del');
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'x');
    const r = await playlists.deleteTracks('del', ['secret.txt']);
    assert.deepEqual(r.deleted, []);
    assert.ok(fs.existsSync(path.join(dir, 'secret.txt')));

    db.createPlaylist({ id: 'dst', name: 'dst', folder: 'dst' });
    const m = await playlists.moveTracks('del', 'dst', ['secret.txt']);
    assert.deepEqual(m.moved, []);
    assert.ok(fs.existsSync(path.join(dir, 'secret.txt')), '非 mp3 被移走了');
  });
});

// -----------------------------------------------------------------------------
describe('④ 容器不得以 root 執行', () => {
  const repo = path.resolve(SRC, '../..');
  const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');

  test('server/Dockerfile 指定非 root 使用者', () => {
    assert.match(read('server/Dockerfile'), /^USER\s+node$/m);
  });

  test('gateway 使用 nginx-unprivileged 且聽非特權埠', () => {
    assert.match(read('gateway/Dockerfile'), /FROM\s+nginxinc\/nginx-unprivileged/);
    assert.match(read('gateway/nginx.conf'), /listen\s+8080;/);
  });

  test('k8s 清單宣告 runAsNonRoot', () => {
    for (const f of ['k8s/60-server.yaml', 'k8s/70-gateway.yaml']) {
      assert.match(read(f), /runAsNonRoot:\s*true/, `${f} 缺少 runAsNonRoot`);
    }
  });

  test('共用 PVC 的兩個 Pod fsGroup 必須相同', () => {
    const get = (f) => read(f).match(/fsGroup:\s*(\d+)/)?.[1];
    assert.equal(get('k8s/60-server.yaml'), get('k8s/70-gateway.yaml'),
      'fsGroup 不同會讓兩邊互相 chgrp 同一個 radio-music-pvc');
    assert.ok(get('k8s/60-server.yaml'));
  });
});
