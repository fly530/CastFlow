import React, { useState, useRef, useEffect } from 'react';
import {
  FastForward,
  RefreshCw,
  RotateCw,
  Check,
  Radio,
  Terminal,
  Volume2,
  VolumeX,
  Play,
  Pause,
  ListMusic,
  Clock
} from 'lucide-react';

export default function NowPlayingControl({
  currentTrack,
  upcomingTracks = [],
  bitrate = 256,
  onSkip,
  onReload,
  onOpenConsole
}) {
  const [isSkipping, setIsSkipping] = useState(false);
  const [skipSuccess, setSkipSuccess] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isLoadingMonitor, setIsLoadingMonitor] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);

  const audioRef = useRef(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  const toggleMonitoring = () => {
    if (!audioRef.current) return;
    if (isMonitoring || isLoadingMonitor) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
      setIsMonitoring(false);
      setIsLoadingMonitor(false);
    } else {
      setIsLoadingMonitor(true);
      // 加上時間戳避免快取舊串流，立即開啟緩衝
      audioRef.current.src = `/stream?nocache=${Date.now()}`;
      audioRef.current.play().catch((err) => {
        console.warn('Audio monitor play blocked:', err);
        setIsLoadingMonitor(false);
        setIsMonitoring(false);
      });
    }
  };

  const formatTime = (seconds) => {
    if (seconds === null || seconds === undefined || isNaN(seconds)) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleSkip = async () => {
    try {
      setIsSkipping(true);
      setSkipSuccess(false);
      const startTime = Date.now();
      await onSkip();
      // 保證至少 800ms 的轉場視覺反饋，避免閃爍過快讓人感覺無反應
      const elapsed = Date.now() - startTime;
      if (elapsed < 800) {
        await new Promise((r) => setTimeout(r, 800 - elapsed));
      }
      setSkipSuccess(true);
      setTimeout(() => setSkipSuccess(false), 2000);
    } finally {
      setIsSkipping(false);
    }
  };

  const handleReload = async () => {
    try {
      setIsReloading(true);
      await onReload();
    } finally {
      setIsReloading(false);
    }
  };

  const coverUrl = `/api/current/cover?t=${Math.floor(Date.now() / 10000)}`;

  // 預設未來 3 首曲目（若後端尚未計算出，則顯示友善排程指示）
  const displayUpcoming = upcomingTracks && upcomingTracks.length > 0
    ? upcomingTracks.slice(0, 3)
    : [
        { order: 1, title: '智慧排程計算中...', artist: 'AutoDJ Engine', playlistName: '即將輪播', playlistColor: '#8b5cf6', ruleTitle: '自動排程' },
        { order: 2, title: '準備下一首曲目...', artist: 'AutoDJ Engine', playlistName: '即將輪播', playlistColor: '#3b82f6', ruleTitle: '自動排程' },
        { order: 3, title: '準備下一首曲目...', artist: 'AutoDJ Engine', playlistName: '即將輪播', playlistColor: '#10b981', ruleTitle: '自動排程' }
      ];

  return (
    <div className="rounded-3xl bg-slate-900/60 border border-slate-800/80 p-6 sm:p-8 backdrop-blur-xl mb-8 shadow-xl">
      {/* 隱藏原生 Audio 物件用於實時監聽電台串流 */}
      <audio
        ref={audioRef}
        onWaiting={() => setIsLoadingMonitor(true)}
        onPlaying={() => {
          setIsLoadingMonitor(false);
          setIsMonitoring(true);
        }}
        onCanPlay={() => setIsLoadingMonitor(false)}
        onPause={() => {
          setIsMonitoring(false);
          setIsLoadingMonitor(false);
        }}
        onEnded={() => {
          setIsMonitoring(false);
          setIsLoadingMonitor(false);
        }}
        onError={() => {
          setIsMonitoring(false);
          setIsLoadingMonitor(false);
        }}
      />

      {/* 主視覺二欄排版：左側「正在播放」；右側「未來 3 首」 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        {/* ================= 左側：正在播放 (Now Playing) ================= */}
        <div className="lg:col-span-7 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-800/80 pb-6 lg:pb-0 lg:pr-6">
          <div>
            {/* 頂部即時廣播狀態徽章與電台監聽器 */}
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5 shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <Radio className="w-3.5 h-3.5 text-emerald-400" />
                  <span>ON-AIR</span>
                </span>
                <span className="text-[10px] font-mono text-slate-400 px-2 py-0.5 rounded-md bg-slate-800/80">
                  MP3 {bitrate || 256}kbps CBR
                </span>
              </div>

              {/* 實時監聽廣播按鈕 (支援立即轉圈圈緩衝反饋) */}
              <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 px-3 py-1.5 rounded-xl">
                <button
                  onClick={toggleMonitoring}
                  disabled={isLoadingMonitor}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg transition-all active:scale-95 ${
                    isMonitoring
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30 ring-1 ring-purple-400/50'
                      : isLoadingMonitor
                      ? 'bg-purple-900/60 text-purple-200 border border-purple-500/40 cursor-wait animate-pulse'
                      : 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border border-purple-500/30'
                  }`}
                  title={isMonitoring ? '暫停監聽' : isLoadingMonitor ? '正在連線串流緩衝中...' : '在後台即時收聽目前的現場廣播音訊'}
                >
                  {isLoadingMonitor ? (
                    <>
                      <RotateCw className="w-3.5 h-3.5 animate-spin text-purple-300" />
                      <span>連線緩衝中...</span>
                    </>
                  ) : isMonitoring ? (
                    <>
                      <Pause className="w-3.5 h-3.5 fill-current" />
                      <span>暫停監聽</span>
                      {/* 音訊跳動波形動畫 */}
                      <span className="flex items-end gap-0.5 h-3 ml-1">
                        <span className="w-0.5 bg-white h-full animate-bounce" />
                        <span className="w-0.5 bg-white h-2/3 animate-pulse" />
                        <span className="w-0.5 bg-white h-4/5 animate-bounce" />
                      </span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>🎧 監聽現場廣播</span>
                    </>
                  )}
                </button>

                {/* 音量調整滑桿 */}
                {(isMonitoring || isLoadingMonitor) && (
                  <div className="flex items-center gap-1.5 pl-2 border-l border-slate-800">
                    <button
                      onClick={() => setIsMuted(!isMuted)}
                      className="text-slate-400 hover:text-white transition-colors"
                      title={isMuted ? '取消靜音' : '靜音'}
                    >
                      {isMuted || volume === 0 ? (
                        <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5 text-slate-300" />
                      )}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={isMuted ? 0 : volume}
                      onChange={(e) => {
                        setVolume(parseFloat(e.target.value));
                        setIsMuted(false);
                      }}
                      className="w-16 h-1 accent-purple-500 bg-slate-800 rounded-lg cursor-pointer"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* 核心歌曲資訊展示 */}
            <div className="flex items-center gap-5 mt-2">
              <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden bg-slate-800 border-2 border-purple-500/30 shadow-xl flex-shrink-0 group">
                <img
                  src={coverUrl}
                  alt="Cover"
                  className={`w-full h-full object-cover transition-transform duration-700 ${
                    isMonitoring ? 'scale-105' : ''
                  }`}
                  onError={(e) => {
                    e.target.src =
                      'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="%23334155" width="100" height="100"/><text fill="%23cbd5e1" font-size="12" x="50%" y="50%" text-anchor="middle" dominant-baseline="middle">CastFlow</text></svg>';
                  }}
                />
                <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-2xl pointer-events-none" />
                {isMonitoring && (
                  <div className="absolute bottom-1.5 right-1.5 bg-purple-600/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
                    監聽中
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate">
                  {currentTrack?.title || 'CastFlow Live 廣播播送中'}
                </h2>
                <p className="text-sm font-semibold text-purple-300 truncate mt-0.5">
                  {currentTrack?.artist || '雲原生自動化廣播電台'}
                </p>
                {currentTrack?.album ? (
                  <p className="text-xs text-slate-400 truncate mt-1">
                    專輯: {currentTrack.album}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 mt-1 italic">
                    正在透過 Liquidsoap + Icecast 串流輸出
                  </p>
                )}

                {/* 播送進度條 */}
                <div className="mt-4">
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden shadow-inner">
                    <div
                      className="bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-400 h-full rounded-full transition-all duration-1000 ease-linear shadow-md"
                      style={{ width: `${currentTrack?.progress || 0}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-400 font-mono mt-1.5">
                    <span>{formatTime(currentTrack?.elapsed)}</span>
                    <span className="text-purple-300/80 font-bold">{currentTrack?.progress || 0}%</span>
                    <span>
                      {currentTrack?.remaining !== null
                        ? `-${formatTime(currentTrack?.remaining)}`
                        : '--:--'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 底部控制工具列 */}
          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-800/80 flex-wrap">
            <button
              onClick={handleSkip}
              disabled={isSkipping}
              className={`flex items-center gap-2 font-semibold text-xs px-4 py-2.5 rounded-xl shadow-lg transition-all duration-300 active:scale-95 disabled:cursor-not-allowed ${
                skipSuccess
                  ? 'bg-emerald-600 text-white shadow-emerald-600/30 ring-2 ring-emerald-400'
                  : isSkipping
                  ? 'bg-indigo-700 text-white shadow-indigo-700/40 ring-2 ring-indigo-400'
                  : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-indigo-600/20'
              }`}
            >
              {isSkipping ? (
                <>
                  <RotateCw className="w-4 h-4 animate-spin text-white" />
                  <span>平滑轉場切換中...</span>
                </>
              ) : skipSuccess ? (
                <>
                  <Check className="w-4 h-4 text-white" />
                  <span>已平滑切入下一首！</span>
                </>
              ) : (
                <>
                  <FastForward className="w-4 h-4 fill-white" />
                  <span>跳至下一首 (Skip)</span>
                </>
              )}
            </button>

            <button
              onClick={handleReload}
              disabled={isReloading}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs px-4 py-2.5 rounded-xl active:scale-95 transition-all disabled:opacity-50"
              title="重新掃描所有歌單目錄音訊檔案"
            >
              <RefreshCw className={`w-4 h-4 ${isReloading ? 'animate-spin' : ''}`} />
              <span>{isReloading ? '載入中...' : '重新載入歌單 (Reload)'}</span>
            </button>

            <button
              onClick={onOpenConsole}
              className="flex items-center gap-2 bg-slate-950 hover:bg-slate-900 text-purple-300 border border-purple-500/30 font-semibold text-xs px-3.5 py-2.5 rounded-xl transition-all ml-auto"
              title="開啟 Liquidsoap Telnet 控制台"
            >
              <Terminal className="w-4 h-4 text-purple-400" />
              <span>Telnet 控制台</span>
            </button>
          </div>
        </div>

        {/* ================= 右側：未來 3 首預計播送 (Upcoming 3 Tracks) ================= */}
        <div className="lg:col-span-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
                  <ListMusic className="w-4 h-4" />
                </div>
                <h3 className="text-xs font-bold text-slate-200 tracking-wide">
                  未來 3 首預計播送 (Upcoming Queue)
                </h3>
              </div>
              <span className="text-[10px] text-slate-400 font-medium bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-700/50">
                AutoDJ
              </span>
            </div>

            {/* 3 首待播曲目卡片 */}
            <div className="space-y-2.5">
              {displayUpcoming.map((item, idx) => {
                const isNext = idx === 0;
                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-2xl transition-all ${
                      isNext
                        ? 'bg-purple-950/30 border border-purple-500/40 shadow-md shadow-purple-500/5'
                        : 'bg-slate-950/40 border border-slate-800/70 hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.2 rounded-md ${
                            isNext
                              ? 'bg-purple-500 text-white shadow-sm'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          #{idx + 1} {isNext ? '次首預告' : '待播'}
                        </span>
                        <span
                          className="text-[10px] font-semibold px-2 py-0.2 rounded-md flex items-center gap-1 text-slate-300"
                          style={{
                            backgroundColor: `${item.playlistColor || '#8b5cf6'}20`,
                            borderColor: `${item.playlistColor || '#8b5cf6'}40`,
                            borderWidth: 1
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: item.playlistColor || '#8b5cf6' }}
                          />
                          {item.playlistName || `歌單 ${item.playlistId || ''}`}
                        </span>
                      </div>

                      <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-600" />
                        {item.duration ? formatTime(item.duration) : '--:--'}
                      </span>
                    </div>

                    <p className="text-xs font-bold text-white truncate">{item.title}</p>
                    <div className="flex items-center justify-between text-[11px] text-slate-400 mt-0.5">
                      <span className="truncate max-w-[180px]">{item.artist}</span>
                      <span className="text-[10px] text-purple-400/80 font-medium">
                        {item.ruleTitle || '排程調度'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
