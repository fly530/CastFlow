import React, { useState, useRef } from 'react';
import { X, UploadCloud, FileAudio, CheckCircle2, AlertCircle } from 'lucide-react';
import { authFetch } from '../utils/api.js';

export default function FileUploadModal({ isOpen, onClose, playlistId, playlistName, onUploadSuccess, onRequestLogin }) {
  const [files, setFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(Array.from(e.target.files));
    }
  };

  const addFiles = (newFiles) => {
    setErrorMsg(null);
    const validMp3s = newFiles.filter(
      (f) => f.name.toLowerCase().endsWith('.mp3') || f.type.includes('audio')
    );
    if (validMp3s.length < newFiles.length) {
      setErrorMsg('已自動過濾非 MP3 檔案，系統僅接受 MP3 格式。');
    }
    setFiles((prev) => [...prev, ...validMp3s]);
  };

  const removeFile = (idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (files.length === 0) return;

    try {
      setIsUploading(true);
      setErrorMsg(null);

      const formData = new FormData();
      files.forEach((file) => {
        formData.append('files', file);
      });

      const res = await authFetch(`/api/playlists/${playlistId}/upload`, {
        method: 'POST',
        body: formData
      });

      if (res.status === 401) {
        setErrorMsg('權限不足或登入已過期，請先登入管理員帳號。');
        onRequestLogin?.();
        return;
      }

      const json = await res.json();
      if (res.ok && json.success) {
        onUploadSuccess?.(json.message);
        onClose();
        setFiles([]);
      } else {
        setErrorMsg(json.error || '上傳失敗');
      }
    } catch (err) {
      setErrorMsg(`網路異常: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl p-6 sm:p-8 overflow-hidden">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-lg font-bold text-white">上傳 MP3 至「{playlistName || playlistId}」</h3>
            <p className="text-xs text-slate-400">支援多選拖曳，上傳完成後引擎自動重載</p>
          </div>
          <button
            onClick={onClose}
            disabled={isUploading}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 拖曳上傳區域 */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`mt-6 border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
            dragActive
              ? 'border-purple-500 bg-purple-500/10 scale-[1.01]'
              : 'border-slate-700/80 bg-slate-950/40 hover:border-slate-600 hover:bg-slate-900/50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".mp3,audio/mpeg"
            onChange={handleChange}
            className="hidden"
          />
          <UploadCloud className="w-12 h-12 text-purple-400 mx-auto mb-3" />
          <p className="text-sm font-semibold text-white">點擊選取或拖曳 MP3 檔案至此</p>
          <p className="text-xs text-slate-400 mt-1">支援批次上傳多個檔案，單檔上限 100MB</p>
        </div>

        {errorMsg && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* 已選檔案清單 */}
        {files.length > 0 && (
          <div className="mt-4 max-h-48 overflow-y-auto space-y-2 pr-1">
            <p className="text-xs font-semibold text-slate-400 mb-1">
              已選取 {files.length} 個檔案：
            </p>
            {files.map((f, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileAudio className="w-4 h-4 text-purple-400 flex-shrink-0" />
                  <span className="truncate text-slate-200">{f.name}</span>
                  <span className="text-slate-500 font-mono text-[11px] flex-shrink-0">
                    ({(f.size / (1024 * 1024)).toFixed(1)} MB)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(idx);
                  }}
                  disabled={isUploading}
                  className="text-slate-500 hover:text-rose-400 p-1 rounded"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 底部動作按鈕 */}
        <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
          <button
            onClick={onClose}
            disabled={isUploading}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={files.length === 0 || isUploading}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/25 transition-all disabled:opacity-50"
          >
            {isUploading ? '正在上傳並解析...' : `開始上傳 (${files.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
