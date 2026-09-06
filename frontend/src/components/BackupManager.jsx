import React, { useState, useEffect, useRef } from 'react';
import {
  Archive,
  Download,
  Upload,
  RotateCcw,
  Trash2,
  FileJson,
  CheckCircle2,
  AlertCircle,
  Clock,
  HardDrive,
  RefreshCw,
  FolderArchive,
  Calendar,
  ListMusic,
  FileDown,
  Info,
  Music
} from 'lucide-react';
import { authFetch } from '../utils/api.js';

export default function BackupManager({ onRequestLogin, showToast, onRestoreSuccess }) {
  const [backups, setBackups] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupDir, setBackupDir] = useState('music/backups');
  const [restoreModalData, setRestoreModalData] = useState(null); // { type: 'file' | 'data', filename?, data? }
  const [isRestoring, setIsRestoring] = useState(false);
  const fileInputRef = useRef(null);

  const fetchBackups = async () => {
    try {
      setIsLoading(true);
      const res = await authFetch('/api/backups');
      if (res.status === 401) {
        onRequestLogin?.();
        return;
      }
      const json = await res.json();
      if (json.success) {
        setBackups(json.data || []);
        if (json.backupDir) setBackupDir(json.backupDir);
      }
    } catch (err) {
      console.error('Failed to load backups:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  // 觸發瀏覽器下載 Blob
  const triggerDownloadBlob = (blob, filename) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  // 下載備份檔案 (UTF-8 BOM 修正，防止 Windows/Excel 亂碼)
  const handleDownload = async (filename) => {
    try {
      const res = await authFetch(`/api/backups/${encodeURIComponent(filename)}/download`);
      if (res.status === 401) {
        showToast?.('管理員憑證已失效，請先登入', 'error');
        onRequestLogin?.();
        return;
      }
      if (!res.ok) {
        throw new Error(`下載失敗 (${res.status})`);
      }

      let blob;
      if (filename.toLowerCase().endsWith('.json')) {
        const text = await res.text();
        // 加入 UTF-8 BOM (\uFEFF) 確保 Windows 記事本、Excel 等軟體開啟時 100% 正確識別 UTF-8 中文
        blob = new Blob(['\uFEFF' + text], { type: 'application/json;charset=utf-8' });
      } else {
        blob = await res.blob();
      }

      triggerDownloadBlob(blob, filename);
      showToast?.(`已開始下載備份檔「${filename}」`);
    } catch (err) {
      showToast?.(`下載備份失敗: ${err.message}`, 'error');
    }
  };

  // 建立設定備份 (.json)
  const handleCreateBackup = async (autoDownload = false) => {
    try {
      setIsBackingUp(true);
      const res = await authFetch('/api/backups', { method: 'POST' });
      if (res.status === 401) {
        showToast?.('管理員憑證已失效，請先登入', 'error');
        onRequestLogin?.();
        return;
      }
      const json = await res.json();
      if (res.ok && json.success) {
        showToast?.(
          autoDownload
            ? `設定備份已建立並儲存至 ${backupDir}，正在下載至本機...`
            : `設定備份已儲存至 ${backupDir}/${json.data?.filename}`
        );
        fetchBackups();

        if (autoDownload && json.data?.filename) {
          await handleDownload(json.data.filename);
        }
      } else {
        showToast?.(`建立備份失敗: ${json.error || '未知錯誤'}`, 'error');
      }
    } catch (err) {
      showToast?.(`建立備份連線異常: ${err.message}`, 'error');
    } finally {
      setIsBackingUp(false);
    }
  };

  // 建立全站完整備份 (.zip，含所有 MP3 歌曲與設定)
  const handleCreateFullZipBackup = async () => {
    try {
      setIsBackingUp(true);
      showToast?.('正在將所有歌單設定與實體 MP3 音訊檔案打包為 ZIP，請稍候...');
      const res = await authFetch('/api/backups/full-zip', { method: 'POST' });
      if (res.status === 401) {
        showToast?.('管理員憑證已失效，請先登入', 'error');
        onRequestLogin?.();
        return;
      }
      const json = await res.json();
      if (res.ok && json.success) {
        showToast?.(`全站音訊完整備份已成功打包（${formatBytes(json.data?.size)}），正在下載...`);
        fetchBackups();
        if (json.data?.filename) {
          await handleDownload(json.data.filename);
        }
      } else {
        showToast?.(`全站備份失敗: ${json.error || '未知錯誤'}`, 'error');
      }
    } catch (err) {
      showToast?.(`連線異常: ${err.message}`, 'error');
    } finally {
      setIsBackingUp(false);
    }
  };

  // 刪除備份檔
  const handleDeleteBackup = async (filename) => {
    if (!window.confirm(`確定要刪除備份檔「${filename}」嗎？此操作將永久從伺服器磁碟移除。`)) {
      return;
    }
    try {
      const res = await authFetch(`/api/backups/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
      });
      if (res.status === 401) {
        showToast?.('請先登入管理員帳號', 'error');
        onRequestLogin?.();
        return;
      }
      const json = await res.json();
      if (res.ok && json.success) {
        showToast?.(json.message || `已刪除備份「${filename}」`);
        fetchBackups();
      } else {
        showToast?.(`刪除失敗: ${json.error}`, 'error');
      }
    } catch (err) {
      showToast?.(`連線異常: ${err.message}`, 'error');
    }
  };

  // 本機上傳 JSON 備份檔觸發
  const handleUploadFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const parsed = JSON.parse(text);
        if (!parsed.playlists || !parsed.schedules) {
          showToast?.('所選檔案非合法 CastFlow 備份檔 (缺少歌單或排程配置)', 'error');
          return;
        }
        setRestoreModalData({
          type: 'data',
          filename: file.name,
          data: parsed,
          stats: {
            playlistsCount: parsed.playlists?.length || 0,
            schedulesCount: parsed.schedules?.length || 0,
            totalTracks: parsed.stats?.totalTracks || 0
          }
        });
      } catch (err) {
        showToast?.(`無法解析 JSON 檔案: ${err.message}`, 'error');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  // 確認執行還原
  const handleConfirmRestore = async () => {
    if (!restoreModalData) return;
    try {
      setIsRestoring(true);
      let res;
      if (restoreModalData.type === 'file') {
        res = await authFetch(
          `/api/backups/${encodeURIComponent(restoreModalData.filename)}/restore`,
          { method: 'POST' }
        );
      } else {
        res = await authFetch('/api/backups/restore-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(restoreModalData.data)
        });
      }

      if (res.status === 401) {
        showToast?.('請先登入管理員帳號', 'error');
        onRequestLogin?.();
        return;
      }

      const json = await res.json();
      if (res.ok && json.success) {
        showToast?.(json.message || '歌單與排程配置已成功還原！');
        setRestoreModalData(null);
        onRestoreSuccess?.();
      } else {
        showToast?.(`還原失敗: ${json.error}`, 'error');
      }
    } catch (err) {
      showToast?.(`還原異常: ${err.message}`, 'error');
    } finally {
      setIsRestoring(false);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDateTime = (isoString) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-6">
      {/* 隱藏的檔案上傳 Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleUploadFile}
        accept=".json,application/json"
        className="hidden"
      />

      {/* 頂部操作與資訊卡片 */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          
          {/* 左側說明 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/20 ring-1 ring-white/10">
                <FolderArchive className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                  <span>歌單與排程備份中心</span>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    Backup & Restore
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  支援「輕量設定備份 (.json)」與「全站歌曲音訊完整備份 (.zip)」，所有備份檔均直接存於伺服器資料夾中。
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-950/60 border border-slate-800/80 rounded-xl px-3 py-2 w-fit flex-wrap">
              <HardDrive className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span>伺服器實體儲存目錄：</span>
              <code className="font-mono text-purple-300 bg-purple-950/50 px-1.5 py-0.5 rounded border border-purple-800/40">
                {backupDir}/
              </code>
              <span className="text-slate-500">（本機路徑：./music/backups/）</span>
            </div>
          </div>

          {/* 右側操作按鈕群組 */}
          <div className="flex flex-wrap items-center gap-3">
            {/* 全站完整備份 (含全部 MP3 歌曲音訊) */}
            <button
              onClick={handleCreateFullZipBackup}
              disabled={isBackingUp}
              className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-2xl text-xs font-semibold shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
              title="將所有歌單設定與所有 MP3 歌曲音訊完整打包為 .zip 下載"
            >
              {isBackingUp ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Archive className="w-4 h-4" />
              )}
              <span>全站完整備份 (含全部歌曲 .ZIP)</span>
            </button>

            {/* 設定備份並下載 */}
            <button
              onClick={() => handleCreateBackup(true)}
              disabled={isBackingUp}
              className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-2xl text-xs font-semibold shadow-lg shadow-purple-500/20 transition-all active:scale-95"
            >
              {isBackingUp ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <FileDown className="w-4 h-4" />
              )}
              <span>設定備份並下載 (.JSON)</span>
            </button>

            {/* 僅儲存於伺服器資料夾 */}
            <button
              onClick={() => handleCreateBackup(false)}
              disabled={isBackingUp}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 hover:text-white border border-slate-700 px-3.5 py-2.5 rounded-2xl text-xs font-semibold transition-all active:scale-95"
            >
              <span>僅存至目錄</span>
            </button>

            {/* 從本機上傳還原 */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 px-3.5 py-2.5 rounded-2xl text-xs font-semibold transition-all active:scale-95"
            >
              <Upload className="w-4 h-4 text-indigo-400" />
              <span>上傳備份檔還原</span>
            </button>
          </div>

        </div>
      </div>

      {/* 備份檔案列表 */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <Archive className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-bold text-white tracking-wide">
              目錄備份清單 ({backups.length})
            </h3>
          </div>
          <button
            onClick={fetchBackups}
            disabled={isLoading}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors p-1.5 rounded-lg hover:bg-slate-800"
            title="重新整理清單"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>重新整理</span>
          </button>
        </div>

        {backups.length === 0 ? (
          <div className="text-center py-12 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-center mx-auto text-slate-500">
              <Archive className="w-6 h-6" />
            </div>
            <p className="text-xs text-slate-400">目前「{backupDir}/」目錄中尚無備份檔案</p>
            <button
              onClick={() => handleCreateBackup(true)}
              className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 font-semibold transition-colors"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>立即建立第一個備份檔</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {backups.map((b) => {
              const isZip = b.isZip || b.filename.toLowerCase().endsWith('.zip');

              return (
                <div
                  key={b.filename}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl border transition-all group ${
                    isZip
                      ? 'bg-emerald-950/20 border-emerald-800/40 hover:border-emerald-500/50'
                      : 'bg-slate-950/70 border-slate-800/80 hover:border-purple-500/40'
                  }`}
                >
                  {/* 檔案基本資料 */}
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform ${
                        isZip
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                          : 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                      }`}
                    >
                      {isZip ? <Archive className="w-4 h-4" /> : <FileJson className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-slate-200 truncate">
                          {b.filename}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                            isZip
                              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/50'
                              : 'bg-purple-950/80 text-purple-300 border-purple-700/50'
                          }`}
                        >
                          {isZip ? '全站歌曲壓縮包 (.ZIP)' : '設定快照 (.JSON)'}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded">
                          {formatBytes(b.size)}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-slate-400 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-500" />
                          {formatDateTime(b.createdAt)}
                        </span>
                        {isZip ? (
                          <>
                            <span className="text-slate-600">·</span>
                            <span className="flex items-center gap-1 text-emerald-300">
                              <Music className="w-3 h-3" />
                              含完整 MP3 音訊檔案
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-slate-600">·</span>
                            <span className="flex items-center gap-1 text-purple-300">
                              <ListMusic className="w-3 h-3" />
                              {b.stats?.playlistsCount ?? 0} 個歌單
                            </span>
                            <span className="text-slate-600">·</span>
                            <span className="flex items-center gap-1 text-indigo-300">
                              <Calendar className="w-3 h-3" />
                              {b.stats?.schedulesCount ?? 0} 條排程
                            </span>
                            {b.stats?.totalTracks !== undefined && (
                              <>
                                <span className="text-slate-600">·</span>
                                <span className="text-slate-400">
                                  {b.stats.totalTracks} 首曲目快照
                                </span>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 操作按鈕組 */}
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {/* 下載按鈕 */}
                    <button
                      onClick={() => handleDownload(b.filename)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 hover:text-purple-200 border border-purple-500/30 text-xs font-semibold transition-all active:scale-95"
                      title="下載此備份檔至本機"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>下載</span>
                    </button>

                    {/* 還原按鈕 */}
                    <button
                      onClick={() =>
                        setRestoreModalData({
                          type: 'file',
                          filename: b.filename,
                          isZip,
                          stats: b.stats
                        })
                      }
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 hover:text-indigo-200 border border-indigo-500/30 text-xs font-semibold transition-all active:scale-95"
                      title="從此備份還原"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>還原</span>
                    </button>

                    {/* 刪除按鈕 */}
                    <button
                      onClick={() => handleDeleteBackup(b.filename)}
                      className="p-1.5 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      title="從伺服器刪除此備份"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 還原確認彈跳視窗 */}
      {restoreModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-bold text-white">確認執行備份還原？</h4>
                <p className="text-xs text-slate-400">請仔細確認以下還原影響</p>
              </div>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between text-slate-300">
                <span>還原來源：</span>
                <span className="font-mono font-bold text-purple-300 truncate max-w-[200px]">
                  {restoreModalData.filename}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-300">
                <span>類型：</span>
                <span className="font-bold text-slate-200">
                  {restoreModalData.isZip ? '全站歌曲音訊壓縮包 (.ZIP)' : '歌單與排程設定檔 (.JSON)'}
                </span>
              </div>
            </div>

            <div className="bg-amber-950/30 border border-amber-800/40 rounded-2xl p-3 flex items-start gap-2.5 text-xs text-amber-300/90">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              <div>
                <p className="font-semibold text-amber-300">重要注意事項：</p>
                <p className="text-[11px] text-amber-300/80 mt-0.5 leading-relaxed">
                  {restoreModalData.isZip
                    ? '還原 ZIP 壓縮包將會自動解開音訊檔案至各歌單資料夾，並同時還原歌單與智慧排程配置。'
                    : '還原將會以備份內容替換目前系統內的歌單資訊與智慧排程規則。磁碟上的實體音訊 MP3 檔案將完整保留不受影響。'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setRestoreModalData(null)}
                disabled={isRestoring}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmRestore}
                disabled={isRestoring}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-lg shadow-amber-600/20 transition-all active:scale-95 disabled:opacity-50"
              >
                {isRestoring ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
                <span>{isRestoring ? '還原中...' : '確認還原'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
