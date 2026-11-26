import React, { useState, useEffect, useRef } from 'react';
import Header from '../components/Header.jsx';
import NowPlayingControl from '../components/NowPlayingControl.jsx';
import PlaylistManager from '../components/PlaylistManager.jsx';
import ScheduleManager from '../components/ScheduleManager.jsx';
import TelnetConsoleModal from '../components/TelnetConsoleModal.jsx';
import ChangePasswordModal from '../components/ChangePasswordModal.jsx';
import ScheduleModal from '../components/ScheduleModal.jsx';
import PlaylistModal from '../components/PlaylistModal.jsx';
import BackupManager from '../components/BackupManager.jsx';
import LoginPage from '../components/LoginPage.jsx';
import StreamEndpointsCard from '../components/StreamEndpointsCard.jsx';
import { ConfirmProvider } from '../components/ConfirmDialog.jsx';
import { Github, LayoutDashboard, Calendar, FolderArchive } from 'lucide-react';
import { setToken } from '../utils/api.js';
import { useRadioStatus } from '../hooks/useRadioStatus.js';
import { DEFAULT_BITRATE_KBPS } from '../utils/stream.js';

const TABS = [
  { id: 'dashboard', label: '主控儀表板', Icon: LayoutDashboard },
  { id: 'schedules', label: 'AutoDJ 智慧排程', Icon: Calendar },
  { id: 'backups', label: '備份與還原', Icon: FolderArchive }
];

export default function AdminView(props) {
  const { currentUser, setCurrentUser, isCheckingAuth, onSwitchToPlayer, showToast } = props;

  // 首次身分驗證中
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-slate-500 font-mono">驗證管理員身分中...</span>
      </div>
    );
  }

  // 若尚未登入，呈現專屬登入頁面。
  // 已登入的主控台是另一個元件：登入失效回到這裡時它會整個卸載，重新登入後不會殘留
  // 失效前開著的編輯視窗或確認框。
  if (!currentUser) {
    return (
      <LoginPage
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          showToast(`歡迎回來，${user.username}！`);
        }}
        onSwitchToPlayer={onSwitchToPlayer}
      />
    );
  }

  // 刪除、還原、立即插播等確認框 (取代 window.confirm) 由這一層提供
  return (
    <ConfirmProvider>
      <AdminConsole {...props} />
    </ConfirmProvider>
  );
}

