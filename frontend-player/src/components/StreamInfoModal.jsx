import React, { useState } from 'react';
import { X, Copy, Check, Terminal, ExternalLink, Cpu } from 'lucide-react';

export default function StreamInfoModal({ isOpen, onClose, bitrate = 256 }) {
  const [copied, setCopied] = useState('');

  if (!isOpen) return null;

  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const port = typeof window !== 'undefined' && window.location.port ? `:${window.location.port}` : '';
  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
  const origin = `${protocol}//${hostname}${port}`;
  const icecastUrl = `${origin}/stream`;
  const hlsUrl = `${origin}/hls/live.m3u8`;

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl p-6 sm:p-8 overflow-hidden">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">硬體與外部串流指南</h3>
              <p className="text-xs text-slate-400">支援 ESP32、VLC、foobar2000 與 Home Assistant</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-5 mt-6">
          {/* Icecast MP3 串流 */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-300">Icecast MP3 直連串流 (ESP32 推薦)</span>
              <span className="text-emerald-400 font-mono">{bitrate || 256} kbps CBR</span>
            </div>
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300">
              <span className="flex-1 truncate">{icecastUrl}</span>
              <button
                onClick={() => copyToClipboard(icecastUrl, 'icecast')}
                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                title="複製網址"
              >
                {copied === 'icecast' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* HLS 切片串流 */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-300">Web HLS 切片播放清單 (現代瀏覽器)</span>
              <span className="text-indigo-400 font-mono">m3u8</span>
            </div>
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300">
              <span className="flex-1 truncate">{hlsUrl}</span>
              <button
                onClick={() => copyToClipboard(hlsUrl, 'hls')}
                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                title="複製網址"
              >
                {copied === 'hls' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* ESP32 Arduino 快速範例 */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-indigo-400" /> ESP32 (ESP32-audioI2S) 程式碼範例
            </span>
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 font-mono text-[11px] text-slate-400 overflow-x-auto">
              <code>
                {`#include "Audio.h"
Audio audio;

void setup() {
  WiFi.begin(SSID, PASSWORD);
  audio.setPinout(I2S_BCLK, I2S_LRC, I2S_DOUT);
  audio.setVolume(12);
  audio.connecttohost("${icecastUrl}");
}

void loop() {
  audio.loop();
}`}
              </code>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
