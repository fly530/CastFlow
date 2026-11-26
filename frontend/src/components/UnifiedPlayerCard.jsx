import React, { useEffect, useRef, useState, useCallback } from 'react';
import { loadHls } from '../utils/hls.js';
import { DEFAULT_BITRATE_KBPS } from '../utils/stream.js';
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
  Sparkles,
  Cpu
} from 'lucide-react';
import CastFlowLogo from './CastFlowLogo';

export default function UnifiedPlayerCard({
  currentTrack,
  upcoming = [],
  online = false,
  bitrate,
  onOpenInfoModal,
  onSwitchToAdmin,
  currentUser
}) {
  const audioRef = useRef(null);
  const hlsRef = useRef(null);
  const cardRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [streamType, setStreamType] = useState('hls'); // 預設使用 'hls' (秒開高音質切片) | 'mp3' (Icecast 保底串流)
  const [errorMsg, setErrorMsg] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState('upcoming'); // 'upcoming' | 'history'
  const [history, setHistory] = useState([]);

  const hlsStreamUrl = '/hls/live.m3u8';
  const mp3StreamUrl = '/stream';
  const waitingTimerRef = useRef(null);
  // 動態載入的 hls.js 類別 (載入前為 null)
  const HlsRef = useRef(null);
  // 各事件上次回報給後端的時間 (節流用)
  const lastReportRef = useRef(new Map());
  const streamTypeRef = useRef(streamType);
  streamTypeRef.current = streamType;
  // 使用者「想不想聽」。切換串流來源時 <audio> 會被重新載入而停下，
  // 靠這個判斷載入完要不要自動接著播；耳機／媒體鍵暫停時也會同步改成 false。
  const wantPlayRef = useRef(false);
  // 正在換來源 (切 HLS/MP3、重新連線)：部分瀏覽器重新載入時會發出 pause 事件，這段期間不當成使用者暫停
  const switchingRef = useRef(false);

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

  // 播放診斷日誌。
  // 原本每個 INFO (每載入一個 HLS 切片就一筆) 都存進 state、每 3 秒還送一筆到後端：
  // 整張卡片每幾秒就重繪一次 (那份 state 其實沒有地方顯示)，聽眾一多後端就被日誌灌爆。
  // 現在 INFO 只在開發模式印到 console；WARN / ERROR 才回報，同一事件 30 秒內只送一次。
  const logEvent = useCallback((level, event, message, metrics = null) => {
    if (level === 'INFO') {
      if (import.meta.env.DEV) console.debug(`[Player] ${event}: ${message}`);
      return;
    }
    const now = Date.now();
    const last = lastReportRef.current.get(event) || 0;
    if (now - last < 30000) return;
    lastReportRef.current.set(event, now);
    fetch('/api/logs/playback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, event, streamType: streamTypeRef.current, message, metrics })
    }).catch(() => {});
  }, []);

  // 音畫智慧同步：當伺服器換曲時，若聽眾正在播放且耳機內仍有 4~5 秒音訊緩衝，
  // 延遲更新畫面資訊以完美貼合耳機聽到的新曲第一聲，並消除進度條倒退回彈動畫。
  const [syncedTrack, setSyncedTrack] = useState(currentTrack);
  const [isResettingProgress, setIsResettingProgress] = useState(false);
  const pendingTrackRef = useRef(null);
  const switchTimerRef = useRef(null);

  useEffect(() => {
    if (!currentTrack) return;

    // 尚未初始化或未在播放時，直接同步最新曲目
    if (!syncedTrack || !isPlaying) {
      setSyncedTrack(currentTrack);
      pendingTrackRef.current = null;
      if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
      return;
    }

    // 檢測到伺服器端換曲 (title 變更)
    if (currentTrack.title !== syncedTrack.title) {
      if (pendingTrackRef.current?.title === currentTrack.title) return;
      pendingTrackRef.current = currentTrack;

      if (switchTimerRef.current) clearTimeout(switchTimerRef.current);

      // 動態取得當前音訊前方緩衝量 (例如 4~5 秒)，保底 4.5 秒，上限 6 秒
      const bufferAhead = getBufferAhead(audioRef.current);
      const delayMs = Math.max(3500, Math.min(6000, bufferAhead > 0 ? bufferAhead * 1000 : 4500));

      logEvent('INFO', 'METADATA_SYNC_DELAY', `偵測到曲目切換，保留 ${Math.round(delayMs)}ms 緩衝播放時間，避免畫面提前換歌`);

      // 讓當前曲目進度平穩飽和在 100%
      setSyncedTrack((prev) => ({
        ...prev,
        progress: 100,
        remaining: 0
      }));

      // 等耳機即將播放新曲時，無感平滑切換為新歌
      switchTimerRef.current = setTimeout(() => {
        setIsResettingProgress(true);
        setSyncedTrack(pendingTrackRef.current || currentTrack);
        pendingTrackRef.current = null;
        // 瞬間將進度歸零 (無回彈動畫)，下一個 tick 恢復平滑 transition
        setTimeout(() => setIsResettingProgress(false), 50);
      }, delayMs);
    } else if (!pendingTrackRef.current) {
      // 同一首歌曲且無等待切換，正常跟隨進度更新
      setSyncedTrack(currentTrack);
    }
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    return () => {
      if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
    };
  }, []);

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
  }, [syncedTrack?.title]);

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

  // 鍵盤快速鍵 (適用於客廳電視或電腦電視遙控操作)。
  // 監聽只註冊一次，透過 ref 呼叫最新的處理函式 —— 原本沒有 deps，每秒狀態推播一來就重新註冊一次。
  const keyActionsRef = useRef({});
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return; // 不搶瀏覽器快捷鍵 (Ctrl+F 等)
      const target = e.target;
      const tag = target?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || target?.isContentEditable) return;
      const actions = keyActionsRef.current;
      if (e.code === 'Space') {
        // 焦點在按鈕上時，空白鍵本來就會觸發那顆按鈕，不要再額外切換播放
        if (tag === 'BUTTON' || tag === 'A') return;
        e.preventDefault();
        actions.togglePlay?.();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        actions.toggleFullscreen?.();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        actions.toggleMute?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 初始化 HLS 實例。Hls 為 null 表示 hls.js 載不到，當成不支援 MSE 處理 (改走原生 HLS 或 MP3)
  const initHls = (audio, Hls) => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (!Hls || !Hls.isSupported()) {
      if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        audio.src = hlsStreamUrl;
        audio.preload = 'auto';
        audio.load();
        logEvent('INFO', 'NATIVE_HLS_ATTACHED', '使用 Safari/iOS 原生 HLS 解碼器並已啟動預載');
      } else {
        logEvent('WARN', 'HLS_UNSUPPORTED', '瀏覽器不支援 HLS，自動改用 Icecast MP3');
        setErrorMsg('此瀏覽器不支援 HLS，已自動改用 Icecast MP3 串流。');
        setStreamType('mp3');
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
      // 從 MP3 切過來、或重新建立 HLS 時，若使用者原本在聽就接著播
      if (wantPlayRef.current && audio.paused) {
        audio.play().catch(handlePlayRejected);
      }
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
            logEvent('WARN', 'FALLBACK_TO_MP3', 'HLS 無法復原，自動改用 Icecast MP3');
            setErrorMsg('HLS 串流無法復原，已自動改用 Icecast MP3 串流。');
            setStreamType('mp3');
            break;
        }
      } else {
        logEvent('WARN', 'NON_FATAL_HLS_ERROR', detailMsg);
      }
    });
  };

  // 初始化音訊播放器 (HLS 或 原生 MP3)。切換來源時若使用者正在聽，載入後自動接著播
  // (原本 MP3 → HLS 會停在暫停狀態，畫面卻還顯示播放中)。
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = isMuted ? 0 : volume;
    switchingRef.current = wantPlayRef.current;

    let cancelled = false;
    if (streamType === 'hls') {
      if (wantPlayRef.current) setIsLoading(true);
      loadHls()
        .catch((err) => {
          console.warn('hls.js 載入失敗，改用瀏覽器原生 HLS 或 MP3:', err);
          return null;
        })
        .then((Hls) => {
          if (cancelled) return;
          HlsRef.current = Hls;
          initHls(audio, Hls);
          // hls.js 會在 MANIFEST_PARSED 接著播；原生 HLS (Safari) 直接播
          const native = (!Hls || !Hls.isSupported()) && audio.canPlayType('application/vnd.apple.mpegurl');
          if (wantPlayRef.current && native) {
            audio.play().catch(handlePlayRejected);
          }
        });
    } else {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      logEvent('INFO', 'STREAM_SWITCH', `切換為 Icecast 原生 MP3 持續串流 (CBR ${bitrate || DEFAULT_BITRATE_KBPS} kbps)`);
      if (wantPlayRef.current) {
        audio.src = `${mp3StreamUrl}?nocache=${Date.now()}`;
        setIsLoading(true);
        audio.play().catch(handlePlayRejected);
      } else if (audio.getAttribute('src')) {
        // 沒在聽就不先連 Icecast：MP3 是持續下載的串流，預先連線只會白白佔頻寬
        audio.removeAttribute('src');
        audio.load();
      }
    }

    return () => {
      cancelled = true;
      if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamType]);

  // 定期音訊緩衝健康度診斷檢查 (每 2.5 秒，只在播放中執行)
  useEffect(() => {
    if (!isPlaying) return undefined;
    const interval = setInterval(() => {
      const audio = audioRef.current;
      if (!audio) return;

      const bufferAhead = getBufferAhead(audio);

      // 當播放中且緩衝嚴重不足 (小於 0.6 秒)，記錄警告日誌
      if (!audio.paused && bufferAhead < 0.6 && audio.readyState < 4) {
        logEvent('WARN', 'BUFFER_LOW', `音訊前方緩衝量偏低: ${bufferAhead.toFixed(2)}s (ReadyState: ${audio.readyState})`, {
          bufferAhead: Number(bufferAhead.toFixed(2)),
          readyState: audio.readyState,
          currentTime: Number(audio.currentTime.toFixed(2))
        });
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [isPlaying, logEvent]);

  // play() 被拒絕：AbortError 是使用者取消或切換來源造成的，不算錯誤
  function handlePlayRejected(err) {
    if (err?.name === 'AbortError') return;
    switchingRef.current = false;
    console.warn('Play error:', err);
    wantPlayRef.current = false;
    setIsPlaying(false);
    setIsLoading(false);
    logEvent('ERROR', 'PLAY_EXCEPTION', `播放啟動失敗: ${err?.message || err}`);
    setErrorMsg(
      err?.name === 'NotAllowedError'
        ? '瀏覽器阻擋了自動播放，請再按一次播放鍵。'
        : '播放啟動失敗，若持續不穩可切換為「Icecast MP3」模式。'
    );
  }

  // 控制播放與暫停。緩衝中 (轉圈圈) 也可以按下取消。
  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying || isLoading) {
      wantPlayRef.current = false;
      switchingRef.current = false;
      audio.pause();
      if (streamType === 'mp3') {
        // 斷開 Icecast：暫停後若保留連線，恢復時會先播出暫停前緩衝的舊音訊
        audio.removeAttribute('src');
        audio.load();
      }
      setIsPlaying(false);
      setIsLoading(false);
      logEvent('INFO', 'AUDIO_PAUSE', '使用者手動暫停播放');
      return;
    }

    wantPlayRef.current = true;
    setIsLoading(true);
    setErrorMsg(null);
    logEvent('INFO', 'AUDIO_PLAY_REQUEST', `請求開始播放 (${streamType.toUpperCase()})`);

    if (streamType === 'hls') {
      const Hls = HlsRef.current;
      if (!Hls && !audio.getAttribute('src')) {
        // hls.js 還在下載：載入完成後 MANIFEST_PARSED 會依 wantPlayRef 自動開始播
        return;
      }
      if (Hls?.isSupported()) {
        if (!hlsRef.current) {
          initHls(audio, Hls);
        } else {
          // 保持已預載好的緩衝切片，避免呼叫 loadSource() 沖刷掉緩衝
          hlsRef.current.startLoad();

          // 若停留頁面過久才播放，自動校準至最新 Live Edge 避免脫離直播窗口
          if (audio.seekable && audio.seekable.length > 0) {
            const liveEnd = audio.seekable.end(audio.seekable.length - 1);
            if (liveEnd - audio.currentTime > 24) {
              audio.currentTime = Math.max(0, liveEnd - 12);
            }
          }
        }
      } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        if (!audio.src || !audio.src.includes(hlsStreamUrl)) {
          audio.src = hlsStreamUrl;
        }
      }
    } else {
      audio.src = `${mp3StreamUrl}?nocache=${Date.now()}`;
    }

    try {
      await audio.play();
      if (!wantPlayRef.current) return; // 等待期間已被取消
      setIsPlaying(true);
      setIsLoading(false);
      logEvent('INFO', 'AUDIO_PLAY_SUCCESS', '音訊引擎已成功開始輸出聲音');
    } catch (err) {
      handlePlayRejected(err);
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

  // 給鍵盤快速鍵用的最新處理函式 (見上方只註冊一次的 keydown 監聽)
  keyActionsRef.current = { togglePlay, toggleFullscreen, toggleMute };

  // 重新連線串流
  const reloadStream = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setIsLoading(true);
    setErrorMsg(null);
    switchingRef.current = wantPlayRef.current;
    logEvent('INFO', 'STREAM_RELOAD', `手動觸發串流重連 (${streamType.toUpperCase()})`);

    if (streamType === 'hls') {
      if (hlsRef.current) {
        hlsRef.current.loadSource(hlsStreamUrl);
        hlsRef.current.startLoad();
      } else {
        initHls(audio, HlsRef.current);
      }
    } else {
      audio.src = `${mp3StreamUrl}?nocache=${Date.now()}`;
    }
    if (wantPlayRef.current) {
      audio.play().catch(handlePlayRejected);
    } else {
      setIsLoading(false);
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
    wantPlayRef.current = true; // 媒體鍵／耳機按播放也會走到這裡
    switchingRef.current = false;
    setIsLoading(false);
    setIsPlaying(true);
    setErrorMsg(null);
    logEvent('INFO', 'AUDIO_PLAYING', '音訊恢復正常連續撥放 (Playing)');
  };

  const handleStalled = () => {
    logEvent('WARN', 'AUDIO_STALLED', '觸發 HTML5 Audio stalled: 瀏覽器嘗試抓取音訊但網路未及時回應');
  };

  // 耳機拔除、藍牙耳機或鍵盤媒體鍵暫停：<audio> 停了，UI 也要跟著停
  const handlePause = () => {
    if (switchingRef.current) return;
    if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
    wantPlayRef.current = false;
    setIsPlaying(false);
    setIsLoading(false);
  };

  const handleEnded = () => {
    wantPlayRef.current = false;
    setIsPlaying(false);
    setIsLoading(false);
    logEvent('WARN', 'AUDIO_ENDED', '串流連線已結束');
    setErrorMsg('串流連線已結束，請按播放鍵重新連線。');
  };

  const handleError = () => {
    switchingRef.current = false;
    const err = audioRef.current?.error;
    // 原生 HLS (canPlayType 說支援) 實際上解不了：自動改用 MP3；原本在聽就由切換流程接著播
    if (streamType === 'hls' && !hlsRef.current && err?.code === 4) {
      logEvent('WARN', 'FALLBACK_TO_MP3', '原生 HLS 無法播放 (MEDIA_ERR_SRC_NOT_SUPPORTED)，自動改用 Icecast MP3');
      setErrorMsg('此瀏覽器無法播放 HLS，已自動改用 Icecast MP3 串流。');
      setStreamType('mp3');
      return;
    }
    setIsLoading(false);
    setIsPlaying(false);
    // 暫停 MP3 時會移除 src，那不算錯誤
    if (!wantPlayRef.current) return;
    wantPlayRef.current = false;
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

  const coverUrl = `/api/current/cover?title=${encodeURIComponent(syncedTrack?.title || '')}&v=${encodeURIComponent(syncedTrack?.title || '')}`;

  return (
    <div className="w-full max-w-6xl mx-auto" ref={cardRef}>
      {/* 隱藏原生 Audio 標籤 (掛載嚴謹診斷監聽器，啟用 preload="auto" 達成秒開零等待) */}
      <audio
        ref={audioRef}
        preload="auto"
        onWaiting={handleWaiting}
        onPlaying={handlePlaying}
        onPause={handlePause}
        onEnded={handleEnded}
        onStalled={handleStalled}
        onError={handleError}
        onCanPlay={() => {
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
              <span>{bitrate || DEFAULT_BITRATE_KBPS} kbps</span>
            </div>

            {/* 外部播放器 (VLC、ESP32…) 用的串流網址。原本 PlayerView 有傳 onOpenInfoModal 但畫面上沒有入口 */}
            {onOpenInfoModal && (
              <button
                onClick={onOpenInfoModal}
                className="p-2 flex items-center justify-center bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white border border-slate-700/80 rounded-full transition-all active:scale-95 shadow-sm"
                title="外部播放器與串流網址"
                aria-label="外部播放器與串流網址"
              >
                <Cpu className="w-4 h-4" />
              </button>
            )}

            {/* 客廳電視全螢幕模式切換按鈕 (只留圖示) */}
            <button
              onClick={toggleFullscreen}
              className="p-2 flex items-center justify-center bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white border border-slate-700/80 rounded-full transition-all active:scale-95 shadow-sm"
              title={isFullscreen ? '離開全螢幕 (Esc)' : '電視全螢幕劇院模式 (F)'}
              aria-label={isFullscreen ? '離開全螢幕' : '全螢幕'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {/* 前往管理後台 */}
            <button
              onClick={onSwitchToAdmin}
              className="p-2 text-slate-400 hover:text-purple-400 hover:bg-slate-800/80 rounded-full transition-colors flex items-center gap-1 text-xs"
              title={currentUser ? `已登入 (${currentUser.username}) - 進入管理控制台` : "管理中心登入"}
              aria-label={currentUser ? undefined : '管理中心登入'}
            >
              {currentUser ? (
                <span className="flex items-center gap-1.5 text-purple-400 font-semibold px-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  管理後台
                </span>
              ) : (
                <ExternalLink className="w-4 h-4" />
              )}
            </button>
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
                    alt={syncedTrack?.title || 'Album Cover'}
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
                {syncedTrack?.album && (
                  <span className="text-xs text-slate-400 font-medium truncate max-w-[280px]">
                    {syncedTrack.album}
                  </span>
                )}
              </div>

              {/* 大標題 (單行截斷避免折行，滑鼠懸停可看完整歌名) */}
              <h2
                className="text-2xl sm:text-3xl xl:text-4xl font-black text-white tracking-tight leading-tight truncate drop-shadow"
                title={syncedTrack?.title || 'CastFlow Live'}
              >
                {syncedTrack?.title || 'CastFlow Live'}
              </h2>

              {/* 演出者 */}
              <p className="text-base sm:text-xl font-medium text-slate-300 line-clamp-1">
                {syncedTrack?.artist || '雲原生智慧自動化廣播'}
              </p>
            </div>

            {/* 播放進度條 */}
            <div className="space-y-2">
              <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden relative border border-slate-800/80">
                <div
                  className={`bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 h-full rounded-full shadow-[0_0_12px_rgba(129,140,248,0.5)] ${
                    isResettingProgress || (syncedTrack?.progress === 0)
                      ? 'transition-none'
                      : 'transition-all duration-1000 ease-linear'
                  }`}
                  style={{ width: `${syncedTrack?.progress || 0}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-400 font-mono font-medium">
                <span>{formatTime(syncedTrack?.elapsed)}</span>
                <span>
                  {syncedTrack?.remaining !== null
                    ? `-${formatTime(syncedTrack?.remaining)}`
                    : '--:--'}
                </span>
              </div>
            </div>

            {/* 核心播放控制排 */}
            <div className="flex items-center justify-between gap-4 pt-1">
              <div className="flex items-center gap-3.5">
                {/* 大號撥放/暫停鍵 */}
                {/* 不再綁 online：排程服務 (Node) 掛掉時 Liquidsoap 仍在輸出，HLS / MP3 都還能聽；
                    播放中掉線也必須能按暫停 */}
                <button
                  onClick={togglePlay}
                  className={`w-16 h-16 sm:w-18 sm:h-18 rounded-2xl flex items-center justify-center shadow-xl transition-all transform active:scale-95 bg-gradient-to-tr from-indigo-600 via-purple-600 to-indigo-500 text-white hover:shadow-indigo-500/30 hover:brightness-110 ring-4 ${
                    online || isPlaying ? 'ring-indigo-500/20' : 'ring-slate-700/40 opacity-80'
                  }`}
                  title={
                    isPlaying
                      ? '暫停播放 (空白鍵)'
                      : isLoading
                      ? '緩衝中，點擊取消'
                      : online
                      ? '開始收聽 (空白鍵)'
                      : '電台狀態暫時無法取得，仍可嘗試收聽 (空白鍵)'
                  }
                  aria-label={isPlaying ? '暫停' : isLoading ? '取消緩衝' : '播放'}
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
                  aria-label="重新連線串流"
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
                  aria-label={isMuted ? '取消靜音' : '靜音'}
                  aria-pressed={isMuted}
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
                  aria-label="音量"
                  className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {errorMsg && (
              <p role="alert" className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3.5 py-2">
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
