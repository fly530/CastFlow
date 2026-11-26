import React, { useId, useState } from 'react';
import { KeyRound, AlertCircle } from 'lucide-react';
import { changePassword } from '../utils/api.js';
import Modal, { ModalCloseButton } from './Modal.jsx';

export default function ChangePasswordModal({ isOpen, onClose, onSuccess, required = false }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const uid = useId();

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!oldPassword || !newPassword) {
      setError('請填寫完整舊密碼與新密碼');
      return;
    }
    if (newPassword.length < 6) {
      setError('新密碼長度至少需 6 個字元');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('兩次輸入的新密碼不相符');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const res = await changePassword(oldPassword, newPassword);
      if (res.success) {
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
        onSuccess?.('密碼修改成功；其他裝置上的登入已失效，需要用新密碼重新登入');
        onClose?.();
      } else {
        setError(res.error || '密碼修改失敗');
      }
    } catch (err) {
      setError(`網路異常: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal onClose={onClose} titleId={`${uid}-title`} dismissible={!isLoading}>
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center shadow-inner" aria-hidden="true">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h3 id={`${uid}-title`} className="text-lg font-bold text-white">
              修改管理員密碼
            </h3>
            <p className="text-xs text-slate-400">變更初次隨機密碼或設定新密碼</p>
          </div>
        </div>
        <ModalCloseButton onClick={onClose} disabled={isLoading} />
      </div>

      {required && (
        <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>目前使用的是系統產生的初始密碼 (印在伺服器日誌中)，請先設定新密碼。</span>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label htmlFor={`${uid}-old`} className="block text-xs font-medium text-slate-300 mb-1.5">
            目前密碼 (舊密碼)
          </label>
          <input
            id={`${uid}-old`}
            type="password"
            autoComplete="current-password"
            autoFocus
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            required
            className="w-full px-3.5 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-purple-500 transition-colors"
            placeholder="輸入當前密碼"
          />
        </div>

        <div>
          <label htmlFor={`${uid}-new`} className="block text-xs font-medium text-slate-300 mb-1.5">
            設定新密碼
          </label>
          <input
            id={`${uid}-new`}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
            className="w-full px-3.5 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-purple-500 transition-colors"
            placeholder="輸入新密碼 (至少 6 碼)"
          />
        </div>

        <div>
          <label htmlFor={`${uid}-confirm`} className="block text-xs font-medium text-slate-300 mb-1.5">
            確認新密碼
          </label>
          <input
            id={`${uid}-confirm`}
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="w-full px-3.5 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-purple-500 transition-colors"
            placeholder="再次輸入新密碼"
          />
        </div>

        <div className="pt-2 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/25 transition-all disabled:opacity-50"
          >
            {isLoading ? '儲存中...' : '確認更新'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
