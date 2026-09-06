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

export async function login(username, password) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok && data.success && data.token) {
      setToken(data.token);
      return { success: true, user: data.user, passwordNeedsChange: data.passwordNeedsChange };
    }
    return { success: false, error: data.error || '登入失敗' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function getMe() {
  try {
    const res = await authFetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      return data.user || null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function changePassword(oldPassword, newPassword) {
  try {
    const res = await authFetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: oldPassword, oldPassword, newPassword })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true, message: data.message };
    }
    return { success: false, error: data.error || '修改密碼失敗' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
