import React from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, X } from 'lucide-react';

const STYLES = {
  success: {
    box: 'bg-emerald-950/90 text-emerald-200 border-emerald-800/80 shadow-emerald-950/50',
    Icon: CheckCircle2,
    icon: 'text-emerald-400'
  },
  warning: {
    box: 'bg-amber-950/90 text-amber-200 border-amber-800/80 shadow-amber-950/50',
    Icon: AlertTriangle,
    icon: 'text-amber-400'
  },
  error: {
    box: 'bg-rose-950/90 text-rose-200 border-rose-800/80 shadow-rose-950/50',
    Icon: AlertCircle,
    icon: 'text-rose-400'
  }
};

/**
 * 通知訊息。外層的 live region 一直掛在頁面上，讀屏才會唸出「之後才出現」的內容；
 * 原本整個元件在沒有訊息時 return null，第一則通知常常不會被唸出來。
 * 錯誤用 assertive (打斷目前朗讀)，其他用 polite。
 */
export default function Toast({ toast, onClose }) {
  const style = toast ? STYLES[toast.type] || STYLES.success : null;
  const Icon = style?.Icon;
  const urgent = toast?.type === 'error';

  return (
    <div
      className="fixed bottom-6 right-6 left-6 sm:left-auto z-[60] flex justify-end pointer-events-none"
      aria-live={urgent ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {toast && (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-2xl shadow-2xl border backdrop-blur-xl text-xs font-semibold max-w-md animate-pop-in ${style.box}`}
        >
          <Icon className={`w-4 h-4 flex-shrink-0 mt-px ${style.icon}`} aria-hidden="true" />
          <span className="whitespace-pre-line break-words">{toast.message}</span>
          <button
            onClick={onClose}
            aria-label="關閉通知"
            className="ml-2 text-slate-400 hover:text-white p-0.5 rounded-lg flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
