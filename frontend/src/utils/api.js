// API 與 JWT 驗證輔助函式庫

const TOKEN_KEY = 'castflow_jwt';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || localStorage.getItem('kuberadio_jwt');
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('kuberadio_jwt');
  }
  window.dispatchEvent(new Event('castflow_auth_change'));
  window.dispatchEvent(new Event('kuberadio_auth_change'));
}

export async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (response.status === 401) {
    // 權限過期或無效
    setToken(null);
  }

  return response;
}

/**
 * 解析 API 回應的 JSON。nginx 的 413、502 等錯誤頁是 HTML，直接 res.json()
 * 只會得到「Unexpected token <」；這裡改成回傳一個看得懂的錯誤物件。
 */
export async function readJson(res) {
  try {
    return await res.json();
  } catch {
    const reason =
      res.status === 413 ? '上傳內容超過伺服器大小上限' : res.status >= 500 ? '伺服器暫時無法回應' : '伺服器回應格式異常';
    return { success: false, error: `${reason} (HTTP ${res.status})` };
  }
}

export async function login(username, password) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await readJson(res);
    if (res.ok && data.success && data.token) {
      setToken(data.token);
      const passwordNeedsChange = Boolean(data.passwordNeedsChange);
      return { success: true, user: { ...data.user, passwordNeedsChange }, passwordNeedsChange };
    }
    return { success: false, error: data.error || '登入失敗' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 查詢目前登入身分。
 * 回傳 { status: 'ok', user } / { status: 'unauthorized' } / { status: 'error' }；
 * 呼叫端要區分「token 失效」與「網路暫時斷線」—— 後者不該把人登出。
 */
export async function getMe() {
  try {
    const res = await authFetch('/api/auth/me');
    if (res.status === 401) return { status: 'unauthorized' };
    if (!res.ok) return { status: 'error' };
    const data = await readJson(res);
    if (!data.user) return { status: 'error' };
    return { status: 'ok', user: { ...data.user, passwordNeedsChange: Boolean(data.passwordNeedsChange) } };
  } catch {
    return { status: 'error' };
  }
}

export async function changePassword(oldPassword, newPassword) {
  try {
    const res = await authFetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: oldPassword, oldPassword, newPassword })
    });
    const data = await readJson(res);
    if (res.ok && data.success) {
      return { success: true, message: data.message };
    }
    return { success: false, error: data.error || '修改密碼失敗' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
