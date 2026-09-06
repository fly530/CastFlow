import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Volume1,
  RotateCw,
  Radio,
  Signal,
  Maximize2,
  Minimize2,
  ExternalLink,
  ListMusic,
  History,
  Music,
  Clock,
  Sparkles
} from 'lucide-react';
import CastFlowLogo from './CastFlowLogo';

export default function UnifiedPlayerCard({
  currentTrack,
  upcoming = [],
  online = false,
  bitrate = 128,
  onOpenInfoModal
}) {
  const audioRef = useRef(null);
  const hlsRef = useRef(null);
  const cardRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [streamType, setStreamType] = useState('mp3'); // 'mp3' (原生穩定直播) | 'hls' (分段切片)
  const [errorMsg, setErrorMsg] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState('upcoming'); // 'upcoming' | 'history'
  const [history, setHistory] = useState([]);

  const [localLogs, setLocalLogs] = useState([]);
  const [audioDiagnostics, setAudioDiagnostics] = useState({
    bufferAhead: 0,
    readyState: 0,
    networkState: 0,
    isPlaying: false,
    isWaiting: false,
    errorCount: 0,
    retryCount: 0
  });

  const hlsStreamUrl = '/hls/live.m3u8';
  const mp3StreamUrl = '/stream';
  const waitingTimerRef = useRef(null);
  const lastLogReportTime = useRef(0);

  // 格式化秒數為 mm:ss
  const formatTime = (seconds) => {
    if (seconds === null || seconds === undefined || isNaN(seconds)) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // 取得當前播放點前方緩衝秒數 (Buffer Ahead)
  const getBufferAhead = (audio) => {
    if (!audio || !audio.buffered || audio.buffered.length === 0) return 0;
    const cur = audio.currentTime;
    for (let i = 0; i < audio.buffered.length; i++) {
      if (cur >= audio.buffered.start(i) && cur <= audio.buffered.end(i)) {
        return audio.buffered.end(i) - cur;
      }
    }
    return 0;
  };

  // 紀錄日誌 (寫入前端 ring buffer 並同步發送至後端持久化)
  const logEvent = useCallback((level, event, message, metrics = null) => {
    const entry = {
      id: Date.now() + Math.random().toString(36).substr(2, 4),
      timestamp: new Date().toISOString(),
      level, // 'INFO' | 'WARN' | 'ERROR'
      event,
      streamType,
      message,
      metrics
    };

    setLocalLogs((prev) => [entry, ...prev.slice(0, 79)]);

    // 發送至後端日誌 API (限制過度頻繁的 ping 避免 flood)
    const now = Date.now();
    if (level === 'ERROR' || level === 'WARN' || now - lastLogReportTime.current > 3000) {
      lastLogReportTime.current = now;
      fetch('/api/logs/playback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      }).catch(() => {});
    }
  }, [streamType]);

  // 抓取剛才播過歷史紀錄
  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history?limit=4');
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setHistory(json.data || []);
        }
      }
    } catch {
      // 忽略暫態錯誤
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [currentTrack?.title]);

  // 全螢幕監聽與切換
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen error:', err);
    }
  };

  // 鍵盤快速鍵 (適用於客廳電視或電腦電視遙控操作)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // 初始化 HLS 實例
  const initHls = (audio) => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (!Hls.isSupported()) {
      if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        audio.src = hlsStreamUrl;
        logEvent('INFO', 'NATIVE_HLS_ATTACHED', '使用 Safari/iOS 原生 HLS 解碼器');
      } else {
        logEvent('WARN', 'HLS_UNSUPPORTED', '瀏覽器不支援 HLS，建議切換為 Icecast MP3 模式');
      }
      return;
    }

    logEvent('INFO', 'HLS_INIT', '正在建立 HLS.js 串流解析核心 (lowLatencyMode=true)');

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 6,
      maxBufferLength: 12,
      maxMaxBufferLength: 24,
      manifestLoadingMaxRetry: 6,
      manifestLoadingRetryDelay: 1000,
      fragLoadingMaxRetry: 6,
      fragLoadingRetryDelay: 1000,
    });
    hlsRef.current = hls;

    hls.attachMedia(audio);

    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      hls.loadSource(hlsStreamUrl);
    });

    hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      setErrorMsg(null);
      logEvent('INFO', 'MANIFEST_PARSED', `HLS 清單解析完成，共有 ${data.levels?.length || 1} 條串流軌道`);
    });

    hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
      const frag = data.frag;
      if (frag) {
        logEvent('INFO', 'FRAG_LOADED', `已載入切片 seq #${frag.sn} (${frag.duration.toFixed(1)}s)`, {
          sn: frag.sn,
          duration: Number(frag.duration.toFixed(2)),
          sizeBytes: data.stats?.total || 0
        });
      }
    });

    hls.on(Hls.Events.BUFFER_STALLED, () => {
      logEvent('WARN', 'HLS_BUFFER_STALLED', 'HLS 緩衝區耗盡，播放器暫態卡頓等待切片');
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      const detailMsg = `[${data.type}] ${data.details} ${data.response?.code ? `(HTTP ${data.response.code})` : ''}`;
      setAudioDiagnostics((prev) => ({ ...prev, errorCount: prev.errorCount + 1 }));

      if (data.fatal) {
        logEvent('ERROR', 'FATAL_HLS_ERROR', detailMsg, { fatal: true, type: data.type });
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            logEvent('WARN', 'RECOVERY_ATTEMPT', '網路錯誤，嘗試重新拉取 HLS 切片...');
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            logEvent('WARN', 'RECOVERY_ATTEMPT', '媒體解析錯誤，嘗試自動修復緩衝區...');
            hls.recoverMediaError();
            break;
          default:
            hls.destroy();
            hlsRef.current = null;
            setErrorMsg('HLS 串流解析中斷，建議切換下方「Icecast MP3」模式穩定收聽。');
            break;
        }
      } else {
        logEvent('WARN', 'NON_FATAL_HLS_ERROR', detailMsg);
      }
    });
  };

  // 初始化音訊播放器 (HLS 或 原生 MP3)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = isMuted ? 0 : volume;

    if (streamType === 'hls') {
      initHls(audio);
    } else {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      logEvent('INFO', 'STREAM_SWITCH', `切換為 Icecast 原生 MP3 持續串流 (CBR ${bitrate || 256} kbps)`);
      if (!audio.src || !audio.src.includes(mp3StreamUrl)) {
        audio.src = `${mp3StreamUrl}?nocache=${Date.now()}`;
      }
      if (isPlaying) {
        audio.play().catch(() => setIsPlaying(false));
      }
    }

    return () => {
      if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamType]);

  // 定期音訊緩衝健康度診斷檢查 (每 2.5 秒)
  useEffect(() => {
    const interval = setInterval(() => {
      const audio = audioRef.current;
      if (!audio) return;

      const bufferAhead = getBufferAhead(audio);
      const isWaiting = audio.readyState < 3 && isPlaying;

      setAudioDiagnostics((prev) => ({
        ...prev,
        bufferAhead,
        readyState: audio.readyState,
        networkState: audio.networkState,
        isPlaying: !audio.paused && !audio.ended,
        isWaiting
      }));

      // 當播放中且緩衝嚴重不足 (小於 0.6 秒)，記錄警告日誌
      if (isPlaying && !audio.paused && bufferAhead < 0.6 && audio.readyState < 4) {
        logEvent('WARN', 'BUFFER_LOW', `音訊前方緩衝量偏低: ${bufferAhead.toFixed(2)}s (ReadyState: ${audio.readyState})`, {
          bufferAhead: Number(bufferAhead.toFixed(2)),
          readyState: audio.readyState,
          currentTime: Number(audio.currentTime.toFixed(2))
        });
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [isPlaying, logEvent]);

  // 控制播放與暫停
  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
        setIsLoading(false);
        logEvent('INFO', 'AUDIO_PAUSE', '使用者手動暫停播放');
      } else {
        setIsLoading(true);
        setErrorMsg(null);
        logEvent('INFO', 'AUDIO_PLAY_REQUEST', `請求開始播放 (${streamType.toUpperCase()})`);

        if (streamType === 'hls') {
          if (Hls.isSupported()) {
            if (!hlsRef.current) {
              initHls(audio);
            } else {
              hlsRef.current.loadSource(hlsStreamUrl);
              hlsRef.current.startLoad();
            }
          } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
            audio.src = `${hlsStreamUrl}?t=${Date.now()}`;
          }
        } else {
          if (!audio.src || !audio.src.includes(mp3StreamUrl)) {
            audio.src = `${mp3StreamUrl}?nocache=${Date.now()}`;
          }
        }

        await audio.play();
        setIsPlaying(true);
        logEvent('INFO', 'AUDIO_PLAY_SUCCESS', '音訊引擎已成功開始輸出聲音');
      }
    } catch (err) {
      console.warn('Play error:', err);
      logEvent('ERROR', 'PLAY_EXCEPTION', `播放啟動失敗: ${err.message}`);
      setErrorMsg('播放暫停或緩衝中，若持續不穩可切換為「Icecast MP3」模式。');
      setIsPlaying(false);
    } finally {
      setIsLoading(false);
    }
  };

  // 音量調整
  const handleVolumeChange = (e) => {
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    if (audioRef.current) {
      audioRef.current.volume = newVol;
    }
    if (newVol > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  // 靜音切換
  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (audioRef.current) {
      audioRef.current.volume = nextMuted ? 0 : volume;
    }
  };

  // 重新連線串流
  const reloadStream = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setIsLoading(true);
    setErrorMsg(null);
    setAudioDiagnostics((prev) => ({ ...prev, retryCount: prev.retryCount + 1 }));
    logEvent('INFO', 'STREAM_RELOAD', `手動觸發串流重連 (${streamType.toUpperCase()})`);

    if (streamType === 'hls') {
      if (hlsRef.current) {
        hlsRef.current.loadSource(hlsStreamUrl);
        hlsRef.current.startLoad();
      } else {
        initHls(audio);
      }
    } else {
      audio.src = `${mp3StreamUrl}?nocache=${Date.now()}`;
    }
    if (isPlaying) {
      audio.play().catch(() => {});
    }
  };

  const handleWaiting = () => {
    setIsLoading(true);
    const buf = getBufferAhead(audioRef.current);
    logEvent('WARN', 'AUDIO_WAITING', `觸發 HTML5 Audio waiting (轉圈緩衝)，目前前方緩衝: ${buf.toFixed(2)}s`);
    
    if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
    waitingTimerRef.current = setTimeout(() => {
      const audio = audioRef.current;
      if (audio && streamType === 'hls' && hlsRef.current) {
        logEvent('WARN', 'BUFFER_TIMEOUT_RECOVERY', '緩衝超時超過 3.5 秒，自動同步至最新 Live Edge 避免停滯卡死');
        if (audio.seekable && audio.seekable.length > 0) {
          audio.currentTime = audio.seekable.end(audio.seekable.length - 1);
        } else {
          hlsRef.current.loadSource(hlsStreamUrl);
          hlsRef.current.startLoad();
        }
      }
    }, 3500);
  };

  const handlePlaying = () => {
    if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
    setIsLoading(false);
    setIsPlaying(true);
    setErrorMsg(null);
    logEvent('INFO', 'AUDIO_PLAYING', '音訊恢復正常連續撥放 (Playing)');
  };

  const handleStalled = () => {
    logEvent('WARN', 'AUDIO_STALLED', '觸發 HTML5 Audio stalled: 瀏覽器嘗試抓取音訊但網路未及時回應');
  };

  const handleError = () => {
    setIsLoading(false);
    setIsPlaying(false);
    const err = audioRef.current?.error;
    const msg = err ? `代碼 ${err.code}: ${err.message || '媒體解碼或網路載入中斷'}` : '串流連線中斷';
    logEvent('ERROR', 'AUDIO_ERROR', msg);
    setErrorMsg('串流伺服器連線中斷，可點選重新整理或切換「Icecast MP3」模式。');
  };

  const formatTimeAgo = (dateStr) => {
    try {
      const date = new Date(dateStr + 'Z');
      const now = new Date();
      const diffSec = Math.floor((now - date) / 1000);
      if (diffSec < 60) return '剛剛';
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分前`;
      return `${Math.floor(diffSec / 3600)} 小時前`;
    } catch {
      return '';
    }
  };

  const coverUrl = `/api/current/cover?title=${encodeURIComponent(currentTrack?.title || '')}&v=${encodeURIComponent(currentTrack?.title || '')}`;

  return (
    <div className="w-full max-w-6xl mx-auto" ref={cardRef}>
      {/* 隱藏原生 Audio 標籤 (掛載嚴謹診斷監聽器) */}
      <audio
        ref={audioRef}
        onWaiting={handleWaiting}
        onPlaying={handlePlaying}
        onStalled={handleStalled}
        onError={handleError}
        onCanPlay={() => {
          setIsLoading(false);
          logEvent('INFO', 'AUDIO_CANPLAY', '音訊緩衝已滿足起播條件');
        }}
      />

      {/* 單一核心卡片容器 (電視與客廳最佳化質感大卡片) */}
      <div className="relative rounded-3xl lg:rounded-[36px] bg-slate-900/80 border border-slate-800/80 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.85)] backdrop-blur-2xl p-5 sm:p-8 lg:p-10 overflow-hidden flex flex-col justify-between">
        
        {/* 背景裝飾環境光 (深沉氛圍燈) */}
        <div className="absolute -top-32 -left-32 w-80 h-80 bg-indigo-500/15 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-80 h-80 bg-purple-500/15 rounded-full blur-[100px] pointer-events-none" />

        {/* 1. 卡片頂部狀態列：電台 Logo + LIVE 指示燈 + 位元率 + 全螢幕與工具按鈕 (不顯示聽眾人數) */}
        <div className="flex items-center justify-between gap-4 pb-6 border-b border-slate-800/60 relative z-10 flex-wrap sm:flex-nowrap">
          {/* 左側：電台識別 */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center shadow-lg shadow-indigo-500/20 ring-1 ring-white/10">
              <img src="/radio.svg" alt="Logo" className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
                CastFlow
              </h1>
              <p className="text-[11px] text-slate-400 font-medium tracking-wide">Cloud-Native Broadcast</p>
            </div>
          </div>

          {/* 右側：狀態膠囊 + 工具捷徑 */}
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            {/* LIVE 狀態燈 */}
            <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 rounded-full px-3 py-1.5 shadow-inner">
              <span
                className={`inline-flex rounded-full h-2 w-2 ${
                  online ? 'bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-rose-500'
                }`}
              />
              <span className="text-xs font-bold tracking-wider text-slate-200">
                {online ? 'LIVE' : 'OFFLINE'}
              </span>
            </div>

            {/* 位元率標籤 */}
            <div className="hidden sm:flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 rounded-full px-3 py-1.5 text-xs text-slate-400 font-mono">
              <Signal className="w-3.5 h-3.5 text-indigo-400" />
              <span>{bitrate || 256} kbps</span>
            </div>

            {/* 客廳電視全螢幕模式切換按鈕 (只留圖示) */}
            <button
              onClick={toggleFullscreen}
              className="p-2 flex items-center justify-center bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white border border-slate-700/80 rounded-full transition-all active:scale-95 shadow-sm"
              title={isFullscreen ? '離開全螢幕 (Esc)' : '電視全螢幕劇院模式 (F)'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {/* 前往管理後台 */}
            <a
              href="http://localhost:3002"
              target="_blank"
              rel="noreferrer"
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 rounded-full transition-colors"
              title="進入管理後台"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* 2. 卡片主體區域：左側黑膠唱片旋轉主視覺 + 右側大字體曲目與整合式佇列/歷史 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center py-6 lg:py-8 relative z-10">
          
          {/* 左側：大號黑膠唱片 + 唱片中心旋轉封面 + 律動等化器 */}
          <div className="lg:col-span-5 flex flex-col items-center justify-center">
            <div className="relative group">
              {/* 唱盤周圍柔和環境光暈 */}
              <div
                className={`absolute inset-0 rounded-full blur-2xl transition-opacity duration-1000 ${
                  isPlaying ? 'bg-indigo-500/25 opacity-100' : 'bg-transparent opacity-0'
                }`}
              />

              {/* 黑膠唱片實體本體 */}
              <div
                className={`w-64 h-64 sm:w-80 sm:h-80 xl:w-88 xl:h-88 rounded-full bg-gradient-to-tr from-slate-950 via-slate-900 to-black p-4 shadow-2xl ring-4 ring-slate-800/80 flex items-center justify-center relative transition-all ${
                  isPlaying ? 'animate-spin-slow' : ''
                }`}
                style={{
                  backgroundImage:
                    'repeating-radial-gradient(circle, #020617 0, #0f172a 2px, #020617 4px)'
                }}
              >
                {/* 唱片中心標籤 (專輯封面旋轉) */}
                <div className="relative w-36 h-36 sm:w-44 sm:h-44 xl:w-48 xl:h-48 rounded-full overflow-hidden ring-4 ring-indigo-500/40 shadow-inner flex items-center justify-center bg-slate-800">
                  <img
                    src={coverUrl}
                    alt={currentTrack?.title || 'Album Cover'}
                    className="w-full h-full object-cover select-none pointer-events-none"
                    onError={(e) => {
                      e.target.src = '/radio.svg';
                    }}
                  />

                  {/* 黑膠唱片反光塗層環 */}
                  <div className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/20 pointer-events-none" />

                  {/* 唱片中心金屬軸心孔 */}
                  <div className="absolute w-8 h-8 rounded-full bg-slate-950 border-2 border-slate-700 shadow-inner flex items-center justify-center">
                    <div className="w-3 h-3 rounded-full bg-slate-800 border border-slate-600" />
                  </div>
                </div>
              </div>
            </div>

            {/* 串流模式切換 (HLS Web / Icecast MP3) */}
            <div className="mt-6 inline-flex rounded-xl bg-slate-950/90 p-1 border border-slate-800/80 shadow-inner">
              <button
                onClick={() => setStreamType('hls')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  streamType === 'hls'
                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                HLS 串流
              </button>
              <button
                onClick={() => setStreamType('mp3')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  streamType === 'mp3'
                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Icecast MP3
              </button>
            </div>
          </div>

          {/* 右側：超大文字資訊 + 撥放進度 + 控制軸 + 內嵌佇列/歷史分頁 */}
          <div className="lg:col-span-7 flex flex-col justify-center space-y-6">
            
            {/* 曲目資訊區 (電視螢幕遠距清晰可讀) */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-400 bg-indigo-950/60 border border-indigo-800/50 px-2.5 py-0.5 rounded-md flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" /> NOW PLAYING
                </span>
                {currentTrack?.album && (
                  <span className="text-xs text-slate-400 font-medium truncate max-w-[280px]">
                    {currentTrack.album}
                  </span>
                )}
              </div>

              {/* 大標題 */}
              <h2 className="text-2xl sm:text-3xl xl:text-4xl font-black text-white tracking-tight leading-tight line-clamp-2 drop-shadow">
                {currentTrack?.title || 'CastFlow Live'}
              </h2>

              {/* 演出者 */}
              <p className="text-base sm:text-xl font-medium text-slate-300 line-clamp-1">
                {currentTrack?.artist || '雲原生智慧自動化廣播'}
              </p>
            </div>

            {/* 播放進度條 */}
            <div className="space-y-2">
              <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden relative border border-slate-800/80">
                <div
                  className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 h-full rounded-full transition-all duration-1000 ease-linear shadow-[0_0_12px_rgba(129,140,248,0.5)]"
                  style={{ width: `${currentTrack?.progress || 0}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-400 font-mono font-medium">
                <span>{formatTime(currentTrack?.elapsed)}</span>
                <span>
                  {currentTrack?.remaining !== null
                    ? `-${formatTime(currentTrack?.remaining)}`
                    : '--:--'}
                </span>
              </div>
            </div>

            {/* 核心播放控制排 */}
            <div className="flex items-center justify-between gap-4 pt-1">
              <div className="flex items-center gap-3.5">
                {/* 大號撥放/暫停鍵 */}
                <button
                  onClick={togglePlay}
                  disabled={!online}
                  className={`w-16 h-16 sm:w-18 sm:h-18 rounded-2xl flex items-center justify-center shadow-xl transition-all transform active:scale-95 ${
                    online
                      ? 'bg-gradient-to-tr from-indigo-600 via-purple-600 to-indigo-500 text-white hover:shadow-indigo-500/30 hover:brightness-110 ring-4 ring-indigo-500/20'
                      : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                  }`}
                  title={isPlaying ? '暫停播放 (空白鍵)' : '開始收聽 (空白鍵)'}
                >
                  {isLoading ? (
                    <RotateCw className="w-7 h-7 animate-spin" />
                  ) : isPlaying ? (
                    <Pause className="w-7 h-7 fill-white" />
                  ) : (
                    <Play className="w-7 h-7 fill-white translate-x-0.5" />
                  )}
                </button>

                {/* 重新載入串流 */}
                <button
                  onClick={reloadStream}
                  className="p-3 text-slate-400 hover:text-white hover:bg-slate-800/80 border border-slate-800 rounded-xl transition-all"
                  title="重新連線串流"
                >
                  <RotateCw className="w-5 h-5" />
                </button>
              </div>

              {/* 音量控制滑桿 */}
              <div className="flex items-center gap-2.5 flex-1 max-w-[200px] bg-slate-950/80 border border-slate-800/80 rounded-2xl px-3.5 py-2.5 shadow-inner">
                <button
                  onClick={toggleMute}
                  className="text-slate-400 hover:text-white transition-colors"
                  title="切換靜音 (M)"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-rose-400" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-indigo-400" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {errorMsg && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3.5 py-2">
                {errorMsg}
              </p>
            )}

            {/* 3. 整合式內嵌區塊：接下來播放 (Upcoming) / 剛才播過 (History) 分頁架 */}
            <div className="pt-2">
              <div className="flex items-center gap-2 mb-3 border-b border-slate-800/60 pb-2">
                <button
                  onClick={() => setActiveTab('upcoming')}
                  className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl transition-all ${
                    activeTab === 'upcoming'
                      ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ListMusic className="w-3.5 h-3.5" />
                  <span>接下來播放 (Upcoming)</span>
                  {upcoming.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-500/30 text-indigo-200">
                      {Math.min(3, upcoming.length)}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setActiveTab('history')}
                  className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl transition-all ${
                    activeTab === 'history'
                      ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  <span>剛才播過 (History)</span>
                </button>
              </div>

              {/* 內容區：依據分頁呈現，維持卡片高度與緊湊質感 */}
              {activeTab === 'upcoming' ? (
                <div className="space-y-2">
                  {upcoming && upcoming.length > 0 ? (
                    upcoming.slice(0, 3).map((track, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-950/50 border border-slate-800/60 hover:border-slate-700 transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-5 h-5 rounded-md bg-indigo-500/10 text-indigo-400 flex items-center justify-center text-[10px] font-mono font-bold flex-shrink-0">
                            #{idx + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-200 truncate">
                              {track.title || 'Unknown Title'}
                            </p>
                            <p className="text-[11px] text-slate-400 truncate">
                              {track.artist || '智慧排程自動輪替'}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/50 text-xs text-slate-400 flex items-center justify-between">
                      <span>依智慧排程權重自動選取接續曲目...</span>
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {history && history.length > 0 ? (
                    history.slice(0, 3).map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-950/50 border border-slate-800/60 hover:border-slate-700 transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-5 h-5 rounded-md bg-purple-500/10 text-purple-400 flex items-center justify-center flex-shrink-0">
                            <Music className="w-3 h-3" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-200 truncate">{item.title}</p>
                            <p className="text-[11px] text-slate-400 truncate">{item.artist}</p>
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono flex-shrink-0 ml-2">
                          {formatTimeAgo(item.played_at)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/50 text-xs text-slate-400">
                      尚未有播放紀錄
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>

        </div>

        {/* 4. 卡片底部極簡標記 (整合進卡片底部邊緣) */}
        <div className="pt-4 mt-2 border-t border-slate-800/50 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 relative z-10 gap-2">
          <span>CastFlow © 2026 • 雲原生廣播音訊串流系統</span>
          <div className="flex items-center gap-3">
            <span className="font-mono">Liquidsoap + Icecast + HLS</span>
            <span>•</span>
            <span>按 Space 播放/暫停 • F 全螢幕</span>
          </div>
        </div>

      </div>

    </div>
  );
}
