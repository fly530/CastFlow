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

export default function Toast({ toast, onClose }) {
  if (!toast) return null;

  const style = STYLES[toast.type] || STYLES.success;
  const { Icon } = style;

  return (
    <div
      className="fixed bottom-6 right-6 left-6 sm:left-auto z-[60] flex justify-end pointer-events-none"
      role={toast.type === 'error' ? 'alert' : 'status'}
    >
      <div
        className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-2xl shadow-2xl border backdrop-blur-xl text-xs font-semibold max-w-md ${style.box}`}
      >
        <Icon className={`w-4 h-4 flex-shrink-0 mt-px ${style.icon}`} />
        <span className="whitespace-pre-line break-words">{toast.message}</span>
        <button
          onClick={onClose}
          aria-label="關閉通知"
          className="ml-2 text-slate-400 hover:text-white p-0.5 rounded-lg flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