function AdminConsole({ currentUser, setCurrentUser, onSwitchToPlayer, showToast }) {
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'schedules' | 'backups'
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState(null);
  const [playlistRefreshKey, setPlaylistRefreshKey] = useState(0);
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
  // 「即時更新」關閉時暫停 WebSocket 與輪詢 (畫面停在當下的狀態)；
  // 手動操作 (跳歌、改排程…) 之後仍會用 refresh() 抓一次最新狀態
  const { status, connection, refresh: fetchStatus } = useRadioStatus({ enabled: autoRefresh, pollMs: 8000 });

  // 仍在使用系統產生的初始密碼：登入後 (或重新整理頁面時) 提示改密碼，每次載入只提示一次
  const passwordPromptedRef = useRef(false);
  useEffect(() => {
    if (currentUser?.passwordNeedsChange && !passwordPromptedRef.current) {
      passwordPromptedRef.current = true;
      setIsChangePasswordOpen(true);
    }
  }, [currentUser]);

  // 這一層只在已登入時渲染 (未登入是 LoginPage)，不必再檢查 currentUser
  const openPlaylistModal = (pl) => {
    setEditingPlaylist(pl);
    setIsPlaylistModalOpen(true);
  };
  const openScheduleModal = (sch) => {
    setEditingSchedule(sch);
    setIsScheduleModalOpen(true);
  };

  // 登出邏輯
  const handleLogout = () => {
    setToken(null);
    setCurrentUser(null);
    showToast('已安全登出');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
      {/* 頂部導覽 (手機上 header 換行後很高，只在 md 以上固定在頂端，免得一直蓋住四分之一的畫面) */}
      <Header
        status={status}
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
        connection={connection}
        currentUser={currentUser}
        onOpenChangePassword={() => setIsChangePasswordOpen(true)}
        onOpenBackups={() => setActiveTab('backups')}
        onLogout={handleLogout}
        onSwitchToPlayer={onSwitchToPlayer}
      />

      {/* 主工作區塊 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full space-y-6">
        {/* 功能分頁切換按鈕組 (萬一還是放不下，可以左右滑，不會撐破整頁) */}
        <div className="border-b border-slate-800 pb-3 -mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
          <div role="tablist" aria-label="後台功能" className="flex items-center gap-2 w-max">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                id={`admin-tab-${id}`}
                role="tab"
                aria-selected={activeTab === id}
                aria-controls="admin-tabpanel"
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                  activeTab === id
                    ? 'bg-purple-600/20 text-purple-300 border-purple-500/30 shadow-lg shadow-purple-500/10'
                    : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                {/* 手機寬度省掉圖示，三個分頁才擠得進一行 */}
                <Icon className="w-4 h-4 hidden sm:block" aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div id="admin-tabpanel" role="tabpanel" aria-labelledby={`admin-tab-${activeTab}`}>
          {/* 分頁 1: 主控儀表板 (當前播放控制 + 歌單曲庫管理) */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              <NowPlayingControl
                status={status}
                currentTrack={status?.currentTrack}
                upcomingTracks={status?.upcomingTracks || []}
                bitrate={status?.icecast?.bitrate || DEFAULT_BITRATE_KBPS}
                currentUser={currentUser}
                onOpenConsole={() => setIsConsoleOpen(true)}
                onTrackSkipped={() => {
                  showToast('已跳播至下一首');
                  fetchStatus();
                }}
                showToast={showToast}
              />

              <StreamEndpointsCard showToast={showToast} />

              <PlaylistManager
                refreshTrigger={playlistRefreshKey}
                playlists={status?.playlistsSummary || []}
                onEditPlaylist={openPlaylistModal}
                onOpenNewPlaylist={() => openPlaylistModal(null)}
                showToast={showToast}
                onRefresh={fetchStatus}
                onTracksChanged={(message) => {
                  showToast(message);
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
              onOpenNewSchedule={() => openScheduleModal(null)}
              onEditSchedule={openScheduleModal}
              onOpenNewPlaylist={() => openPlaylistModal(null)}
              onScheduleChanged={fetchStatus}
              showToast={showToast}
            />
          )}

          {/* 分頁 3: 歌單與排程備份設定 */}
          {activeTab === 'backups' && (
            <BackupManager
              showToast={showToast}
              onRestoreSuccess={() => {
                fetchStatus();
                setPlaylistRefreshKey((k) => k + 1);
              }}
            />
          )}
        </div>
      </main>

      {/* 頁尾 */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <span>CastFlow 管理後台 © 2026</span>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={onSwitchToPlayer} className="hover:text-purple-400 transition-colors">
              聽眾前台
            </button>
            <a
              href="https://github.com/fly530/CastFlow"
              target="_blank"
              rel="noreferrer"
              className="hover:text-slate-300 transition-colors flex items-center gap-1"
            >
              <Github className="w-3.5 h-3.5" aria-hidden="true" /> GitHub
            </a>
          </div>
        </div>
      </footer>

      {/* 修改密碼彈跳視窗 (關閉即卸載，下次開啟不會殘留上次輸入的密碼與錯誤訊息) */}
      {isChangePasswordOpen && (
        <ChangePasswordModal
          isOpen
          required={Boolean(currentUser?.passwordNeedsChange)}
          onClose={() => setIsChangePasswordOpen(false)}
          onSuccess={(msg) => {
            showToast(msg);
            setCurrentUser((u) => (u ? { ...u, passwordNeedsChange: false } : u));
          }}
        />
      )}

      {/* Telnet 管理控制台 */}
      <TelnetConsoleModal isOpen={isConsoleOpen} onClose={() => setIsConsoleOpen(false)} />

      {/* 排程規則彈跳編輯窗 */}
      <ScheduleModal
        isOpen={isScheduleModalOpen}
        onClose={() => {
          setIsScheduleModalOpen(false);
          setEditingSchedule(null);
        }}
        editingSchedule={editingSchedule}
        playlists={status?.playlistsSummary || []}
        onSaved={(msg) => {
          showToast(msg || '排程規則已更新');
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
        editingPlaylist={editingPlaylist}
        onSaved={(msg) => {
          showToast(msg || '歌單資訊已更新');
          setPlaylistRefreshKey((k) => k + 1);
          fetchStatus();
        }}
      />
    </div>
  );
}
