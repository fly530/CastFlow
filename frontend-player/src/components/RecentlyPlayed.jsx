import React, { useState, useEffect } from 'react';
import { History, Music, Clock } from 'lucide-react';

export default function RecentlyPlayed({ triggerRefresh }) {
  const [history, setHistory] = useState([]);

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history?limit=5');
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
  }, [triggerRefresh]);

  if (history.length === 0) {
    return null;
  }

  const formatTimeAgo = (dateStr) => {
    try {
      const date = new Date(dateStr + 'Z');
      const now = new Date();
      const diffSec = Math.floor((now - date) / 1000);
      if (diffSec < 60) return '剛剛';
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分鐘前`;
      return `${Math.floor(diffSec / 3600)} 小時前`;
    } catch {
      return '';
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 mt-6">
      <div className="rounded-3xl bg-slate-900/40 border border-slate-800/60 p-5 sm:p-6 backdrop-blur-xl">
        <div className="flex items-center gap-2 mb-3.5 text-xs font-semibold text-slate-400">
          <History className="w-4 h-4 text-purple-400" />
          <span>剛才播過 (Recently Played)</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {history.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/40 border border-slate-800/50 hover:border-slate-700/60 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center flex-shrink-0">
                  <Music className="w-3.5 h-3.5" />
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
          ))}
        </div>
      </div>
    </div>
  );
}
