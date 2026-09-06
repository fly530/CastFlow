import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

let db = null;

export function getDatabase() {
  if (!db) {
    const dbDir = process.env.DATA_DIR || process.env.MUSIC_DIR || path.resolve(process.cwd(), '../data');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = path.join(dbDir, 'radio.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

/**
 * 初始化資料庫表格與管理員預設帳密
 */
export function initDatabase() {
  const database = getDatabase();

  // 1. 使用者表格 (Admin 帳密驗證)
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. 播放歷史紀錄表格
  database.exec(`
    CREATE TABLE IF NOT EXISTS play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      playlist TEXT,
      played_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at DESC);
  `);

  // 3. 動態歌單表格
  database.exec(`
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL,
      description TEXT,
      color TEXT DEFAULT '#8b5cf6',
      play_mode TEXT DEFAULT 'shuffle',
      transition TEXT DEFAULT 'smart',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. 歌單智慧排程規則表格
  database.exec(`
    CREATE TABLE IF NOT EXISTS playlist_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      schedule_type TEXT NOT NULL,       -- 'continuous' | 'interval' | 'fixed_time'
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
    );
  `);

  // 初始化預設 A ~ G 歌單與基本排程
  const playlistCount = database.prepare('SELECT count(*) as count FROM playlists').get().count;
  if (playlistCount === 0) {
    const defaultPlaylists = [
      { id: 'A', name: '主力流行熱門 (A)', folder: 'A', color: '#3b82f6', desc: '全天主力播送歌單' },
      { id: 'B', name: '日常推薦精選 (B)', folder: 'B', color: '#10b981', desc: '日常插播熱門歌曲' },
      { id: 'C', name: '整點專屬插播 (C)', folder: 'C', color: '#f59e0b', desc: '整點台呼與精選短曲' },
      { id: 'D', name: '晚間溫馨插播 (D)', folder: 'D', color: '#8b5cf6', desc: '21:30 定時單曲' },
      { id: 'E', name: '深夜心情特輯 (E)', folder: 'E', color: '#ec4899', desc: '21:40 定時單曲' },
      { id: 'F', name: '睡前放鬆單曲 (F)', folder: 'F', color: '#06b6d4', desc: '21:50 定時單曲' },
      { id: 'G', name: '深夜爵士輪播 (G)', folder: 'G', color: '#6366f1', desc: '22:00 ~ 23:00 夜間放鬆' },
    ];

    const insertPl = database.prepare(`
      INSERT INTO playlists (id, name, folder, description, color, play_mode, transition, is_active)
      VALUES (@id, @name, @folder, @desc, @color, 'shuffle', 'smart', 1)
    `);

    for (const pl of defaultPlaylists) {
      insertPl.run(pl);
    }

    const insertSch = database.prepare(`
      INSERT INTO playlist_schedules (
        playlist_id, title, schedule_type, days_of_week, is_all_day,
        start_time, end_time, target_time, interrupt_mode, weight,
        interval_every_tracks, interval_play_tracks, is_active
      ) VALUES (
        @playlist_id, @title, @schedule_type, @days_of_week, @is_all_day,
        @start_time, @end_time, @target_time, @interrupt_mode, @weight,
        @interval_every_tracks, @interval_play_tracks, 1
      )
    `);

    // A: 全天輪播權重 3
    insertSch.run({
      playlist_id: 'A', title: '日常主力輪播 (權重 3)', schedule_type: 'continuous',
      days_of_week: '0,1,2,3,4,5,6', is_all_day: 1, start_time: null, end_time: null,
      target_time: null, interrupt_mode: 'wait_track_end', weight: 3,
      interval_every_tracks: 0, interval_play_tracks: 1
    });

    // B: 全天輪播權重 1 (3:1 輪流)
    insertSch.run({
      playlist_id: 'B', title: '日常精選插播 (權重 1)', schedule_type: 'continuous',
      days_of_week: '0,1,2,3,4,5,6', is_all_day: 1, start_time: null, end_time: null,
      target_time: null, interrupt_mode: 'wait_track_end', weight: 1,
      interval_every_tracks: 0, interval_play_tracks: 1
    });

    // C: 每 4 首歌插播 1 首
    insertSch.run({
      playlist_id: 'C', title: '每 4 首歌定時插播 1 首', schedule_type: 'interval',
      days_of_week: '0,1,2,3,4,5,6', is_all_day: 1, start_time: null, end_time: null,
      target_time: null, interrupt_mode: 'wait_track_end', weight: 1,
      interval_every_tracks: 4, interval_play_tracks: 1
    });

    // D: 21:30 定時插播
    insertSch.run({
      playlist_id: 'D', title: '21:30 定時插播', schedule_type: 'fixed_time',
      days_of_week: '0,1,2,3,4,5,6', is_all_day: 0, start_time: null, end_time: null,
      target_time: '21:30:00', interrupt_mode: 'wait_track_end', weight: 1,
      interval_every_tracks: 0, interval_play_tracks: 1
    });

    // E: 21:40 定時插播
    insertSch.run({
      playlist_id: 'E', title: '21:40 定時插播', schedule_type: 'fixed_time',
      days_of_week: '0,1,2,3,4,5,6', is_all_day: 0, start_time: null, end_time: null,
      target_time: '21:40:00', interrupt_mode: 'wait_track_end', weight: 1,
      interval_every_tracks: 0, interval_play_tracks: 1
    });

    // F: 21:50 定時插播
    insertSch.run({
      playlist_id: 'F', title: '21:50 定時插播', schedule_type: 'fixed_time',
      days_of_week: '0,1,2,3,4,5,6', is_all_day: 0, start_time: null, end_time: null,
      target_time: '21:50:00', interrupt_mode: 'wait_track_end', weight: 1,
      interval_every_tracks: 0, interval_play_tracks: 1
    });

    // G: 22:00 ~ 23:00 夜間輪播
    insertSch.run({
      playlist_id: 'G', title: '22:00 ~ 23:00 夜間放鬆', schedule_type: 'continuous',
      days_of_week: '0,1,2,3,4,5,6', is_all_day: 0, start_time: '22:00:00', end_time: '23:00:00',
      target_time: null, interrupt_mode: 'wait_track_end', weight: 1,
      interval_every_tracks: 0, interval_play_tracks: 1
    });
  }

  // 檢查是否已存在 admin 帳號
  const checkStmt = database.prepare('SELECT id, username FROM users WHERE username = ?');
  const existingAdmin = checkStmt.get('admin');

  if (!existingAdmin) {
    const initialPassword =
      process.env.ADMIN_PASSWORD || `cf_${crypto.randomBytes(6).toString('hex')}`;
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(initialPassword, salt);

    const insertStmt = database.prepare(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)'
    );
    insertStmt.run('admin', hash);

    console.log('\n' + '='.repeat(64));
    console.log(' [CastFlow Security] 管理員身分已自動建立 (Initial Admin Account):');
    console.log(`   帳號 (Username): admin`);
    console.log(`   密碼 (Password): ${initialPassword}`);
    console.log(`   管理後台: http://localhost/admin/ (或 http://localhost:3000/admin/)`);
    console.log(' 請妥善保存此密碼，登入後可於管理設定中隨時進行修改！');
    console.log('='.repeat(64) + '\n');
  }
}

/**
 * 依帳號查詢使用者
 */
export function findUserByUsername(username) {
  const database = getDatabase();
  const stmt = database.prepare('SELECT * FROM users WHERE username = ?');
  return stmt.get(username);
}

/**
 * 更新使用者密碼
 */
export function updateUserPassword(username, newPasswordHash) {
  const database = getDatabase();
  const stmt = database.prepare('UPDATE users SET password_hash = ? WHERE username = ?');
  return stmt.run(newPasswordHash, username);
}

/**
 * 記錄曲目播放歷史 (避免連續重複寫入同一首)
 */
let lastRecordedTitle = null;

export function recordTrackHistory(track) {
  if (!track || !track.title || track.title === 'CastFlow Station' || track.title === 'CastFlow Live' || track.title === 'KubeRadio Station' || track.title === 'KubeRadio Live') {
    return;
  }

  // 避免同一首歌重複紀錄
  const trackKey = `${track.title}::${track.artist}`;
  if (lastRecordedTitle === trackKey) {
    return;
  }
  lastRecordedTitle = trackKey;

  const database = getDatabase();
  const stmt = database.prepare(`
    INSERT INTO play_history (title, artist, album, playlist)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(
    track.title,
    track.artist || 'Unknown Artist',
    track.album || '',
    track.playlist || 'A'
  );
}

/**
 * 取得最近播放歷史紀錄
 */
export function getRecentHistory(limit = 10) {
  const database = getDatabase();
  const stmt = database.prepare(`
    SELECT id, title, artist, album, playlist, played_at
    FROM play_history
    ORDER BY played_at DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

// ==========================================
// 歌單 (Playlists) CRUD
// ==========================================
export function getAllPlaylists() {
  const database = getDatabase();
  return database.prepare('SELECT * FROM playlists ORDER BY id ASC').all();
}

export function getPlaylistById(id) {
  const database = getDatabase();
  return database.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
}

export function createPlaylist({ id, name, folder, description, color, play_mode, transition }) {
  const database = getDatabase();
  const stmt = database.prepare(`
    INSERT INTO playlists (id, name, folder, description, color, play_mode, transition, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);
  stmt.run(
    id,
    name,
    folder || id,
    description || '',
    color || '#8b5cf6',
    play_mode || 'shuffle',
    transition || 'smart'
  );
  return getPlaylistById(id);
}

export function updatePlaylist(id, data) {
  const database = getDatabase();
  const fields = [];
  const params = [];
  for (const [key, value] of Object.entries(data)) {
    if (['name', 'description', 'color', 'play_mode', 'transition', 'is_active'].includes(key)) {
      fields.push(`${key} = ?`);
      params.push(value);
    }
  }
  if (fields.length === 0) return getPlaylistById(id);
  params.push(id);
  database.prepare(`UPDATE playlists SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getPlaylistById(id);
}

export function deletePlaylist(id) {
  const database = getDatabase();
  database.prepare('DELETE FROM playlist_schedules WHERE playlist_id = ?').run(id);
  return database.prepare('DELETE FROM playlists WHERE id = ?').run(id);
}

// ==========================================
// 排程規則 (Schedules) CRUD
// ==========================================
export function getAllSchedules() {
  const database = getDatabase();
  return database.prepare(`
    SELECT s.*, p.name as playlist_name, p.folder as playlist_folder, p.color as playlist_color, p.transition as playlist_transition
    FROM playlist_schedules s
    JOIN playlists p ON s.playlist_id = p.id
    ORDER BY s.priority DESC, s.id ASC
  `).all();
}

export function getScheduleById(id) {
  const database = getDatabase();
  return database.prepare(`
    SELECT s.*, p.name as playlist_name, p.folder as playlist_folder, p.color as playlist_color
    FROM playlist_schedules s
    JOIN playlists p ON s.playlist_id = p.id
    WHERE s.id = ?
  `).get(id);
}

export function createSchedule(data) {
  const database = getDatabase();
  const stmt = database.prepare(`
    INSERT INTO playlist_schedules (
      playlist_id, title, schedule_type, days_of_week, is_all_day,
      start_time, end_time, target_time, target_date, interrupt_mode,
      weight, interval_every_tracks, interval_play_tracks, priority, is_active
    ) VALUES (
      @playlist_id, @title, @schedule_type, @days_of_week, @is_all_day,
      @start_time, @end_time, @target_time, @target_date, @interrupt_mode,
      @weight, @interval_every_tracks, @interval_play_tracks, @priority, 1
    )
  `);
  const info = stmt.run({
    playlist_id: data.playlist_id,
    title: data.title || '新排程',
    schedule_type: data.schedule_type || 'continuous',
    days_of_week: data.days_of_week || '0,1,2,3,4,5,6',
    is_all_day: data.is_all_day ? 1 : 0,
    start_time: data.start_time || null,
    end_time: data.end_time || null,
    target_time: data.target_time || null,
    target_date: data.target_date || null,
    interrupt_mode: data.interrupt_mode || 'wait_track_end',
    weight: Number(data.weight) || 1,
    interval_every_tracks: Number(data.interval_every_tracks) || 0,
    interval_play_tracks: Number(data.interval_play_tracks) || 1,
    priority: Number(data.priority) || 0
  });
  return getScheduleById(info.lastInsertRowid);
}

export function updateSchedule(id, data) {
  const database = getDatabase();
  const fields = [];
  const params = [];
  const allowed = [
    'title', 'playlist_id', 'schedule_type', 'days_of_week', 'is_all_day',
    'start_time', 'end_time', 'target_time', 'target_date', 'interrupt_mode',
    'weight', 'interval_every_tracks', 'interval_play_tracks', 'priority', 'is_active'
  ];
  for (const [key, value] of Object.entries(data)) {
    if (allowed.includes(key)) {
      fields.push(`${key} = ?`);
      params.push(value);
    }
  }
  if (fields.length === 0) return getScheduleById(id);
  params.push(id);
  database.prepare(`UPDATE playlist_schedules SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getScheduleById(id);
}

export function deleteSchedule(id) {
  const database = getDatabase();
  return database.prepare('DELETE FROM playlist_schedules WHERE id = ?').run(id);
}

/**
 * 從備份還原所有歌單與排程設定 (使用資料庫交易 Transaction)
 */
export function restorePlaylistsAndSchedules(playlists, schedules) {
  const database = getDatabase();
  const runTransaction = database.transaction((pls, schs) => {
    // 1. 清理現有排程與歌單
    database.prepare('DELETE FROM playlist_schedules').run();
    database.prepare('DELETE FROM playlists').run();

    // 2. 寫入備份歌單
    const insertPl = database.prepare(`
      INSERT INTO playlists (id, name, folder, description, color, play_mode, transition, is_active)
      VALUES (@id, @name, @folder, @description, @color, @play_mode, @transition, @is_active)
    `);
    for (const pl of pls) {
      insertPl.run({
        id: pl.id,
        name: pl.name,
        folder: pl.folder || pl.id,
        description: pl.description || '',
        color: pl.color || '#8b5cf6',
        play_mode: pl.play_mode || 'shuffle',
        transition: pl.transition || 'smart',
        is_active: pl.is_active !== undefined ? pl.is_active : 1
      });
    }

    // 3. 寫入備份排程
    const insertSch = database.prepare(`
      INSERT INTO playlist_schedules (
        playlist_id, title, schedule_type, days_of_week, is_all_day,
        start_time, end_time, target_time, target_date, interrupt_mode,
        weight, interval_every_tracks, interval_play_tracks, priority, is_active
      ) VALUES (
        @playlist_id, @title, @schedule_type, @days_of_week, @is_all_day,
        @start_time, @end_time, @target_time, @target_date, @interrupt_mode,
        @weight, @interval_every_tracks, @interval_play_tracks, @priority, @is_active
      )
    `);
    for (const sch of schs) {
      insertSch.run({
        playlist_id: sch.playlist_id,
        title: sch.title || '排程規則',
        schedule_type: sch.schedule_type || 'continuous',
        days_of_week: sch.days_of_week || '0,1,2,3,4,5,6',
        is_all_day: sch.is_all_day !== undefined ? Number(sch.is_all_day) : 1,
        start_time: sch.start_time || null,
        end_time: sch.end_time || null,
        target_time: sch.target_time || null,
        target_date: sch.target_date || null,
        interrupt_mode: sch.interrupt_mode || 'wait_track_end',
        weight: Number(sch.weight) || 1,
        interval_every_tracks: Number(sch.interval_every_tracks) || 0,
        interval_play_tracks: Number(sch.interval_play_tracks) || 1,
        priority: Number(sch.priority) || 0,
        is_active: sch.is_active !== undefined ? Number(sch.is_active) : 1
      });
    }
  });

  runTransaction(playlists, schedules);
  return true;
}


