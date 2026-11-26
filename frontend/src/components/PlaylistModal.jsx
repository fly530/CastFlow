import React, { useState, useEffect, useId } from 'react';
import { ListMusic, AlertCircle } from 'lucide-react';
import { authFetch, readJson } from '../utils/api.js';
import Modal, { ModalCloseButton } from './Modal.jsx';

export default function PlaylistModal({ isOpen, onClose, editingPlaylist, onSaved }) {
  const uid = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#8b5cf6');
  const [playMode, setPlayMode] = useState('shuffle');
  const [transition, setTransition] = useState('smart');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (isOpen) {
      if (editingPlaylist) {
        setName(editingPlaylist.name || '');
        setDescription(editingPlaylist.description || '');
        setColor(editingPlaylist.color || '#8b5cf6');
        setPlayMode(editingPlaylist.play_mode || 'shuffle');
        setTransition(editingPlaylist.transition || 'smart');
      } else {
        setName('');
        setDescription('');
        setColor('#8b5cf6');
        setPlayMode('shuffle');
        setTransition('smart');
      }
      setErrorMsg(null);
    }
  }, [isOpen, editingPlaylist]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('請輸入歌單名稱');
      return;
    }

    try {
      setIsSaving(true);
      setErrorMsg(null);

      const generatedId = editingPlaylist ? editingPlaylist.id : ('pl_' + Date.now().toString(36));

      const payload = {
        id: generatedId,
        name: name.trim(),
        description: description.trim(),
        color,
        play_mode: playMode,
        transition
      };

      const url = editingPlaylist ? `/api/playlists/${editingPlaylist.id}` : '/api/playlists';
      const method = editingPlaylist ? 'PUT' : 'POST';

      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // 401 時 authFetch 已經清掉登入狀態，整個後台會切回登入頁
      if (res.status === 401) return;

      const json = await readJson(res);
      if (res.ok && json.success) {
        onSaved?.(json.message || '歌單已成功儲存');
        onClose();
      } else {
        setErrorMsg(json.error || '儲存失敗');
      }
    } catch (err) {
      setErrorMsg(`網路異常: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} titleId={`${uid}-title`} dismissible={!isSaving} panelClassName="max-w-lg p-6 sm:p-8">
      {/* 頂部 Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/20 ring-1 ring-white/10 flex-shrink-0" aria-hidden="true">
            <ListMusic className="w-5 h-5" />
          </div>
          <div>
            <h3 id={`${uid}-title`} className="text-lg font-bold text-white break-words">
              {editingPlaylist ? `編輯歌單：${editingPlaylist.name}` : '新建廣播歌單'}
            </h3>
            <p className="text-xs text-slate-400">自訂歌單名稱並配置轉場與播放模式</p>
          </div>
        </div>
        <ModalCloseButton onClick={onClose} disabled={isSaving} className="shrink-0" />
      </div>

      {errorMsg && (
        <div role="alert" className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label htmlFor={`${uid}-name`} className="block text-xs font-semibold text-slate-300 mb-1.5">
            歌單名稱
          </label>
          <input
            id={`${uid}-name`}
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="例如: 午後放鬆爵士"
            className="w-full px-3.5 py-2 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-purple-500"
          />
        </div>

        <div>
          <label htmlFor={`${uid}-desc`} className="block text-xs font-semibold text-slate-300 mb-1.5">
            歌單描述備註
          </label>
          <input
            id={`${uid}-desc`}
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="選填，簡要說明此歌單特色"
            className="w-full px-3.5 py-2 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* 播放模式與轉場過渡 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div>
            <label htmlFor={`${uid}-mode`} className="block text-xs font-semibold text-slate-300 mb-1.5">
            播放模式
          </label>
            <select
              id={`${uid}-mode`}
              value={playMode}
              onChange={(e) => setPlayMode(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-purple-500"
            >
              <option value="shuffle">隨機打亂 (Shuffle)</option>
              <option value="sequential">循序播放 (Sequential)</option>
            </select>
          </div>

          <div>
            <label htmlFor={`${uid}-transition`} className="block text-xs font-semibold text-slate-300 mb-1.5">
            轉場過渡方式
          </label>
            <select
              id={`${uid}-transition`}
              value={transition}
              onChange={(e) => setTransition(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-purple-500"
            >
              <option value="smart">智慧交疊 (Smart Crossfade)</option>
              <option value="fade">固定淡入淡出 (Fade 3s)</option>
              <option value="cut">無縫硬切 (Cut)</option>
            </select>
          </div>
        </div>

        {/* 底部按鈕 */}
        <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/25 transition-all disabled:opacity-50"
          >
            {isSaving ? '儲存中...' : editingPlaylist ? '確認更新' : '建立歌單'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
