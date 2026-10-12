import React, { useState } from 'react';
import { Radio, Share2, Copy, Check, ExternalLink, Activity } from 'lucide-react';

export default function StreamEndpointsCard({ showToast }) {
  const [copiedKey, setCopiedKey] = useState(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const hlsUrl = `${origin}/hls/coolradio/live.m3u8`;
  const metaUrl = `${origin}/api/nowplaying/coolradio`;

  const copyToClipboard = (text, key, label) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      if (showToast) {
        showToast(`已複製 ${label} 至剪貼簿`);
      }
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  return (
    <div className="rounded-3xl bg-slate-900/60 border border-slate-800/80 p-5 sm:p-6 backdrop-blur-xl shadow-xl transition-all">
      {/* 頂部標題 */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800/80 mb-5">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Share2 className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-wide">
                外部串流與中繼資料端點 (Stream Endpoints)
              </h3>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                固定端點 / 唯讀
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              供外部播放器、OBS、ESP32 物聯網音響或第三方系統直接接入，自動對應當前網域
            </p>
          </div>
        </div>
      </div>

      {/* 兩組端點清單 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* HLS_URL */}
        <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-indigo-400" />
              <span>HLS 串流網址</span>
              <code className="text-[10px] font-mono text-purple-300 bg-purple-950/40 px-1.5 py-0.5 rounded border border-purple-800/40">
                HLS_URL
              </code>
            </span>
            <span className="text-[10px] font-mono font-medium text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">
              m3u8 切片
            </span>
          </div>

          <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-900/90 border border-slate-800 font-mono text-xs text-slate-200">
            <span className="flex-1 truncate select-all" title={hlsUrl}>
              {hlsUrl}
            </span>
            <button
              onClick={() => copyToClipboard(hlsUrl, 'hls', 'HLS_URL')}
              className={`p-1.5 rounded-lg text-xs flex items-center gap-1 transition-all active:scale-95 ${
                copiedKey === 'hls'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white'
              }`}
              title="複製 HLS_URL"
            >
              {copiedKey === 'hls' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[11px] font-sans">已複製</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-sans">複製</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* META_URL */}
        <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-pink-400" />
              <span>即時中繼資料</span>
              <code className="text-[10px] font-mono text-pink-300 bg-pink-950/40 px-1.5 py-0.5 rounded border border-pink-800/40">
                META_URL
              </code>
            </span>
            <span className="text-[10px] font-mono font-medium text-pink-400 bg-pink-500/10 px-2 py-0.5 rounded-md border border-pink-500/20">
              JSON API
            </span>
          </div>

          <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-900/90 border border-slate-800 font-mono text-xs text-slate-200">
            <span className="flex-1 truncate select-all" title={metaUrl}>
              {metaUrl}
            </span>
            <a
              href={metaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg text-xs bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-all"
              title="在新視窗開啟預覽 JSON"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <button
              onClick={() => copyToClipboard(metaUrl, 'meta', 'META_URL')}
              className={`p-1.5 rounded-lg text-xs flex items-center gap-1 transition-all active:scale-95 ${
                copiedKey === 'meta'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white'
              }`}
              title="複製 META_URL"
            >
              {copiedKey === 'meta' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[11px] font-sans">已複製</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-sans">複製</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
