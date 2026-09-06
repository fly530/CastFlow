import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Volume1,
  RotateCw,
  Radio,
  Disc,
  Headphones,
  Signal
} from 'lucide-react';

export default function Player({ currentTrack, online, bitrate }) {
  const audioRef = useRef(null);
  const hlsRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [streamType, setStreamType] = useState('hls'); // 'hls' | 'mp3'
  const [errorMsg, setErrorMsg] = useState(null);

  const hlsStreamUrl = '/hls/live.m3u8';
  const mp3StreamUrl = '/stream';

  const waitingTimerRef = useRef(null);

  // 格式化秒數為 mm:ss
  const formatTime = (seconds) => {
    if (seconds === null || seconds === undefined || isNaN(seconds)) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // 初始化 HLS 實例
  const initHls = (audio) => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (!Hls.isSupported()) {
      if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        audio.src = hlsStreamUrl;
      }
      return;
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 6,
      maxBufferLength: 8,
      maxMaxBufferLength: 16,
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

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      setErrorMsg(null);
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.warn('HLS Network Error, restarting load...', data);
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.warn('HLS Media Error, recovering...', data);
            hls.recoverMediaError();
            break;
          default:
            console.error('HLS Fatal Error, destroying:', data);
            hls.destroy();
            hlsRef.current = null;
            setErrorMsg('HLS 串流解析中斷，可切換右上角「Icecast MP3」模式即時收聽。');
            break;
        }
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
      audio.src = `${mp3StreamUrl}?nocache=${Date.now()}`;
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

  // 控制播放與暫停
  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
        setIsLoading(false);
      } else {
        setIsLoading(true);
        setErrorMsg(null);

        if (streamType === 'hls') {
          if (Hls.isSupported()) {
            if (!hlsRef.current) {
              initHls(audio);
            } else {
              // 重新載入最新 live manifest 並跳到最新 live edge，避免播放落後停滯卡在舊片段
              hlsRef.current.loadSource(hlsStreamUrl);
              hlsRef.current.startLoad();
            }
          } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
            audio.src = `${hlsStreamUrl}?t=${Date.now()}`;
          }
        } else {
          audio.src = `${mp3StreamUrl}?nocache=${Date.now()}`;
        }

        await audio.play();
        setIsPlaying(true);
      }
    } catch (err) {
      console.warn('Play error:', err);
      setErrorMsg('播放發生錯誤，若 HLS 正在緩衝中可切換右上角「Icecast MP3」模式收聽。');
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

  // 重新連線
  const reloadStream = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setIsLoading(true);
    setErrorMsg(null);
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
    if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
    // 若緩衝轉圈圈超過 3.5 秒，嘗試同步至最新 Live Edge，防止卡在已經被清除的過期片段
    waitingTimerRef.current = setTimeout(() => {
      const audio = audioRef.current;
      if (audio && streamType === 'hls' && hlsRef.current) {
        console.log('HLS buffering timeout, syncing to live edge...');
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
  };

  const coverUrl = `/api/current/cover?title=${encodeURIComponent(currentTrack?.title || '')}&v=${encodeURIComponent(currentTrack?.title || '')}`;

  return (
    <div className="w-full max-w-4xl mx-auto px-4">
      {/* 隱藏原生 Audio 標籤 */}
      <audio
        ref={audioRef}
        onWaiting={handleWaiting}
        onPlaying={handlePlaying}
        onCanPlay={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setIsPlaying(false);
          setErrorMsg('串流伺服器連線中斷，可點選重新整理或切換串流模式。');
        }}
      />

      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-slate-900/90 to-slate-950/90 border border-slate-800/80 p-6 sm:p-10 shadow-2xl backdrop-blur-xl">
        {/* 背景裝飾光暈 */}
        <div className="absolute -top-24 -left-24 w-72 h-72 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-72 h-72 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
          {/* 左側：黑膠唱片 / 唱盤中心即時旋轉專輯封面視覺區 */}
          <div className="md:col-span-5 flex justify-center">
            <div className="relative group">
              {/* 黑膠唱片底盤 (撥放時同步平滑旋轉) */}
              <div
                className={`w-64 h-64 sm:w-76 sm:h-76 rounded-full bg-gradient-to-tr from-slate-950 via-slate-900 to-black p-3.5 shadow-2xl ring-4 ring-slate-800/80 flex items-center justify-center transition-all ${
                  isPlaying ? 'animate-spin-slow' : ''
                }`}
                style={{
                  backgroundImage:
                    'repeating-radial-gradient(circle, #020617 0, #0f172a 2px, #020617 4px)'
                }}
              >
                {/* 唱片中心標籤（即時專輯封面圖案，置於中心跟著唱盤同步旋轉） */}
                <div className="relative w-36 h-36 sm:w-44 sm:h-44 rounded-full overflow-hidden ring-4 ring-indigo-500/40 shadow-inner flex items-center justify-center bg-slate-800">
                  <img
                    src={coverUrl}
                    alt={currentTrack?.title || 'Album Cover'}
                    className="w-full h-full object-cover select-none pointer-events-none"
                    onError={(e) => {
                      e.target.src =
                        'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect fill="%231e1b4b" width="160" height="160"/><circle cx="80" cy="80" r="40" fill="%234338ca" opacity="0.6"/><text fill="%23ffffff" font-size="14" font-weight="bold" x="50%" y="50%" text-anchor="middle" dominant-baseline="middle">CastFlow</text></svg>';
                    }}
                  />
                  {/* 黑膠唱片表面光澤環 */}
                  <div className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/20 pointer-events-none" />

                  {/* 黑膠中心軸孔 */}
                  <div className="absolute w-7 h-7 rounded-full bg-slate-950 border-2 border-slate-700 shadow-inner flex items-center justify-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-800 border border-slate-600" />
                  </div>
                </div>
              </div>

              {/* 播放時的低音等化動態視覺棒 */}
              {isPlaying && (
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-end gap-1 px-3 py-1 bg-slate-900/90 border border-slate-700/50 rounded-full shadow-lg">
                  <span className="w-1 h-3 bg-indigo-500 rounded-full animate-bounce" />
                  <span className="w-1 h-5 bg-violet-500 rounded-full animate-bounce [animation-delay:0.15s]" />
                  <span className="w-1 h-4 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.3s]" />
                  <span className="w-1 h-6 bg-pink-500 rounded-full animate-bounce [animation-delay:0.45s]" />
                  <span className="w-1 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                </div>
              )}
            </div>
          </div>

          {/* 右側：曲目資訊與播放控制區 */}
          <div className="md:col-span-7 flex flex-col justify-center space-y-6">
            {/* 串流協議切換 */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-medium">串流模式:</span>
                <div className="inline-flex rounded-lg bg-slate-950 p-1 border border-slate-800">
                  <button
                    onClick={() => setStreamType('hls')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                      streamType === 'hls'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    HLS Web
                  </button>
                  <button
                    onClick={() => setStreamType('mp3')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                      streamType === 'mp3'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Icecast MP3
                  </button>
                </div>
              </div>

              {/* 位元率標籤 */}
              <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
                <Signal className="w-3.5 h-3.5 text-emerald-400" />
                <span>{bitrate || 256} kbps</span>
              </div>
            </div>

            {/* 即時曲目標題與演出者 */}
            <div className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5" /> 正在播放 NOW PLAYING
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight line-clamp-1">
                {currentTrack?.title || 'CastFlow Live'}
              </h2>
              <p className="text-base sm:text-lg font-medium text-slate-400 line-clamp-1">
                {currentTrack?.artist || 'Automated Broadcasting'}
              </p>
              {currentTrack?.album && (
                <p className="text-xs text-slate-500 line-clamp-1 italic">
                  專輯: {currentTrack.album}
                </p>
              )}
            </div>

            {/* 播放進度條 */}
            <div className="space-y-2">
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden relative">
                <div
                  className="bg-gradient-to-r from-indigo-500 to-violet-500 h-full rounded-full transition-all duration-1000 ease-linear"
                  style={{ width: `${currentTrack?.progress || 0}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-500 font-mono">
                <span>{formatTime(currentTrack?.elapsed)}</span>
                <span>
                  {currentTrack?.remaining !== null
                    ? `-${formatTime(currentTrack?.remaining)}`
                    : '--:--'}
                </span>
              </div>
            </div>

            {/* 核心播放按鈕與音量控制 */}
            <div className="flex items-center justify-between gap-4 pt-2">
              {/* 大號播放按鈕 */}
              <button
                onClick={togglePlay}
                disabled={!online}
                className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-xl transition-all transform active:scale-95 ${
                  online
                    ? 'bg-gradient-to-tr from-indigo-600 to-violet-600 text-white hover:shadow-indigo-500/25 hover:brightness-110 ring-4 ring-indigo-500/20'
                    : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                }`}
                title={isPlaying ? '暫停' : '播放'}
              >
                {isLoading ? (
                  <RotateCw className="w-7 h-7 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-7 h-7 fill-white" />
                ) : (
                  <Play className="w-7 h-7 fill-white translate-x-0.5" />
                )}
              </button>

              {/* 串流重新載入按鈕 */}
              <button
                onClick={reloadStream}
                className="p-3 text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 rounded-xl transition-all"
                title="重新整理串流"
              >
                <RotateCw className="w-5 h-5" />
              </button>

              {/* 音量調整滑桿 */}
              <div className="flex items-center gap-2 flex-1 max-w-[180px] bg-slate-950/60 border border-slate-800/60 rounded-xl px-3 py-2">
                <button
                  onClick={toggleMute}
                  className="text-slate-400 hover:text-white transition-colors"
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
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-1.5">
                {errorMsg}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
