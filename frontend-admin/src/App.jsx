import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header.jsx';
import NowPlayingControl from './components/NowPlayingControl.jsx';
import PlaylistManager from './components/PlaylistManager.jsx';
import ScheduleManager from './components/ScheduleManager.jsx';
import FileUploadModal from './components/FileUploadModal.jsx';
import TelnetConsoleModal from './components/TelnetConsoleModal.jsx';
import LoginModal from './components/LoginModal.jsx';
import ChangePasswordModal from './components/ChangePasswordModal.jsx';
import ScheduleModal from './components/ScheduleModal.jsx';
import PlaylistModal from './components/PlaylistModal.jsx';
import BackupManager from './components/BackupManager.jsx';
import LoginPage from './components/LoginPage.jsx';
import Toast from './components/Toast.jsx';
import { Heart, Github, LayoutDashboard, Calendar, Plus, FolderArchive } from 'lucide-react';
import { authFetch, getMe, setToken, getToken } from './utils/api.js';

export default function App() {
  const [status, setStatus] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'schedules'
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [uploadPlaylistId, setUploadPlaylistId] = useState(null);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [playlistRefreshKey, setPlaylistRefreshKey] = useState(0);
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
  const [toast, setToast] = useState(null);
  const wsRef = useRef(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // 驗證當前管理者 Session
  const checkSession = async () => {
    try {
      if (!getToken()) {
        setCurrentUser(null);
        return;
      }
      const user = await getMe();
      setCurrentUser(user);
    } catch {
      setCurrentUser(null);
    } finally {
      setIsCheckingAuth(false);
    }
  };

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
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  };

  useEffect(() => {
    checkSession();
    fetchStatus();

    const handleAuthChange = () => {
      checkSession();
    };
    window.addEventListener('castflow_auth_change', handleAuthChange);
    window.addEventListener('kuberadio_auth_change', handleAuthChange);

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

    return () => {
      window.removeEventListener('castflow_auth_change', handleAuthChange);
      window.removeEventListener('kuberadio_auth_change', handleAuthChange);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // 輪詢定時器 (當開啟自動更新時作為 WS 備援)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchStatus, 8000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const handleSkip = async () => {
    if (!currentUser) {
      setIsLoginOpen(true);
      return;
    }
    try {
      const res = await authFetch('/api/control/skip', { method: 'POST' });
      if (res.status === 401) {
        showToast('管理員認證過期，請重新登入', 'error');
        setIsLoginOpen(true);
        return;
      }
      const json = await res.json();
      if (json.success) {
        showToast('已成功發送跳曲指令 (Skip)');
        setTimeout(fetchStatus, 400);
      } else {
        showToast(`跳曲失敗: ${json.error}`, 'error');
      }
    } catch (err) {
      showToast(`連線異常: ${err.message}`, 'error');
    }
  };

  const handleReload = async () => {
    if (!currentUser) {
      setIsLoginOpen(true);
      return;
    }
    try {
      const res = await authFetch('/api/control/reload', { method: 'POST' });
      if (res.status === 401) {
        showToast('管理員認證過期，請重新登入', 'error');
        setIsLoginOpen(true);
        return;
      }
      const json = await res.json();
      if (json.success) {
        showToast('所有歌單已重新載入 (Reloaded)');
        fetchStatus();
      } else {
        showToast(`重新載入失敗: ${json.error}`, 'error');
      }
    } catch (err) {
      showToast(`連線異常: ${err.message}`, 'error');
    }
  };

  const handleLogout = () => {
    setToken(null);
    setCurrentUser(null);
    showToast('已安全登出');
  };

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-3">
        <div className="w-9 h-9 border-3 border-purple-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-slate-500 font-mono">驗證管理員身分中...</span>
      </div>
    );
  }

  // 若尚未登入，直接強制呈現登入介面
  if (!currentUser) {
    return (
      <>
        <LoginPage
          onLoginSuccess={(user, needsChange) => {
            setCurrentUser(user);
            showToast(`歡迎回來，${user.username}！`);
            if (needsChange) {
              setIsChangePasswordOpen(true);
            }
          }}
        />
        <Toast toast={toast} onClose={() => setToast(null)} />
      </>
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
      />

      {/* 主要管理面板 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full">
        {/* 當前播送與遠端快速控制 (主視覺：正在播放 + 未來 3 首) */}
        <NowPlayingControl
          currentTrack={status?.currentTrack}
          upcomingTracks={status?.upcomingTracks}
          bitrate={status?.icecast?.bitrate}
          onSkip={handleSkip}
          onReload={handleReload}
          onOpenConsole={() => {
            if (!currentUser) {
              setIsLoginOpen(true);
            } else {
              setIsConsoleOpen(true);
            }
          }}
        />

        {/* 分頁選單 (Tab Navigation) */}
        <div className="mt-8 flex items-center gap-2 border-b border-slate-800 pb-3 flex-wrap">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'dashboard'
                ? 'bg-purple-600/20 text-purple-300 border border-purple-500/40 shadow-lg shadow-purple-500/10'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>歌單與曲目資產 (Playlists)</span>
          </button>

          <button
            onClick={() => setActiveTab('schedules')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'schedules'
                ? 'bg-purple-600/20 text-purple-300 border border-purple-500/40 shadow-lg shadow-purple-500/10'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>智慧排程調度中心 (AutoDJ Schedules)</span>
          </button>

          <button
            onClick={() => setActiveTab('backups')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'backups'
                ? 'bg-purple-600/20 text-purple-300 border border-purple-500/40 shadow-lg shadow-purple-500/10'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
            }`}
          >
            <FolderArchive className="w-4 h-4" />
            <span>歌單排程備份與設定 (Backups)</span>
          </button>
        </div>

        {/* 分頁 1: 歌單資產管理 */}
        {activeTab === 'dashboard' && (
          <PlaylistManager
            playlists={status?.playlistsSummary || []}
            refreshKey={playlistRefreshKey}
            onRefresh={fetchStatus}
            onOpenUpload={(id) => {
              if (!currentUser) {
                setIsLoginOpen(true);
              } else {
                setUploadPlaylistId(id);
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
            <a
              href="http://localhost:3000"
              target="_blank"
              rel="noreferrer"
              className="hover:text-purple-400 transition-colors"
            >
              前台播放器
            </a>
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

      {/* 上傳彈跳視窗 */}
      <FileUploadModal
        isOpen={!!uploadPlaylistId}
        playlistId={uploadPlaylistId}
        playlistName={status?.playlistsSummary?.find((p) => p.id === uploadPlaylistId)?.name}
        onClose={() => setUploadPlaylistId(null)}
        onRequestLogin={() => setIsLoginOpen(true)}
        onUploadSuccess={(msg) => {
          showToast(msg || '上傳成功！');
          fetchStatus();
          setPlaylistRefreshKey((k) => k + 1);
        }}
      />

      {/* Telnet 控制台彈跳視窗 */}
      <TelnetConsoleModal
        isOpen={isConsoleOpen}
        onClose={() => setIsConsoleOpen(false)}
        onRequestLogin={() => setIsLoginOpen(true)}
      />

      {/* 新增/編輯排程規則彈跳視窗 */}
      <ScheduleModal
        isOpen={isScheduleModalOpen}
        onClose={() => {
          setIsScheduleModalOpen(false);
          setEditingSchedule(null);
        }}
        editingSchedule={editingSchedule}
        playlists={status?.playlistsSummary || []}
        onRequestLogin={() => setIsLoginOpen(true)}
        onSaved={(msg) => {
          showToast(msg);
          fetchStatus();
          setScheduleRefreshKey((prev) => prev + 1);
        }}
      />

      {/* 新建/編輯歌單彈跳視窗 */}
      <PlaylistModal
        isOpen={isPlaylistModalOpen}
        onClose={() => {
          setIsPlaylistModalOpen(false);
          setEditingPlaylist(null);
        }}
        editingPlaylist={editingPlaylist}
        onRequestLogin={() => setIsLoginOpen(true)}
        onSaved={(msg) => {
          showToast(msg);
          fetchStatus();
          setPlaylistRefreshKey((prev) => prev + 1);
        }}
      />

      {/* 全域 Toast 通知 */}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
