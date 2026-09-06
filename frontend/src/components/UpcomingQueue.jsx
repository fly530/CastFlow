import React from 'react';
import { ListMusic, Music, Clock, Sparkles } from 'lucide-react';

export default function UpcomingQueue({ upcoming = [], playlistsSummary = [] }) {
  // 若後端有提供特定即將播放佇列，直接呈現；若無，呈現排程預備說明
  const hasQueue = upcoming && upcoming.length > 0;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 mt-8">
      <div className="rounded-3xl bg-slate-900/60 border border-slate-800/80 p-6 sm:p-8 backdrop-blur-xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <ListMusic className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">
                接下來的歌曲 (Upcoming Tracks)
              </h3>
              <p className="text-xs text-slate-400">依據 Liquidsoap 智慧排程規則自動載入</p>
            </div>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-indigo-300/80 bg-indigo-950/50 border border-indigo-800/50 rounded-full px-3 py-1 font-medium">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            自動打亂輪播
          </span>
        </div>

        {hasQueue ? (
          <div className="space-y-3">
            {upcoming.slice(0, 3).map((track, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-950/40 border border-slate-800/60 hover:border-slate-700/80 transition-all group"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <span className="w-7 h-7 rounded-lg bg-slate-800/80 flex items-center justify-center text-xs font-mono font-bold text-slate-400 group-hover:text-indigo-400 group-hover:bg-indigo-950/50 transition-colors">
                    #{idx + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-200 truncate group-hover:text-white">
                      {track.title || 'Unknown Title'}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {track.artist || '歌單自動輪替曲目'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] font-mono font-medium px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                    歌單 {track.playlist || 'A'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[1, 2, 3].map((num) => (
              <div
                key={num}
                className="p-4 rounded-2xl bg-slate-950/30 border border-slate-800/50 flex flex-col justify-between space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    #{num} 即將播放
                  </span>
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-300">
                    {num === 1
                      ? '依日常 3:1 權重選取'
                      : num === 2
                      ? '智慧淡入淡出接續'
                      : '整點前自動插入 C 歌單'}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">隨機打亂佇列待命中</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
