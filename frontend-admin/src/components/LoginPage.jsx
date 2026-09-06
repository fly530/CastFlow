import React, { useState } from 'react';
import { Sliders, Lock, KeyRound, User, AlertCircle, ShieldAlert, Radio, ArrowRight, Github } from 'lucide-react';
import { login } from '../utils/api.js';

export default function LoginPage({ onLoginSuccess }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

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
        onLoginSuccess?.(res.user, res.passwordNeedsChange);
      } else {
        setError(res.error || '帳號或密碼錯誤');
      }
    } catch (err) {
      setError(`連線異常: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-between items-center p-4 sm:p-6 text-slate-100 selection:bg-purple-500 selection:text-white relative overflow-hidden">
      {/* 背景光暈效果 */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-purple-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 translate-y-1/2 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />

      {/* 頂部簡易導覽 */}
      <div className="w-full max-w-5xl flex items-center justify-between z-10 py-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/20 ring-1 ring-white/20">
            <Sliders className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="text-sm font-bold tracking-tight text-white">CastFlow</span>
            <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded-md bg-purple-500/20 text-purple-300 font-mono font-semibold border border-purple-500/30">
              Admin
            </span>
          </div>
        </div>

        <a
          href="http://localhost:3000"
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-purple-300 transition-colors px-3 py-1.5 rounded-xl hover:bg-slate-900 border border-transparent hover:border-slate-800"
        >
          <Radio className="w-3.5 h-3.5" />
          <span>開啟聽眾播放器</span>
          <ArrowRight className="w-3 h-3" />
        </a>
      </div>

      {/* 中央登入卡片 */}
      <div className="w-full max-w-md my-auto z-10">
        <div className="rounded-3xl bg-slate-900/80 border border-slate-800 shadow-2xl backdrop-blur-xl p-7 sm:p-9">
          <div className="text-center pb-6 border-b border-slate-800/80">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center mx-auto shadow-xl shadow-purple-600/30 ring-4 ring-purple-500/10 mb-3">
              <Lock className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">管理員身分認證</h2>
            <p className="text-xs text-slate-400 mt-1">請輸入管理帳號密碼以進入 CastFlow 控制中心</p>
          </div>

          {error && (
            <div className="mt-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                管理員帳號
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-950/70 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-purple-500 transition-colors"
                  placeholder="預設帳號 admin"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                管理密碼
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-950/70 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-purple-500 transition-colors"
                  placeholder="請輸入密碼"
                />
              </div>
            </div>

            {/* 密碼提示提示卡 */}
            <div className="p-3.5 rounded-2xl bg-purple-950/30 border border-purple-800/30 text-purple-300/90 text-[11px] space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-purple-200">
                <ShieldAlert className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                <span>首次開機隨機密碼提示</span>
              </div>
              <p className="text-slate-400 text-[11px] leading-relaxed">
                系統於初次安裝開機時已在 SQLite 自動生成管理員強密碼。可於伺服器日誌查詢：
              </p>
              <code className="block font-mono text-[10px] bg-slate-950/90 p-2 rounded-lg text-purple-200 border border-purple-500/20 select-all overflow-x-auto">
                docker logs castflow-server | grep -E "Password|admin"
              </code>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-purple-600/25 active:scale-[0.99] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? '正在驗證身分...' : '登入管理後台'}
            </button>
          </form>
        </div>
      </div>

      {/* 頁尾 */}
      <div className="w-full max-w-5xl py-4 text-center text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2 z-10">
        <span>CastFlow Cloud-Native Automation Console © 2026.</span>
        <a
          href="https://github.com/fly530/CastFlow"
          target="_blank"
          rel="noreferrer"
          className="hover:text-slate-300 transition-colors flex items-center gap-1"
        >
          <Github className="w-3.5 h-3.5" />
          <span>GitHub Repository</span>
        </a>
      </div>
    </div>
  );
}
