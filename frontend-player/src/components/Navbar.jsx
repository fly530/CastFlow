import React from 'react';
import { Radio, Users, Cpu, RadioTower } from 'lucide-react';

export default function Navbar({ online, listeners, onOpenInfoModal }) {
  return (
    <header className="w-full max-w-4xl mx-auto px-4 py-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/25 ring-1 ring-white/20">
          <Radio className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            CastFlow
          </h1>
          <p className="text-xs text-slate-400 font-medium">Cloud-Native Web Radio</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* 在線狀態指示燈 */}
        <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-800/80 rounded-full px-3 py-1.5 shadow-inner">
          <span className="relative flex h-2.5 w-2.5">
            {online && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            )}
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                online ? 'bg-emerald-500' : 'bg-rose-500'
              }`}
            ></span>
          </span>
          <span className="text-xs font-semibold tracking-wide text-slate-300">
            {online ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>

        {/* 聽眾計數 */}
        <div className="flex items-center gap-1.5 bg-slate-900/80 border border-slate-800/80 rounded-full px-3 py-1.5 text-xs text-slate-300">
          <Users className="w-3.5 h-3.5 text-indigo-400" />
          <span className="font-semibold text-white">{listeners}</span>
          <span className="text-slate-400 text-[11px]">聽眾</span>
        </div>

        {/* 硬體連線指南 */}
        <button
          onClick={onOpenInfoModal}
          className="flex items-center gap-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-full px-3 py-1.5 text-xs font-medium transition-all"
          title="ESP32 與硬體連線資訊"
        >
          <Cpu className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">ESP32 / 外部串流</span>
        </button>
      </div>
    </header>
  );
}
