import React, { createContext, useCallback, useContext, useId, useRef, useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import Modal from './Modal.jsx';

const ConfirmContext = createContext(null);

/**
 * 取代 window.confirm()：瀏覽器原生對話框會卡住整個分頁 (WebSocket 更新、計時器都停)，
 * 樣式也跟後台其他視窗不一致。
 *
 * 用法：const confirm = useConfirm();
 *       if (!(await confirm({ title, message, confirmLabel, danger: true }))) return;
 */
export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((options) => {
    // 前一個還沒回答就又要確認 (理論上不會)：舊的當作取消
    resolveRef.current?.(false);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setRequest(typeof options === 'string' ? { message: options } : options);
    });
  }, []);

  const answer = (value) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setRequest(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && <ConfirmDialog {...request} onAnswer={answer} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm() 需要包在 <ConfirmProvider> 裡');
  return confirm;
}

function ConfirmDialog({ title = '確認操作', message, confirmLabel = '確定', cancelLabel = '取消', danger = false, onAnswer }) {
  const titleId = useId();
  const messageId = useId();
  const Icon = danger ? AlertTriangle : HelpCircle;

  return (
    <Modal onClose={() => onAnswer(false)} titleId={titleId} describedBy={messageId} role="alertdialog" panelClassName="max-w-sm p-6">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center border ${
              danger ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-purple-500/10 border-purple-500/20 text-purple-400'
            }`}
          >
            <Icon className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-bold text-white">
              {title}
            </h3>
            <p id={messageId} className="mt-1 text-xs text-slate-300 leading-relaxed whitespace-pre-line break-words">
              {message}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          {/* 會刪東西、打斷播出的操作預設聚焦在「取消」，誤按 Enter 不會直接執行 */}
          <button
            type="button"
            autoFocus={danger}
            onClick={() => onAnswer(false)}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus={!danger}
            onClick={() => onAnswer(true)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-lg transition-colors ${
              danger ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/20' : 'bg-purple-600 hover:bg-purple-500 shadow-purple-600/20'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
