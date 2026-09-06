import React, { useState, useEffect } from 'react';
import {
  X,
  Activity,
  RefreshCw,
  Copy,
  Check,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Radio,
  FileText
} from 'lucide-react';

export default function PlaybackDiagnosticModal({
  isOpen,
  onClose,
  streamType,
  audioDiagnostics,
  localLogs = []
}) {
  const [serverLogs, setServerLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState('live'); // 'live' | 'server'
  const [autoRefresh, setAutoRefresh] = useState(true);

  if (!isOpen) return null;

  const fetchServerLogs = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/logs/playback?limit=100');
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setServerLogs(json.data || []);
        }
      }
    } catch (err) {
      console.error('Failed to fetch server playback logs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchServerLogs();
  }, [isOpen]);

  useEffect(() => {
    if (!autoRefresh || !isOpen) return;
    const interval = setInterval(() => {
      fetchServerLogs();
    }, 4000);
    return () => clearInterval(interval);
  }, [autoRefresh, isOpen]);

  const handleClearServerLogs = async () => {
    try {
      await fetch('/api/logs/playback', { method: 'DELETE' });
      setServerLogs([]);
    } catch (err) {
      console.error('Failed to clear playback logs:', err);
    }
  };

  const handleCopyLogs = () => {
    const logsToCopy = activeTab === 'live' ? localLogs : serverLogs;
    const text = logsToCopy
      .map(
        (l) =>
          `[${l.timestamp}] [${l.level}] [${l.streamType || streamType}] [${l.event}] ${l.message} ${
            l.metrics ? JSON.stringify(l.metrics) : ''
          }`
      )
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayedLogs = activeTab === 'live' ? localLogs : serverLogs;

  const getLevelBadge = (level) => {
    switch (level) {
      case 'ERROR':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/30';
      case 'WARN':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      default:
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-md animate-in fade-in duration-200 select-text">
      <div className="relative w-full max-w-4xl max-h-[90vh] rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl flex flex-col overflow-hidden">
        
        {/* 頂部標題與即時健康狀態 */}
        <div className="p-5 sm:p-6 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 ring-1 ring-white/10">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white tracking-tight">播放狀態與日誌診斷中心</h3>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Live Diagnostics
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">即時監控音訊緩衝、連線事件與播放中斷原因</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
            title="關閉視窗 (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 核心健康指標四宮格卡片 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 sm:p-6 bg-slate-900/50 border-b border-slate-800 text-xs">
          {/* 1. 串流模式 */}
          <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800/80">
            <span className="text-slate-500 block mb-1">當前串流來源</span>
            <div className="flex items-center gap-1.5 font-bold text-white">
              <Radio className="w-3.5 h-3.5 text-indigo-400" />
              <span>{streamType === 'hls' ? 'HLS 切片串流' : 'Icecast MP3 直播'}</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono mt-1 block">
              {streamType === 'hls' ? '/hls/live.m3u8' : '/stream (CBR)'}
            </span>
          </div>

          {/* 2. 緩衝健康秒數 */}
          <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800/80">
            <span className="text-slate-500 block mb-1">音訊前方緩衝長度</span>
            <div className="flex items-center gap-1.5 font-bold font-mono">
              <span
                className={`text-sm ${
                  audioDiagnostics?.bufferAhead > 3
                    ? 'text-emerald-400'
                    : audioDiagnostics?.bufferAhead > 0.8
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {audioDiagnostics?.bufferAhead !== undefined
                  ? `${audioDiagnostics.bufferAhead.toFixed(1)} 秒`
                  : '--'}
              </span>
              <span className="text-[10px] text-slate-500">
                {audioDiagnostics?.bufferAhead > 3
                  ? '(健康)'
                  : audioDiagnostics?.bufferAhead > 0.8
                  ? '(偏低)'
                  : '(危險)'}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono mt-1 block">
              ReadyState: {audioDiagnostics?.readyState ?? 0}/4
            </span>
          </div>

          {/* 3. 播放狀態 */}
          <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800/80">
            <span className="text-slate-500 block mb-1">音訊元件狀態</span>
            <div className="flex items-center gap-1.5 font-bold">
              <span
                className={`w-2 h-2 rounded-full ${
                  audioDiagnostics?.isPlaying
                    ? 'bg-emerald-400 animate-pulse'
                    : audioDiagnostics?.isWaiting
                    ? 'bg-amber-400 animate-ping'
                    : 'bg-slate-500'
                }`}
              />
              <span className="text-white">
                {audioDiagnostics?.isWaiting
                  ? '轉圈緩衝中 (Waiting)'
                  : audioDiagnostics?.isPlaying
                  ? '正常播放中'
                  : '暫停 / 停止'}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono mt-1 block">
              Network: {audioDiagnostics?.networkState ?? 0}
            </span>
          </div>

          {/* 4. 累積時間與錯誤次數 */}
          <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800/80">
            <span className="text-slate-500 block mb-1">錯誤與卡頓累計</span>
            <div className="flex items-center gap-2 font-bold font-mono">
              <span
                className={`text-sm ${
                  (audioDiagnostics?.errorCount || 0) > 0 ? 'text-rose-400' : 'text-slate-300'
                }`}
              >
                {audioDiagnostics?.errorCount || 0} 次異常
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono mt-1 block">
              重試: {audioDiagnostics?.retryCount || 0} 次
            </span>
          </div>
        </div>

        {/* 頁籤切換與功能列 */}
        <div className="px-5 py-3 bg-slate-950/40 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('live')}
              className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'live'
                  ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              即時前端日誌 ({localLogs.length})
            </button>
            <button
              onClick={() => setActiveTab('server')}
              className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'server'
                  ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              伺服器持久日誌 ({serverLogs.length})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                autoRefresh
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
            >
              自動刷新: {autoRefresh ? '開' : '關'}
            </button>

            <button
              onClick={fetchServerLogs}
              disabled={isLoading}
              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
              title="重新整理日誌"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={handleCopyLogs}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title="複製所有日誌文字"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? '已複製' : '複製日誌'}</span>
            </button>

            {activeTab === 'server' && (
              <button
                onClick={handleClearServerLogs}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-colors"
                title="清空伺服器日誌"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>清空</span>
              </button>
            )}
          </div>
        </div>

        {/* 日誌表格展示清單 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 max-h-[420px] font-mono text-xs">
          {displayedLogs.length === 0 ? (
            <div className="py-12 text-center text-slate-500 flex flex-col items-center gap-2">
              <FileText className="w-8 h-8 opacity-40" />
              <span>尚無播放日誌記錄，正在持續監控音訊串流...</span>
            </div>
          ) : (
            displayedLogs.map((log, idx) => (
              <div
                key={log.id || idx}
                className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60 hover:border-slate-700/80 transition-all flex flex-col sm:flex-row sm:items-start justify-between gap-2"
              >
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase flex-shrink-0 ${getLevelBadge(
                      log.level
                    )}`}
                  >
                    {log.level}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-200">{log.event}</span>
                      {log.streamType && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                          {log.streamType.toUpperCase()}
                        </span>
                      )}
                    </div>

                    {log.message && (
                      <p className="text-slate-300 mt-0.5 break-words font-sans text-xs">{log.message}</p>
                    )}

                    {log.metrics && (
                      <div className="mt-1 text-[11px] text-slate-400 bg-slate-900/80 p-1.5 rounded-lg border border-slate-800">
                        {Object.entries(log.metrics).map(([k, v]) => (
                          <span key={k} className="inline-block mr-3">
                            <span className="text-slate-500">{k}:</span>{' '}
                            <span className="text-indigo-300 font-semibold">{String(v)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-[10px] text-slate-500 flex-shrink-0 sm:text-right">
                  {log.timestamp ? log.timestamp.split('T')[1]?.slice(0, 12) || log.timestamp : ''}
                </div>
              </div>
            ))
          )}
        </div>

        {/* 底部說明 */}
        <div className="p-3 bg-slate-950/80 border-t border-slate-800 text-[11px] text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            日誌檔案路徑: <code className="text-slate-400 font-mono">/music/logs/playback.log</code>
          </span>
          <span className="text-indigo-400">
            若發現 HLS 頻繁卡頓，可切換至「Icecast MP3」模式享有連續直連串流。
          </span>
        </div>

      </div>
    </div>
  );
}
