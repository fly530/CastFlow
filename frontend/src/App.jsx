import React, { useState, useEffect } from 'react';
import PlayerView from './views/PlayerView.jsx';
import AdminView from './views/AdminView.jsx';
import Toast from './components/Toast.jsx';
import { getMe, getToken } from './utils/api.js';

export default function App() {
  // 依網址路徑決定初始畫面 ('player' | 'admin')
  const [currentView, setCurrentView] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname.startsWith('/admin') ? 'admin' : 'player';
    }
    return 'player';
  });

  const [currentUser, setCurrentUser] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // 監聽瀏覽器上一頁 / 下一頁 (PopState)
  useEffect(() => {
    const handlePopState = () => {
      const isAdm = window.location.pathname.startsWith('/admin');
      setCurrentView(isAdm ? 'admin' : 'player');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 切換視圖並更新瀏覽器網址列
  const navigateTo = (view) => {
    setCurrentView(view);
    const targetPath = view === 'admin' ? '/admin/' : '/';
    if (window.location.pathname !== targetPath) {
      window.history.pushState(null, '', targetPath);
    }
    document.title = view === 'admin' ? 'CastFlow 控制後台 - 管理中心' : 'CastFlow - 雲原生線上廣播電台';
  };

  // 驗證管理者 Session
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

  useEffect(() => {
    checkSession();
    const handleAuthChange = () => checkSession();
    window.addEventListener('castflow_auth_change', handleAuthChange);
    return () => window.removeEventListener('castflow_auth_change', handleAuthChange);
  }, []);

  return (
    <>
      {currentView === 'admin' ? (
        <AdminView
          currentUser={currentUser}
          setCurrentUser={setCurrentUser}
          isCheckingAuth={isCheckingAuth}
          onSwitchToPlayer={() => navigateTo('player')}
          showToast={showToast}
        />
      ) : (
        <PlayerView
          currentUser={currentUser}
          onSwitchToAdmin={() => navigateTo('admin')}
          showToast={showToast}
        />
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}
