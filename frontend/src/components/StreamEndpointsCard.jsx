import React, { useState } from 'react';
import { Radio, Music, Share2, Copy, Check, ExternalLink, Activity } from 'lucide-react';

export default function StreamEndpointsCard({ showToast }) {
  const [copiedKey, setCopiedKey] = useState(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';

  // Tailwind 只認得完整的 class 字串，所以各端點的配色直接寫死，不用樣板字串拼色名
  const endpoints = [
    {
      key: 'mp3',
      name: 'MP3 串流網址',
      label: 'MP3_URL',
      url: `${origin}/stream`,
      badge: 'Icecast MP3',
      hint: '給 AIMP、VLC、foobar2000、ESP32 等播放器使用，串流內含歌名',
      Icon: Music,
      iconClass: 'text-emerald-400',
      labelClass: 'text-emerald-300 bg-emerald-950/40 border-emerald-800/40',
      badgeClass: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    },
    {
      key: 'hls',
      name: 'HLS 串流網址',
      label: 'HLS_URL',
      url: `${origin}/hls/coolradio/live.m3u8`,
      badge: 'm3u8 切片',
      hint: '給瀏覽器與 HLS.js 使用，串流本身不含歌名，需搭配 META_URL',
      Icon: Radio,
      iconClass: 'text-indigo-400',
      labelClass: 'text-purple-300 bg-purple-950/40 border-purple-800/40',
      badgeClass: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
    },
    {
      key: 'meta',
      name: '即時中繼資料',
      label: 'META_URL',
      url: `${origin}/api/nowplaying/coolradio`,
      badge: 'JSON API',
      hint: '只有歌曲資訊，不是音訊，無法直接在播放器開啟',
      previewable: true,
      Icon: Activity,
      iconClass: 'text-pink-400',
      labelClass: 'text-pink-300 bg-pink-950/40 border-pink-800/40',
      badgeClass: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
    },
  ];

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

      {/* 端點清單 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {endpoints.map(({ key, name, label, url, badge, hint, previewable, Icon, iconClass, labelClass, badgeClass }) => (
          <div key={key} className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Icon className={`w-3.5 h-3.5 ${iconClass}`} />
                <span>{name}</span>
                <code className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${labelClass}`}>
                  {label}
                </code>
              </span>
              <span className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-md border ${badgeClass}`}>
                {badge}
              </span>
            </div>

            <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-900/90 border border-slate-800 font-mono text-xs text-slate-200">
              <span className="flex-1 truncate select-all" title={url}>
                {url}
              </span>
              {previewable && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg text-xs bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-all"
                  title="在新視窗開啟預覽 JSON"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                onClick={() => copyToClipboard(url, key, label)}
                className={`p-1.5 rounded-lg text-xs flex items-center gap-1 transition-all active:scale-95 ${
                  copiedKey === key
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white'
                }`}
                title={`複製 ${label}`}
              >
                {copiedKey === key ? (
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

            <p className="text-[11px] text-slate-500">{hint}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
