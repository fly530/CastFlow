import React, { useState, useRef, useEffect } from 'react';
import {
  Sliders,
  Radio,
  ExternalLink,
  Activity,
  LogOut,
  KeyRound,
  UserCheck,
  LogIn,
  Users,
  FolderArchive,
  Headphones
} from 'lucide-react';

export default function Header({
  status,
  autoRefresh,
  setAutoRefresh,
  currentUser,
  onOpenLogin,
  onOpenChangePassword,
  onOpenBackups,
  onLogout,
  onSwitchToPlayer
}) {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  const liqConnected = status?.liquidsoap?.connected ?? false;
  const iceOnline = status?.icecast?.online ?? false;
  const listeners = status?.icecast?.listeners ?? 0;
  const listenerPeak = status?.icecast?.listenerPeak ?? 0;
  const bitrate = status?.icecast?.bitrate ?? 128;
  const mount = status?.icecast?.mount ?? 'stream';

  // 點擊選單外部自動關閉下拉
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur-xl sticky top-0 z-30 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col md:flex-row items-center justify-between gap-4">
        
        {/* 左側：Logo 與電台標題 */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center gap-2.5">
            <img src={`${import.meta.env.BASE_URL}admin.svg`} alt="CastFlow Admin" className="w-8 h-8 object-contain shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-white tracking-tight leading-none">
                  CastFlow 控制中心
                </h1>
                <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Admin
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 leading-none">雲原生廣播排程與資產管理面板</p>
            </div>
          </div>
        </div>

        {/* 右側：整合 Liquidsoap | Icecast | 在線聽眾之狀態欄與工具捷徑 + 最右側使用者頭像 */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-end flex-wrap">
          
          {/* 整合的 Liquidsoap | Icecast | 在線聽眾 核心狀態欄 */}
          <div className="flex items-center gap-2.5 bg-slate-950/90 border border-slate-800 rounded-2xl px-3 py-1.5 text-xs text-slate-300 shadow-inner flex-wrap">
            {/* 1. Liquidsoap 引擎狀態 */}
            <div className="flex items-center gap-1.5" title="Liquidsoap 廣播混音引擎 (Telnet: 1234)">
              <span
                className={`w-2 h-2 rounded-full ${
                  liqConnected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-rose-500'
                }`}
              />
              <span className="font-semibold text-slate-200">Liquidsoap</span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  liqConnected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
                }`}
              >
                {liqConnected ? '正常' : '未連線'}
              </span>
            </div>

            <span className="text-slate-700">|</span>

            {/* 2. Icecast 串流狀態 */}
            <div className="flex items-center gap-1.5" title={`Icecast 串流輸出: /${mount} (MP3 CBR)`}>
              <span
                className={`w-2 h-2 rounded-full ${
                  iceOnline ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-rose-500'
                }`}
              />
              <span className="font-semibold text-slate-200">Icecast</span>
              <span className="text-[10px] font-mono text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded">
                {bitrate} kbps
              </span>
            </div>

            <span className="text-slate-700">|</span>

            {/* 3. 在線聽眾 (純圖示 + 數值 + max 峰值) */}
            <div className="flex items-center gap-1.5" title={`在線聽眾 (max: ${listenerPeak})`}>
              <Users className="w-3.5 h-3.5 text-indigo-400" />
              <span className="font-bold text-white font-mono">{listeners}</span>
              <span className="text-[10px] text-slate-500 font-mono">(max {listenerPeak})</span>
            </div>
          </div>

          {/* 自動輪詢開關 */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-all ${
              autoRefresh
                ? 'bg-purple-600/10 border-purple-500/30 text-purple-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="控制是否每 8 秒自動輪詢電台狀態作為備援"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>自動更新 {autoRefresh ? '開' : '關'}</span>
          </button>

          {/* 開啟聽眾播放器 */}
          <button
            onClick={onSwitchToPlayer}
            className="flex items-center gap-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-lg shadow-purple-500/20 transition-all active:scale-95"
            title="切換至黑膠唱片聽眾播放器"
          >
            <Headphones className="w-3.5 h-3.5" />
            <span>聽眾前台</span>
          </button>

          {/* 最右側：精緻小型使用者頭像 */}
          <div className="relative ml-0.5" ref={userMenuRef}>
            {currentUser ? (
              <div>
                <button
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  title={`管理員: ${currentUser.username} (點擊展開選單)`}
                  className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white font-bold text-xs ring-2 ring-purple-500/40 hover:ring-purple-400 shadow-md shadow-purple-600/20 active:scale-95 transition-all relative group"
                >
                  <span>{currentUser.username.charAt(0).toUpperCase()}</span>
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-900 shadow-sm" />
                </button>

                {/* 使用者下拉選單 (貼齊右邊) */}
                {isUserMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="px-3 py-2 border-b border-slate-800 mb-1">
                      <div className="flex items-center gap-1.5 text-xs text-slate-400">
                        <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span>已登入管理身分</span>
                      </div>
                      <p className="text-xs font-bold text-white truncate mt-0.5">{currentUser.username}</p>
                    </div>

                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onOpenBackups?.();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-800/80 rounded-xl transition-all"
                    >
                      <FolderArchive className="w-3.5 h-3.5 text-indigo-400" />
                      <span>歌單排程備份</span>
                    </button>

                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onOpenChangePassword();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-800/80 rounded-xl transition-all"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-purple-400" />
                      <span>修改管理密碼</span>
                    </button>

                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onLogout();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl transition-all mt-0.5"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>登出管理身分</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={onOpenLogin}
                title="點擊登入管理員帳號"
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 flex items-center justify-center transition-all shadow-sm active:scale-95"
              >
                <LogIn className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

      </div>
    </header>
  );
}
