import React, { useId, useState } from 'react';
import { Terminal, Send } from 'lucide-react';
import { authFetch, readJson } from '../utils/api.js';
import Modal, { ModalCloseButton } from './Modal.jsx';

export default function TelnetConsoleModal({ isOpen, onClose }) {
  const titleId = useId();
  const [command, setCommand] = useState('radio.status');
  const [output, setOutput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const quickCommands = [
    'radio.status',
    'uptime',
    'version',
    'icecast_mp3.metadata',
    'icecast_mp3.remaining',
    'radio.reload_all',
    'priority_queue.queue',
    'dynamic_queue.queue'
  ];

  const handleSend = async (cmdToSend) => {
    const cmd = cmdToSend || command;
    if (!cmd.trim()) return;

    try {
      setIsLoading(true);
      const res = await authFetch('/api/control/telnet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd.trim() })
      });

      // 401 時 authFetch 已經清掉登入狀態，整個後台會切回登入頁
      if (res.status === 401) return;

      const json = await readJson(res);
      if (res.ok && json.success) {
        setOutput((prev) => `> ${cmd}\n${json.result || '(空回應)'}\n\n${prev}`);
      } else {
        setOutput((prev) => `> ${cmd}\n[錯誤] ${json.error || '執行失敗'}\n\n${prev}`);
      }
    } catch (err) {
      setOutput((prev) => `> ${cmd}\n[網路錯誤] ${err.message}\n\n${prev}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal onClose={onClose} titleId={titleId} panelClassName="max-w-2xl p-6 sm:p-8">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400" aria-hidden="true">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <h3 id={titleId} className="text-lg font-bold text-white">
              Liquidsoap Telnet 控制台
            </h3>
            <p className="text-xs text-slate-400">直接與廣播底層引擎溝通並測試腳本狀態</p>
          </div>
        </div>
        <ModalCloseButton onClick={onClose} />
      </div>

      {/* 常用快捷按鈕 */}
      <div className="mt-4 flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-semibold text-slate-500 mr-1">常用指令:</span>
        {quickCommands.map((q) => (
          <button
            key={q}
            onClick={() => {
              setCommand(q);
              handleSend(q);
            }}
            disabled={isLoading}
            className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-purple-300 hover:bg-slate-800 transition-colors"
          >
            {q}
          </button>
        ))}
      </div>

      {/* 輸入指令列 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="mt-4 flex gap-2"
      >
        <div className="relative flex-1">
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="例如: radio.status, help, uptime..."
            aria-label="Telnet 指令"
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 font-mono text-xs text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading || !command.trim()}
          className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" />
          <span>發送</span>
        </button>
      </form>

      {/* 輸出終端畫面 */}
      <div
        role="log"
        aria-live="polite"
        aria-label="指令輸出"
        className="mt-4 p-4 rounded-2xl bg-black border border-slate-800 font-mono text-xs text-emerald-400 h-64 overflow-y-auto whitespace-pre-wrap break-all shadow-inner"
      >
        {output || '/* 等待指令輸入中... 請輸入指令或點擊上方快捷鍵 */'}
      </div>
    </Modal>
  );
}
