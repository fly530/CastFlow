import React, { useState, useEffect, useRef } from 'react';
import Header from '../components/Header.jsx';
import NowPlayingControl from '../components/NowPlayingControl.jsx';
import PlaylistManager from '../components/PlaylistManager.jsx';
import ScheduleManager from '../components/ScheduleManager.jsx';
import FileUploadModal from '../components/FileUploadModal.jsx';
import TelnetConsoleModal from '../components/TelnetConsoleModal.jsx';
import LoginModal from '../components/LoginModal.jsx';
import ChangePasswordModal from '../components/ChangePasswordModal.jsx';
import ScheduleModal from '../components/ScheduleModal.jsx';
import PlaylistModal from '../components/PlaylistModal.jsx';
import BackupManager from '../components/BackupManager.jsx';
import LoginPage from '../components/LoginPage.jsx';
import { Github, LayoutDashboard, Calendar, FolderArchive } from 'lucide-react';
import { setToken, getToken } from '../utils/api.js';

export default function AdminView({
  currentUser,
  setCurrentUser,
  isCheckingAuth,
  onSwitchToPlayer,
  showToast
}) {
  const [status, setStatus] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'schedules' | 'backups'
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [uploadPlaylistId, setUploadPlaylistId] = useState(null);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState(null);
  const [playlistRefreshKey, setPlaylistRefreshKey] = useState(0);
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
  const wsRef = useRef(null);

  // 輪詢狀態 (作為備援機制)
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setStatus(json.data);
        }
      }
    } catch {
      // 網路暫態忽略
    }
  };

  useEffect(() => {
    fetchStatus();

    // WebSocket 即時資料串流
    let reconnectTimeout = null;
    const connectWS = () => {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'RADIO_STATUS' && msg.data) {
              setStatus(msg.data);
            }
          } catch (e) {
            console.error('WS parse error', e);
          }
        };

        ws.onclose = () => {
          reconnectTimeout = setTimeout(connectWS, 3000);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        reconnectTimeout = setTimeout(connectWS, 5000);
      }
    };

    connectWS();

    const interval = setInterval(() => {
      if (autoRefresh) {
        fetchStatus();
      }
    }, 8000);

    return () => {
      clearInterval(interval);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (wsRef.current) wsRef.current.close();
    };
  }, [autoRefresh]);

  // 登出邏輯
  const handleLogout = () => {
    setToken(null);
    setCurrentUser(null);
    showToast('已安全登出');
  };

  // 首次身分驗證中
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-slate-500 font-mono">驗證管理員身分中...</span>
      </div>
    );
  }

  // 若尚未登入，呈現專屬登入頁面
  if (!currentUser) {
    return (
      <LoginPage
        onLoginSuccess={(user, needsChange) => {
          setCurrentUser(user);
          showToast(`歡迎回來，${user.username}！`);
          if (needsChange) {
            setIsChangePasswordOpen(true);
          }
        }}
        onSwitchToPlayer={onSwitchToPlayer}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
      {/* 頂部導覽 */}
      <Header
        status={status}
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
        currentUser={currentUser}
        onOpenLogin={() => setIsLoginOpen(true)}
        onOpenChangePassword={() => setIsChangePasswordOpen(true)}
        onOpenBackups={() => setActiveTab('backups')}
        onLogout={handleLogout}
        onSwitchToPlayer={onSwitchToPlayer}
      />

      {/* 主工作區塊 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full space-y-6">
        {/* 功能分頁切換按鈕組 */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30 shadow-lg shadow-purple-500/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>主控儀表板</span>
            </button>

            <button
              onClick={() => setActiveTab('schedules')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'schedules'
                  ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30 shadow-lg shadow-purple-500/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>AutoDJ 智慧排程</span>
            </button>

            <button
              onClick={() => setActiveTab('backups')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'backups'
                  ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30 shadow-lg shadow-purple-500/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <FolderArchive className="w-4 h-4" />
              <span>備份與還原</span>
            </button>
          </div>
        </div>

        {/* 分頁 1: 主控儀表板 (當前播放控制 + 歌單曲庫管理) */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <NowPlayingControl
              status={status}
              currentUser={currentUser}
              onOpenConsole={() => setIsConsoleOpen(true)}
              onTrackSkipped={() => {
                showToast('已跳播至下一首');
                fetchStatus();
              }}
              onRequestLogin={() => setIsLoginOpen(true)}
              showToast={showToast}
            />

            <PlaylistManager
              refreshTrigger={playlistRefreshKey}
              playlists={status?.playlistsSummary || []}
              onOpenUpload={(playlistId) => {
                if (!currentUser) {
                  setIsLoginOpen(true);
                } else {
                  setUploadPlaylistId(playlistId);
                }
              }}
              onEditPlaylist={(pl) => {
                if (!currentUser) {
                  setIsLoginOpen(true);
                } else {
                  setEditingPlaylist(pl);
                  setIsPlaylistModalOpen(true);
                }
              }}
              onOpenNewPlaylist={() => {
                if (!currentUser) {
                  setIsLoginOpen(true);
                } else {
                  setEditingPlaylist(null);
                  setIsPlaylistModalOpen(true);
                }
              }}
              onRequestLogin={() => setIsLoginOpen(true)}
              onTrackDeleted={(filename) => {
                showToast(`已刪除曲目「${filename}」`);
                fetchStatus();
                setPlaylistRefreshKey((k) => k + 1);
              }}
            />
          </div>
        )}

        {/* 分頁 2: 智慧排程調度中心 */}
        {activeTab === 'schedules' && (
          <ScheduleManager
            refreshTrigger={scheduleRefreshKey}
            playlists={status?.playlistsSummary || []}
            onOpenNewSchedule={() => {
              if (!currentUser) {
                setIsLoginOpen(true);
              } else {
                setEditingSchedule(null);
                setIsScheduleModalOpen(true);
              }
            }}
            onEditSchedule={(sch) => {
              if (!currentUser) {
                setIsLoginOpen(true);
              } else {
                setEditingSchedule(sch);
                setIsScheduleModalOpen(true);
              }
            }}
            onOpenNewPlaylist={() => {
              if (!currentUser) {
                setIsLoginOpen(true);
              } else {
                setEditingPlaylist(null);
                setIsPlaylistModalOpen(true);
              }
            }}
            onScheduleChanged={() => {
              fetchStatus();
            }}
            onRequestLogin={() => setIsLoginOpen(true)}
            showToast={showToast}
          />
        )}

        {/* 分頁 3: 歌單與排程備份設定 */}
        {activeTab === 'backups' && (
          <BackupManager
            onRequestLogin={() => setIsLoginOpen(true)}
            showToast={showToast}
            onRestoreSuccess={() => {
              fetchStatus();
              setPlaylistRefreshKey((k) => k + 1);
            }}
          />
        )}
      </main>

      {/* 頁尾 */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <span>CastFlow Management Console © 2026.</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={onSwitchToPlayer}
              className="hover:text-purple-400 transition-colors"
            >
              前台播放器
            </button>
            <a
              href="https://github.com/fly530/CastFlow"
              target="_blank"
              rel="noreferrer"
              className="hover:text-slate-300 transition-colors flex items-center gap-1"
            >
              <Github className="w-3.5 h-3.5" /> GitHub
            </a>
          </div>
        </div>
      </footer>

      {/* 登入彈跳視窗 */}
      <LoginModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
        onSuccess={(user, needsChange) => {
          setCurrentUser(user);
          showToast(`歡迎回來，${user.username}！`);
          if (needsChange) {
            setIsChangePasswordOpen(true);
          }
        }}
      />

      {/* 修改密碼彈跳視窗 */}
      <ChangePasswordModal
        isOpen={isChangePasswordOpen}
        onClose={() => setIsChangePasswordOpen(false)}
        onSuccess={(msg) => showToast(msg)}
      />

      {/* 檔案上傳對話框 */}
      {uploadPlaylistId && (
        <FileUploadModal
          playlistId={uploadPlaylistId}
          onClose={() => setUploadPlaylistId(null)}
          onSuccess={() => {
            showToast('檔案上傳成功並已排入曲庫');
            fetchStatus();
            setPlaylistRefreshKey((k) => k + 1);
          }}
        />
      )}

      {/* Telnet 管理控制台 */}
      <TelnetConsoleModal
        isOpen={isConsoleOpen}
        onClose={() => setIsConsoleOpen(false)}
      />

      {/* 排程規則彈跳編輯窗 */}
      <ScheduleModal
        isOpen={isScheduleModalOpen}
        onClose={() => {
          setIsScheduleModalOpen(false);
          setEditingSchedule(null);
        }}
        schedule={editingSchedule}
        playlists={status?.playlistsSummary || []}
        onSuccess={() => {
          showToast('排程規則已更新');
          setScheduleRefreshKey((k) => k + 1);
          fetchStatus();
        }}
      />

      {/* 歌單資料夾彈跳編輯窗 */}
      <PlaylistModal
        isOpen={isPlaylistModalOpen}
        onClose={() => {
          setIsPlaylistModalOpen(false);
          setEditingPlaylist(null);
        }}
        playlist={editingPlaylist}
        onSuccess={() => {
          showToast('歌單資訊已更新');
          setPlaylistRefreshKey((k) => k + 1);
          fetchStatus();
        }}
      />
    </div>
  );
}
