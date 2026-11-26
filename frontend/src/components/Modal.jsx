import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// 同時開著的視窗 (例如編輯視窗上又跳確認框)：Esc 與 Tab 只交給最上層處理
const stack = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 所有彈出視窗共用的外框：
 * - role="dialog" + aria-modal，用 titleId 指向標題
 * - Esc 關閉 (dismissible=false 時不行，例如正在送出)
 * - Tab 只在視窗內循環，關閉後焦點回到開啟它的按鈕
 * - 開著的時候背景頁面不能捲動
 *
 * 高度超過螢幕時是外層捲動，不會被置中裁掉上半部 (手機上的排程視窗原本會這樣)。
 */
export default function Modal({
  onClose,
  titleId,
  describedBy,
  dismissible = true,
  role = 'dialog',
  panelClassName = 'max-w-md p-6 sm:p-8',
  children
}) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  onCloseRef.current = onClose;
  dismissibleRef.current = dismissible;

  useEffect(() => {
    const panel = panelRef.current;
    const token = {};
    stack.push(token);
    const previouslyFocused = document.activeElement;

    if (stack.length === 1) {
      document.body.dataset.prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    // 子元件的 autoFocus 已經先把焦點放進來就不搶；否則聚焦在視窗本身，讀屏會唸出標題
    if (!panel.contains(document.activeElement)) panel.focus();

    const onKeyDown = (e) => {
      if (stack[stack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        if (dismissibleRef.current) {
          e.stopPropagation();
          onCloseRef.current?.();
        }
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const i = stack.indexOf(token);
      if (i !== -1) stack.splice(i, 1);
      if (stack.length === 0) {
        document.body.style.overflow = document.body.dataset.prevOverflow || '';
        delete document.body.dataset.prevOverflow;
      }
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          ref={panelRef}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={describedBy}
          tabIndex={-1}
          className={`relative w-full rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl outline-none animate-pop-in ${panelClassName}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** 視窗右上角的關閉鈕 (純圖示，一定要有 aria-label) */
export function ModalCloseButton({ onClick, disabled, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="關閉"
      className={`p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-40 ${className}`}
    >
      <X className="w-5 h-5" />
    </button>
  );
}
