import React from 'react';
import { Users, Radio, Cpu } from 'lucide-react';

export default function StatsOverview({ status }) {
  const listeners = status?.icecast?.listeners ?? 0;
  const listenerPeak = status?.icecast?.listenerPeak ?? 0;
  const bitrate = status?.icecast?.bitrate ?? 128;
  const mount = status?.icecast?.mount ?? 'stream';
  const liqStatus = status?.liquidsoap?.status ?? 'OFFLINE';

  const stats = [
    {
      title: '即時在線聽眾',
      value: listeners,
      subValue: `歷史峰值: ${listenerPeak} 人`,
      icon: Users,
      color: 'text-indigo-400',
      bg: 'bg-indigo-500/10 border-indigo-500/20'
    },
    {
      title: 'Icecast 串流狀態',
      value: `${bitrate} kbps`,
      subValue: `掛載點: /${mount} (MP3 CBR)`,
      icon: Radio,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10 border-emerald-500/20'
    },
    {
      title: 'Liquidsoap 引擎狀態',
      value: liqStatus === 'ALIVE' ? '正常運行' : '未連線',
      subValue: 'Telnet Port: 1234 (已連線)',
      icon: Cpu,
      color: liqStatus === 'ALIVE' ? 'text-emerald-400' : 'text-rose-400',
      bg:
        liqStatus === 'ALIVE'
          ? 'bg-emerald-500/10 border-emerald-500/20'
          : 'bg-rose-500/10 border-rose-500/20'
    }
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
      {stats.map((item, idx) => {
        const Icon = item.icon;
        return (
          <div
            key={idx}
            className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg backdrop-blur-xl flex flex-col justify-between"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-400">{item.title}</span>
              <div className={`p-2 rounded-xl border ${item.bg}`}>
                <Icon className={`w-4 h-4 ${item.color}`} />
              </div>
            </div>
            <div>
              <p className="text-2xl font-bold text-white tracking-tight">{item.value}</p>
              <p className="text-xs text-slate-400 mt-1 font-medium">{item.subValue}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
