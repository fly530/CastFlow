import React, { useState, useEffect, useRef } from 'react';
import {
  Folder,
  Upload,
  Music,
  Clock,
  HardDrive,
  Sparkles,
  RefreshCw,
  Edit2,
  Edit3,
  Trash2,
  Check,
  X,
  FolderUp,
  FileArchive,
  AlertCircle,
  Plus,
  Radio,
  ListMusic,
  ArrowRightLeft
} from 'lucide-react';
import { authFetch } from '../utils/api.js';

export default function PlaylistManager({
  playlists = [],
  onOpenUpload,
  onOpenNewPlaylist,
  onTrackDeleted,
  onRequestLogin,
  refreshKey,
  onRefresh
}) {
  const [selectedId, setSelectedId] = useState('A');
  const [tracks, setTracks] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // 歌單名稱編輯狀態
  const [editingPlaylistId, setEditingPlaylistId] = useState(null);
  const [editingPlaylistName, setEditingPlaylistName] = useState('');
  const [isSavingPlaylistName, setIsSavingPlaylistName] = useState(false);

  // 批次勾選與操作狀態
  const [selectedTrackFilenames, setSelectedTrackFilenames] = useState([]);
  const [targetPlaylistId, setTargetPlaylistId] = useState('');
  const [isBatchOperating, setIsBatchOperating] = useState(false);

  // 頂部上傳區狀態
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // { current, total, text }
  const [uploadMsg, setUploadMsg] = useState(null);

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  useEffect(() => {
    if (playlists.length > 0 && !playlists.some((p) => p.id === selectedId)) {
      setSelectedId(playlists[0].id);
    }
  }, [playlists, selectedId]);

  const fetchTracks = async (playlistId) => {
    try {
      setIsLoading(true);
      const res = await fetch(`/api/playlists/${playlistId}/tracks`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setTracks(json.data || []);
        }
      }
    } catch {
      setTracks([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setSelectedTrackFilenames([]);
    setUploadMsg(null);
    fetchTracks(selectedId);
  }, [selectedId, refreshKey]);

  // 上傳提示訊息於 6 秒後自動隱藏
  useEffect(() => {
    if (uploadMsg) {
      const timer = setTimeout(() => {
        setUploadMsg(null);
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [uploadMsg]);

  // 歌單名稱修改
  const handleStartEditPlaylist = (e, pl) => {
    e.stopPropagation();
    setEditingPlaylistId(pl.id);
    setEditingPlaylistName(pl.name || pl.id);
  };

  const handleSavePlaylistName = async (e, plId) => {
    e.stopPropagation();
    if (!editingPlaylistName.trim()) return;
    try {
      setIsSavingPlaylistName(true);
      const res = await authFetch(`/api/playlists/${plId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingPlaylistName.trim() })
      });
      if (res.status === 401) {
        alert('請先以管理員身分登入後再修改歌單名稱');
        onRequestLogin?.();
        return;
      }
      if (res.ok) {
        setEditingPlaylistId(null);
        onRefresh?.();
      }
    } catch (err) {
      alert(`修改歌單名稱失敗: ${err.message}`);
    } finally {
      setIsSavingPlaylistName(false);
    }
  };

  // 刪除歌單處理 (有歌曲的歌單禁止刪除)
  const handleDeletePlaylist = async (e, pl) => {
    e.stopPropagation();
    if (playlists.length <= 1) {
      alert('電台系統至少需要保留一個歌單！');
      return;
    }

    const songCount = pl.trackCount ?? pl.count ?? 0;
    if (songCount > 0) {
      alert(`無法刪除：歌單「${pl.name || pl.id}」內仍有 ${songCount} 首歌曲！\n請先將歌曲清空或移動至其他歌單後才能刪除。`);
      return;
    }

    if (!window.confirm(`確定要刪除空白歌單「${pl.name || pl.id}」嗎？\n此歌單的排程關聯將會一併移除。`)) {
      return;
    }

    try {
      const res = await authFetch(`/api/playlists/${pl.id}`, {
        method: 'DELETE'
      });

      if (res.status === 401) {
        alert('請先以管理員身分登入');
        onRequestLogin?.();
        return;
      }

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || '刪除歌單失敗');
      }

      // 若刪除的是當前選取的歌單，自動切換至剩餘第一個歌單
      const remaining = playlists.filter((p) => p.id !== pl.id);
      if (selectedId === pl.id && remaining.length > 0) {
        setSelectedId(remaining[0].id);
      }

      onRefresh?.();
    } catch (err) {
      alert(`刪除失敗: ${err.message}`);
    }
  };

  // 遞迴解析拖曳進來的目錄與檔案
  const getFilesFromDataTransfer = async (dataTransfer) => {
    const collectedFiles = [];
    const items = dataTransfer.items;
    if (!items) {
      return Array.from(dataTransfer.files || []);
    }

    const traverseEntry = async (entry) => {
      if (entry.isFile) {
        const file = await new Promise((resolve) => entry.file(resolve, () => resolve(null)));
        if (file) {
          const name = file.name.toLowerCase();
          if (name.endsWith('.mp3') || name.endsWith('.zip')) {
            collectedFiles.push(file);
          }
        }
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const readEntries = async () => {
          return new Promise((resolve) => {
            dirReader.readEntries(async (entries) => {
              if (entries.length === 0) {
                resolve();
              } else {
                for (const child of entries) {
                  await traverseEntry(child);
                }
                // 繼續讀取直至目錄條目為空 (Chrome readEntries 每次最多 100 筆)
                await readEntries();
                resolve();
              }
            }, () => resolve());
          });
        };
        await readEntries();
      }
    };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.webkitGetAsEntry) {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          await traverseEntry(entry);
        } else {
          const file = item.getAsFile();
          if (file) collectedFiles.push(file);
        }
      } else {
        const file = item.getAsFile();
        if (file) collectedFiles.push(file);
      }
    }

    return collectedFiles;
  };

  // 執行音訊 / 壓縮檔 / 目錄檔案上傳
  const uploadFiles = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    try {
      setIsUploading(true);
      setUploadMsg(null);
      setUploadProgress({ current: 0, total: fileList.length, text: `正在準備上傳 ${fileList.length} 個檔案...` });

      // 分批上傳（每批 10 檔）避免超過限制
      const batchSize = 20;
      let uploadedCount = 0;

      for (let i = 0; i < fileList.length; i += batchSize) {
        const batch = fileList.slice(i, i + batchSize);
        const formData = new FormData();
        batch.forEach((file) => {
          formData.append('files', file);
        });

        setUploadProgress({
          current: i,
          total: fileList.length,
          text: `正在上傳第 ${i + 1} ~ ${Math.min(i + batchSize, fileList.length)} / 共 ${fileList.length} 個檔案...`
        });

        const res = await authFetch(`/api/playlists/${selectedId}/upload`, {
          method: 'POST',
          body: formData
        });

        if (res.status === 401) {
          alert('請先登入管理員帳號後再上傳檔案');
          onRequestLogin?.();
          return;
        }

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || '上傳失敗');
        }

        uploadedCount += batch.length;
      }

      const targetPl = playlists.find((p) => p.id === selectedId);
      const targetName = targetPl?.name || `歌單 ${selectedId}`;
      setUploadMsg({ type: 'success', text: `已成功上傳並收錄 ${uploadedCount} 個檔案至「${targetName}」！` });
      fetchTracks(selectedId);
      onRefresh?.();
    } catch (err) {
      setUploadMsg({ type: 'error', text: `上傳失敗: ${err.message}` });
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  // 拖曳事件處理
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    let files = [];
    // 檢查是否有拖曳目錄
    const items = e.dataTransfer.items;
    let hasDirectory = false;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry && entry.isDirectory) {
            hasDirectory = true;
            break;
          }
        }
      }
    }

    if (hasDirectory) {
      files = await getFilesFromDataTransfer(e.dataTransfer);
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      files = Array.from(e.dataTransfer.files).filter((f) => {
        const name = f.name.toLowerCase();
        return name.endsWith('.mp3') || name.endsWith('.zip');
      });
    } else {
      files = await getFilesFromDataTransfer(e.dataTransfer);
    }

    if (files.length > 0) {
      uploadFiles(files);
    } else {
      setUploadMsg({ type: 'error', text: '未在此拖曳項目中找到任何 .mp3 音訊檔案或 .zip 壓縮包' });
    }
  };

  // 曲目勾選操作
  const toggleSelectTrack = (filename) => {
    setSelectedTrackFilenames((prev) =>
      prev.includes(filename) ? prev.filter((f) => f !== filename) : [...prev, filename]
    );
  };

  const toggleSelectAll = () => {
    if (selectedTrackFilenames.length === tracks.length) {
      setSelectedTrackFilenames([]);
    } else {
      setSelectedTrackFilenames(tracks.map((t) => t.filename));
    }
  };

  // 批次移動曲目至目標歌單
  const handleBatchMove = async () => {
    if (!targetPlaylistId) {
      alert('請先選擇目標歌單');
      return;
    }
    if (selectedTrackFilenames.length === 0) return;
    const targetPl = playlists.find((p) => p.id === targetPlaylistId);
    if (
      !window.confirm(
        `確定要將選取的 ${selectedTrackFilenames.length} 首歌曲移動至「${targetPl?.name || targetPlaylistId}」嗎？`
      )
    ) {
      return;
    }

    try {
      setIsBatchOperating(true);
      const res = await authFetch(`/api/playlists/${selectedId}/tracks/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPlaylistId,
          filenames: selectedTrackFilenames
        })
      });

      if (res.status === 401) {
        alert('請先以管理員身分登入');
        onRequestLogin?.();
        return;
      }

      const json = await res.json();
      if (res.ok && json.success) {
        setSelectedTrackFilenames([]);
        setTargetPlaylistId('');
        fetchTracks(selectedId);
        onRefresh?.();
        onTrackDeleted?.();
      } else {
        alert(json.error || '移動歌曲失敗');
      }
    } catch (err) {
      alert(`網路異常: ${err.message}`);
    } finally {
      setIsBatchOperating(false);
    }
  };

  // 批次刪除曲目
  const handleBatchDelete = async () => {
    if (selectedTrackFilenames.length === 0) return;
    if (
      !window.confirm(
        `確定要永久刪除選取的 ${selectedTrackFilenames.length} 首歌曲嗎？\n此動作將直接從硬碟中移除檔案且無法復原。`
      )
    ) {
      return;
    }

    try {
      setIsBatchOperating(true);
      const res = await authFetch(`/api/playlists/${selectedId}/tracks/batch-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filenames: selectedTrackFilenames
        })
      });

      if (res.status === 401) {
        alert('請先以管理員身分登入後再執行刪除。');
        onRequestLogin?.();
        return;
      }

      const json = await res.json();
      if (res.ok && json.success) {
        setSelectedTrackFilenames([]);
        fetchTracks(selectedId);
        onRefresh?.();
        onTrackDeleted?.();
      } else {
        alert(json.error || '刪除歌曲失敗');
      }
    } catch (err) {
      alert(`刪除失敗: ${err.message}`);
    } finally {
      setIsBatchOperating(false);
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const currentPlaylist = playlists.find((p) => p.id === selectedId) || {
    id: selectedId,
    name: `歌單 ${selectedId}`,
    description: '廣播素材歌單',
    color: '#8b5cf6'
  };

  return (
    <div className="rounded-3xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-xl shadow-xl overflow-hidden">
      {/* 隱藏的檔案與目錄選擇器 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".mp3,.zip,audio/mpeg,application/zip"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            uploadFiles(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            uploadFiles(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />

      {/* 左右雙欄佈局：左側歌單列表，右側歌單內容 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[640px]">

        {/* ================= 左側：歌單列表 (Playlists Sidebar) ================= */}
        <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-800 bg-slate-950/40 p-4 sm:p-5 flex flex-col justify-between">
          <div>
            {/* 左側標頭與「新建歌單」按鈕 */}
            <div className="flex items-center justify-between gap-2 pb-4 mb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Folder className="w-4 h-4 text-purple-400" />
                <h3 className="text-xs font-bold text-slate-200 tracking-wide">
                  歌單資產列表 ({playlists.length})
                </h3>
              </div>
              <button
                onClick={onOpenNewPlaylist}
                className="flex items-center gap-1 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all"
                title="建立新歌單"
              >
                <Plus className="w-3 h-3" />
                <span>新建歌單</span>
              </button>
            </div>

            {/* 歌單清單項目 (支援點擊選擇、編輯名稱) */}
            <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
              {playlists.map((pl) => {
                const count = pl.trackCount ?? pl.count ?? 0;
                const isSelected = selectedId === pl.id;
                const isEditingThis = editingPlaylistId === pl.id;

                return (
                  <div
                    key={pl.id}
                    onClick={() => {
                      if (!isEditingThis) {
                        setSelectedId(pl.id);
                        setUploadMsg(null);
                      }
                    }}
                    className={`group relative flex items-center justify-between p-3 rounded-2xl cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-purple-950/40 text-white border border-purple-500/50 shadow-md shadow-purple-500/10'
                        : 'bg-slate-900/40 hover:bg-slate-800/50 text-slate-300 border border-slate-800/70'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1 mr-2">
                      {/* 極簡圖示徽章 */}
                      <div
                        className={`w-7 h-7 rounded-xl flex items-center justify-center transition-all flex-shrink-0 ${
                          isSelected
                            ? 'bg-purple-600 text-white shadow-md shadow-purple-500/30'
                            : 'bg-slate-800/80 text-slate-400 group-hover:text-slate-200 group-hover:bg-slate-700/80'
                        }`}
                      >
                        <ListMusic className="w-3.5 h-3.5" />
                      </div>

                      {/* 正在編輯名稱 vs 一般檢視 */}
                      {isEditingThis ? (
                        <div className="flex items-center gap-1.5 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editingPlaylistName}
                            onChange={(e) => setEditingPlaylistName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSavePlaylistName(e, pl.id);
                              if (e.key === 'Escape') setEditingPlaylistId(null);
                            }}
                            autoFocus
                            disabled={isSavingPlaylistName}
                            className="bg-slate-950 border border-purple-500 text-xs text-white rounded-lg px-2 py-1 w-full focus:outline-none"
                          />
                          <button
                            onClick={(e) => handleSavePlaylistName(e, pl.id)}
                            disabled={isSavingPlaylistName}
                            className="p-1 text-emerald-400 hover:bg-emerald-500/20 rounded-md"
                            title="儲存"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingPlaylistId(null);
                            }}
                            className="p-1 text-slate-400 hover:bg-slate-800 rounded-md"
                            title="取消"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold truncate tracking-tight">{pl.name || pl.id}</p>
                          {pl.description && (
                            <p className="text-[10px] text-slate-500 truncate">
                              {pl.description}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 右側曲目計數與編輯按鈕 */}
                    {!isEditingThis && (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isSelected
                              ? 'bg-purple-600 text-white shadow-sm'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {count} 首
                        </span>
                        {/* 編輯名稱按鈕 */}
                        <button
                          onClick={(e) => handleStartEditPlaylist(e, pl)}
                          className="p-1.5 text-slate-400 hover:text-purple-300 hover:bg-purple-500/10 rounded-lg transition-colors"
                          title="編輯歌單名稱"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>

                        {/* 刪除歌單按鈕 (有歌曲時禁止刪除) */}
                        <button
                          onClick={(e) => handleDeletePlaylist(e, pl)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            count > 0
                              ? 'text-slate-600 hover:text-rose-400 hover:bg-rose-500/10'
                              : 'text-slate-400 hover:text-rose-400 hover:bg-rose-500/10'
                          }`}
                          title={count > 0 ? `此歌單內仍有 ${count} 首歌曲，不可刪除 (請先清空或移動歌曲)` : '刪除此空白歌單'}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
            <span>點擊歌單可切換右側內容</span>
            <span className="font-mono">共 {playlists.length} 個群組</span>
          </div>
        </div>

        {/* ================= 右側：歌單內容與曲目管理 ================= */}
        <div className="lg:col-span-8 p-5 sm:p-7 flex flex-col justify-between">
          <div>
            {/* 右側頂部歌單標題與操作 */}
            <div className="flex items-center justify-between gap-4 mb-5 pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-600/20 flex items-center justify-center ring-1 ring-white/10 flex-shrink-0">
                  <ListMusic className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white tracking-tight">
                      {currentPlaylist.name}
                    </h3>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                      {tracks.length} 首曲目
                    </span>
                  </div>
                  {currentPlaylist.description && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {currentPlaylist.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    fetchTracks(selectedId);
                    onRefresh?.();
                  }}
                  disabled={isLoading}
                  title="重新整理此歌單曲目清單"
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* =============== 頂部上傳區 (Upload Dropzone) =============== */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`p-5 rounded-2xl border-2 border-dashed transition-all mb-6 text-center ${
                isDragging
                  ? 'border-purple-500 bg-purple-950/30 scale-[1.01]'
                  : 'border-slate-800 bg-slate-950/30 hover:border-slate-700'
              }`}
            >
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3 text-left">
                  <div className="p-3 rounded-2xl bg-purple-500/10 text-purple-400 flex-shrink-0">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-200">
                      拖曳 MP3 檔案、ZIP 壓縮檔或整個資料夾至此
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      💡 支援自動遞迴掃描資料夾目錄並解開曲目；上傳 ZIP 檔案將由後端自動解壓收錄
                    </p>
                  </div>
                </div>

                {/* 上傳觸發按鈕群組 */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-700 transition-all disabled:opacity-50"
                  >
                    <FileArchive className="w-3.5 h-3.5 text-purple-400" />
                    <span>選取檔案 (MP3/ZIP)</span>
                  </button>

                  <button
                    onClick={() => folderInputRef.current?.click()}
                    disabled={isUploading}
                    className="flex items-center gap-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold px-3.5 py-2 rounded-xl shadow-md shadow-purple-600/20 active:scale-95 transition-all disabled:opacity-50"
                  >
                    <FolderUp className="w-3.5 h-3.5" />
                    <span>選取整個資料夾</span>
                  </button>
                </div>
              </div>

              {/* 上傳進度條或訊息回饋 */}
              {isUploading && uploadProgress && (
                <div className="mt-4 pt-3 border-t border-slate-800/80">
                  <div className="flex justify-between text-xs text-purple-300 font-mono mb-1">
                    <span>{uploadProgress.text}</span>
                    <span>{Math.round((uploadProgress.current / Math.max(1, uploadProgress.total)) * 100)}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-purple-500 h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.round((uploadProgress.current / Math.max(1, uploadProgress.total)) * 100)}%`
                      }}
                    />
                  </div>
                </div>
              )}

              {uploadMsg && (
                <div
                  className={`mt-3 p-2.5 rounded-xl text-xs flex items-center justify-between ${
                    uploadMsg.type === 'success'
                      ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                      : 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                  }`}
                >
                  <span>{uploadMsg.text}</span>
                  <button onClick={() => setUploadMsg(null)} className="text-slate-400 hover:text-white ml-2">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* =============== 下面：曲目清單表格 =============== */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-300">
                歌單曲目清單 ({tracks.length} 首)
              </span>
              <span className="text-[11px] text-slate-500">
                勾選曲目後可進行批量移動至其他歌單或刪除
              </span>
            </div>

            {/* 批量操作控制列 */}
            {selectedTrackFilenames.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 mb-3 bg-purple-950/40 border border-purple-500/40 rounded-2xl animate-in fade-in">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                  <span className="text-xs font-bold text-white">
                    已選取 <span className="text-purple-300 font-mono text-sm">{selectedTrackFilenames.length}</span> 首歌曲
                  </span>
                  <button
                    onClick={() => setSelectedTrackFilenames([])}
                    className="text-[11px] text-slate-400 hover:text-slate-200 underline ml-2"
                  >
                    取消選取
                  </button>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* 移動至目標歌單 */}
                  <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-700/80 rounded-xl px-2 py-1">
                    <span className="text-[11px] text-slate-400">移動至：</span>
                    <select
                      value={targetPlaylistId}
                      onChange={(e) => setTargetPlaylistId(e.target.value)}
                      className="bg-slate-950 text-xs text-slate-200 rounded-lg px-2 py-1 border border-slate-700 focus:outline-none focus:border-purple-500"
                    >
                      <option value="">選擇目標歌單...</option>
                      {playlists
                        .filter((p) => p.id !== selectedId)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                    <button
                      onClick={handleBatchMove}
                      disabled={!targetPlaylistId || isBatchOperating}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold disabled:opacity-50 transition-all shadow-sm"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                      <span>{isBatchOperating ? '處理中...' : '移動'}</span>
                    </button>
                  </div>

                  {/* 批量刪除 */}
                  <button
                    onClick={handleBatchDelete}
                    disabled={isBatchOperating}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-xs font-semibold transition-all disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{isBatchOperating ? '刪除中...' : '批量刪除'}</span>
                  </button>
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="py-16 text-center text-slate-500 text-sm">載入曲目中...</div>
            ) : tracks.length === 0 ? (
              <div className="py-14 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-950/20">
                <Music className="w-10 h-10 text-slate-600 mx-auto mb-2.5" />
                <p className="text-xs font-semibold text-slate-300">「{currentPlaylist?.name || selectedId}」內目前尚無曲目</p>
                <p className="text-[11px] text-slate-500 mt-1 mb-3">
                  請將 MP3 拖曳至上方上傳區，或選取整包資料夾匯入
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-800/80 rounded-2xl bg-slate-950/30">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950/60 border-b border-slate-800 text-slate-400 uppercase font-semibold">
                    <tr>
                      <th className="py-2.5 px-3 w-8">
                        <input
                          type="checkbox"
                          checked={tracks.length > 0 && selectedTrackFilenames.length === tracks.length}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-purple-500 cursor-pointer accent-purple-600"
                          title="全選 / 取消全選"
                        />
                      </th>
                      <th className="py-2.5 px-3 w-10">#</th>
                      <th className="py-2.5 px-3 w-12">封面</th>
                      <th className="py-2.5 px-3">曲名與演出者</th>
                      <th className="py-2.5 px-3">長度</th>
                      <th className="py-2.5 px-3">位元率</th>
                      <th className="py-2.5 px-3">大小</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-medium">
                    {tracks.map((t, idx) => {
                      const isChecked = selectedTrackFilenames.includes(t.filename);
                      return (
                        <tr
                          key={t.filename}
                          onClick={() => toggleSelectTrack(t.filename)}
                          className={`transition-colors cursor-pointer ${
                            isChecked
                              ? 'bg-purple-950/30 hover:bg-purple-950/40'
                              : 'hover:bg-slate-800/30'
                          }`}
                        >
                          <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSelectTrack(t.filename)}
                              className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-purple-500 cursor-pointer accent-purple-600"
                            />
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-500">{idx + 1}</td>
                          <td className="py-2.5 px-3">
                            <div className="w-8 h-8 rounded-lg overflow-hidden bg-slate-800 border border-slate-700">
                              <img
                                src={`/api/playlists/${selectedId}/tracks/${encodeURIComponent(
                                  t.filename
                                )}/cover`}
                                alt="art"
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  e.target.src =
                                    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect fill="%23334155" width="32" height="32"/><text fill="%2394a3b8" font-size="9" x="50%" y="50%" text-anchor="middle" dominant-baseline="middle">MP3</text></svg>';
                                }}
                              />
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <p className="font-semibold text-white truncate max-w-xs">{t.title}</p>
                            <p className="text-[11px] text-slate-400 truncate max-w-xs">{t.artist}</p>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-400">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-500" />
                              {formatDuration(t.duration)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-400">
                            {t.bitrate ? `${t.bitrate}k` : '--'}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-400">
                            <span className="flex items-center gap-1">
                              <HardDrive className="w-3 h-3 text-slate-500" />
                              {formatSize(t.size)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

