import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { findUserByUsername, updateUserPassword } from './db.js';

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
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: '登入憑證已失效或不合法，請重新登入'
    });
  }
}

/**
 * 使用者登入處理
 */
export async function loginUser(username, password) {
  if (!username || !password || typeof password !== 'string') {
    return { success: false, error: '請提供帳號與密碼' };
  }

  const user = findUserByUsername(username);
  if (!user) {
    return { success: false, error: '帳號或密碼錯誤' };
  }

  const isMatch = bcrypt.compareSync(password, user.password_hash);
  if (!isMatch) {
    return { success: false, error: '帳號或密碼錯誤' };
  }

  const token = signJwtToken({ id: user.id, username: user.username });
  return {
    success: true,
    token,
    user: { id: user.id, username: user.username }
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

  const isMatch = bcrypt.compareSync(currentPassword, user.password_hash);
  if (!isMatch) {
    return { success: false, error: '目前密碼不正確' };
  }

  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(newPassword, salt);
  updateUserPassword(username, hash);

  return { success: true, message: '密碼變更成功' };
}
