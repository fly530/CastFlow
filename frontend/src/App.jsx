import React, { useState, useEffect, useRef, useCallback } from 'react';
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

  // 每次只顯示一則；新訊息會取代舊的並重新計時 (原本舊的計時器會提早把新訊息關掉)。
  // 錯誤訊息停留久一點，來得及讀完。
  const toastTimerRef = useRef(null);
  const closeToast = useCallback(() => {
    clearTimeout(toastTimerRef.current);
    setToast(null);
  }, []);
  const showToast = useCallback((message, type = 'success') => {
    clearTimeout(toastTimerRef.current);
    setToast({ message, type, id: Date.now() });
    toastTimerRef.current = setTimeout(() => setToast(null), type === 'error' ? 7000 : type === 'warning' ? 6000 : 4000);
  }, []);
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

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
  const retryTimerRef = useRef(null);
  const checkSession = async () => {
    clearTimeout(retryTimerRef.current);
    try {
      if (!getToken()) {
        setCurrentUser(null);
        return;
      }
      const result = await getMe();
      if (result.status === 'ok') {
        setCurrentUser(result.user);
      } else if (result.status === 'unauthorized') {
        setCurrentUser(null);
      } else {
        // 網路暫時斷線或伺服器重啟中：token 仍有效，保留目前登入狀態，稍後重試
        retryTimerRef.current = setTimeout(checkSession, 5000);
      }
    } finally {
      setIsCheckingAuth(false);
    }
  };

  useEffect(() => {
    checkSession();
    const handleAuthChange = () => checkSession();
    window.addEventListener('castflow_auth_change', handleAuthChange);
    return () => {
      window.removeEventListener('castflow_auth_change', handleAuthChange);
      clearTimeout(retryTimerRef.current);
    };
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
      <Toast key={toast?.id} toast={toast} onClose={closeToast} />
    </>
  );
}
