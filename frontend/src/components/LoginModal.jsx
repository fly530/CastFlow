import React, { useState } from 'react';
import { Lock, KeyRound, User, AlertCircle, X, ShieldAlert } from 'lucide-react';
import { login } from '../utils/api.js';

export default function LoginModal({ isOpen, onClose, onSuccess }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password) {
      setError('請輸入管理員密碼');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const res = await login(username.trim(), password.trim());
      if (res.success) {
        onSuccess?.(res.user, res.passwordNeedsChange);
        onClose?.();
      } else {
        setError(res.error || '帳號或密碼錯誤');
      }
    } catch (err) {
      setError(`登入異常: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl p-6 sm:p-8 overflow-hidden">
        {/* 頂部圖示與標題 */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center shadow-inner">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">管理員身分認證</h3>
              <p className="text-xs text-slate-400">登入後即可執行控制與歌單維護</p>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              disabled={isLoading}
              className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* 錯誤提示 */}
        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 登入表單 */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              管理員帳號
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full pl-10 pr-3 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-purple-500 transition-colors"
                placeholder="預設帳號 admin"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              密碼
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                className="w-full pl-10 pr-3 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-purple-500 transition-colors"
                placeholder="輸入管理密碼"
              />
            </div>
          </div>

          {/* 密碼提示小卡 */}
          <div className="p-3 rounded-xl bg-purple-950/30 border border-purple-800/30 text-purple-300/80 text-[11px] flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-purple-400 flex-shrink-0 mt-0.5" />
            <span>
              首次啟動系統時已自動產生隨機強密碼。可在伺服器容器啟動日誌查看：
              <code className="block mt-1 font-mono text-[10px] bg-slate-950/80 p-1.5 rounded text-purple-200 border border-purple-500/20">
                docker logs castflow-server | grep -E "Password|admin"
              </code>
            </span>
          </div>

          {/* 送出按鈕 */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/25 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? '驗證中...' : '登入後台'}
          </button>
        </form>
      </div>
    </div>
  );
}
