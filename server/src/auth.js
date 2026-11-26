import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { findUserByUsername, updateUserPassword } from './db.js';
import { createRateLimiter } from './rateLimit.js';

const JWT_SECRET = process.env.JWT_SECRET;

// 曾經或可能出現在文件、範本、教學裡的佔位字串。
// 只擋空值是不夠的：這些字串都在公開 repo 裡，任何人都查得到，
// 用它們當簽章金鑰等於沒有驗證 —— 而且「有設值」會讓人以為安全，比留空更危險。
const KNOWN_PLACEHOLDER_SECRETS = [
  'change-this-in-production-use-openssl-rand-hex-32',
  'castflow_jwt_secret_key_2026',
  'your_super_secret_jwt_key_please_change_with_openssl_rand_hex_32',
  'changeme',
  'change-me',
  'secret',
];

function rejectStartup(reason) {
  console.error('================================================================');
  console.error(' [FATAL SECURITY ERROR] JWT_SECRET ' + reason);
  console.error(' 為了防止管理權限遭非法偽造，CastFlow 拒絕啟動。');
  console.error(' 請提供高強度隨機金鑰：openssl rand -hex 32');
  console.error('================================================================');
  process.exit(1);
}

if (!JWT_SECRET || JWT_SECRET.trim() === '') {
  rejectStartup('未設定！');
}
if (KNOWN_PLACEHOLDER_SECRETS.includes(JWT_SECRET.trim().toLowerCase())) {
  rejectStartup('仍是文件中的公開佔位值，任何人都能偽造管理員憑證！');
}
if (JWT_SECRET.trim().length < 32) {
  rejectStartup('長度不足 32 字元，強度不夠！');
}

/**
 * 簽發 JWT Token
 */
export function signJwtToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

/** 依使用者資料簽發登入 token (帶入目前的 token_version) */
function signUserToken(user) {
  return signJwtToken({ id: user.id, username: user.username, tv: user.token_version ?? 0 });
}

// 登入失敗限流：同一個 IP 15 分鐘內最多嘗試 10 次，登入成功就歸零。
// 只依 IP、不依帳號：依帳號鎖會讓任何人都能把管理員鎖在門外。
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 10;
export const loginLimiter = createRateLimiter({ windowMs: LOGIN_WINDOW_MS, max: LOGIN_MAX_ATTEMPTS });

// 帳號不存在時也跑一次 bcrypt，回應時間才不會洩漏「這個帳號存在與否」
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

// 備份下載用的短效簽章網址。瀏覽器直接用 <a href> 下載，不必把整包 ZIP 讀進記憶體再轉 Blob；
// 但 <a href> 帶不了 Authorization header，所以改由網址上的 token 驗證。
// 用 JWT_SECRET 衍生的另一把金鑰簽：下載 token 外洩 (網址會出現在存取日誌) 也不能拿去當登入憑證，
// 登入 token 也不能塞進網址當下載 token。token 綁定檔名，2 分鐘內有效。
const DOWNLOAD_SECRET = crypto.createHmac('sha256', JWT_SECRET).update('castflow:backup-download').digest();
const DOWNLOAD_AUDIENCE = 'backup-download';
export const DOWNLOAD_TOKEN_TTL_SECONDS = 120;

export function signDownloadToken(filename) {
  return jwt.sign({ f: filename }, DOWNLOAD_SECRET, {
    expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS,
    audience: DOWNLOAD_AUDIENCE
  });
}

export function verifyDownloadToken(token, filename) {
  if (typeof token !== 'string' || !token) return false;
  try {
    const decoded = jwt.verify(token, DOWNLOAD_SECRET, { audience: DOWNLOAD_AUDIENCE });
    return decoded.f === filename;
  } catch {
    return false;
  }
}

/**
 * 驗證身分中介軟體 (保護 Admin 控制與檔案異動端點，僅接受 Authorization Header)
 */
export function requireAuth(req, res, next) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: '未提供授權憑證，請先登入管理員帳號'
    });
  }
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    decoded = null;
  }
  // 帳號還在、且 token 版本與資料庫一致 (改密碼後舊 token 失效)。
  // 改版前簽發的 token 沒有 tv，視為 0 —— 升級後不會把所有人登出，直到第一次改密碼。
  const user = decoded ? findUserByUsername(decoded.username) : null;
  if (!user || (decoded.tv ?? 0) !== (user.token_version ?? 0)) {
    return res.status(401).json({
      success: false,
      error: '登入憑證已失效或不合法，請重新登入'
    });
  }
  req.user = decoded;
  next();
}

/**
 * 使用者登入處理
 */
export async function loginUser(username, password) {
  if (!username || !password || typeof password !== 'string') {
    return { success: false, error: '請提供帳號與密碼' };
  }

  const user = typeof username === 'string' ? findUserByUsername(username) : null;
  // 非同步版 bcrypt：compareSync 每次會卡住 event loop 約 100ms，
  // 有人狂打登入時，WebSocket 推播與 AutoDJ 巡檢都會跟著停頓
  const isMatch = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !isMatch) {
    return { success: false, error: '帳號或密碼錯誤' };
  }

  const token = signUserToken(user);
  return {
    success: true,
    token,
    user: { id: user.id, username: user.username },
    passwordNeedsChange: Boolean(user.must_change_password)
  };
}

/**
 * 變更管理員密碼
 */
export async function changePassword(username, currentPassword, newPassword) {
  if (!currentPassword || typeof currentPassword !== 'string') {
    return { success: false, error: '請提供目前密碼' };
  }

  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    return { success: false, error: '新密碼長度至少需為 6 碼' };
  }

  const user = findUserByUsername(username);
  if (!user) {
    return { success: false, error: '使用者不存在' };
  }

  const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
  if (!isMatch) {
    return { success: false, error: '目前密碼不正確' };
  }

  const hash = await bcrypt.hash(newPassword, 10);
  updateUserPassword(username, hash);

  // 其他裝置上的舊 token 已隨 token_version 失效；回傳新 token 讓目前這個分頁繼續登入
  return { success: true, message: '密碼變更成功，其他裝置需要重新登入', token: signUserToken(findUserByUsername(username)) };
}
