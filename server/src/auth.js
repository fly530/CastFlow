import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { findUserByUsername, updateUserPassword } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'castflow_jwt_secret_key_2026';

/**
 * 簽發 JWT Token
 */
export function signJwtToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

/**
 * 驗證身分中介軟體 (保護 Admin 控制與檔案異動端點)
 */
export function requireAuth(req, res, next) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
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
