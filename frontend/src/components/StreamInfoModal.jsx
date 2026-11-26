import React, { useEffect, useId, useRef, useState } from 'react';
import { Copy, Check, Terminal, Cpu } from 'lucide-react';
import Modal, { ModalCloseButton } from './Modal.jsx';
import { DEFAULT_BITRATE_KBPS, copyText, streamEndpoints } from '../utils/stream.js';

export default function StreamInfoModal({ isOpen, onClose, bitrate = DEFAULT_BITRATE_KBPS }) {
  const titleId = useId();
  const [copied, setCopied] = useState('');
  const timerRef = useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (!isOpen) return null;

  const { mp3: icecastUrl, hls: hlsUrl, meta: metaUrl } = streamEndpoints();
  const rows = [
    { key: 'icecast', name: 'Icecast MP3 直連串流 (ESP32 推薦)', badge: `${bitrate || DEFAULT_BITRATE_KBPS} kbps CBR`, badgeClass: 'text-emerald-400', url: icecastUrl },
    { key: 'hls', name: 'Web HLS 切片播放清單 (HLS_URL)', badge: 'm3u8', badgeClass: 'text-indigo-400', url: hlsUrl },
    { key: 'meta', name: '即時中繼資料端點 (META_URL)', badge: 'JSON API', badgeClass: 'text-pink-400', url: metaUrl }
  ];

  const handleCopy = async (text, key) => {
    if (!(await copyText(text))) return;
    setCopied(key);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(''), 2000);
  };

  return (
    <Modal onClose={onClose} titleId={titleId} panelClassName="max-w-xl p-6 sm:p-8">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400" aria-hidden="true">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h3 id={titleId} className="text-lg font-bold text-white">
              硬體與外部串流指南
            </h3>
            <p className="text-xs text-slate-400">支援 ESP32、VLC、foobar2000 與 Home Assistant</p>
          </div>
        </div>
        <ModalCloseButton onClick={onClose} />
      </div>

      <div className="space-y-5 mt-6">
        {rows.map((row) => (
          <div key={row.key} className="space-y-1.5">
            <div className="flex justify-between items-center gap-2 text-xs">
              <span className="font-semibold text-slate-300">{row.name}</span>
              <span className={`font-mono shrink-0 ${row.badgeClass}`}>{row.badge}</span>
            </div>
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300">
              <span className="flex-1 truncate select-all" title={row.url}>
                {row.url}
              </span>
              <button
                type="button"
                onClick={() => handleCopy(row.url, row.key)}
                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                aria-label={copied === row.key ? '已複製' : `複製 ${row.name} 網址`}
                title="複製網址"
              >
                {copied === row.key ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
        ))}

        {/* ESP32 Arduino 快速範例 */}
        <div className="space-y-2">
          <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" /> ESP32 (ESP32-audioI2S) 程式碼範例
          </span>
          <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 font-mono text-[11px] text-slate-400 overflow-x-auto">
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
          </pre>
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-slate-800 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all"
        >
          關閉
        </button>
      </div>
    </Modal>
  );
}
