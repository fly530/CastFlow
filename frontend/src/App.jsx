import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import Toast from './components/Toast.jsx';
import { getMe, getToken } from './utils/api.js';

// 前台與後台分開打包：聽眾不必下載整個管理介面，管理員也不必下載 hls.js。
// 部署新版後，開著的舊分頁切換前後台時要的是舊檔名的 chunk (已不存在)：重新載入一次拿新版。
// 用 sessionStorage 記住已重試過，真的載不到時不會無限重新整理。
const RELOAD_FLAG = 'castflow_chunk_reload';
function lazyView(load) {
  return lazy(() =>
    load()
      .then((mod) => {
        try {
          sessionStorage.removeItem(RELOAD_FLAG);
        } catch {}
        return mod;
      })
      .catch((err) => {
        let retried = false;
        try {
          retried = sessionStorage.getItem(RELOAD_FLAG) === '1';
          if (!retried) sessionStorage.setItem(RELOAD_FLAG, '1');
        } catch {}
        if (retried) throw err;
        window.location.reload();
        return new Promise(() => {});
      })
  );
}
const PlayerView = lazyView(() => import('./views/PlayerView.jsx'));
const AdminView = lazyView(() => import('./views/AdminView.jsx'));

// 畫面程式載不到 (離線、重新整理後仍失敗) 時顯示提示，而不是整頁空白
class ViewErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-screen bg-slate-950 text-slate-300 flex flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-sm">頁面載入失敗，請檢查網路連線後重新整理。</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold"
        >
          重新整理
        </button>
      </div>
    );
  }
}

function ViewFallback() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

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
      <ViewErrorBoundary>
        <Suspense fallback={<ViewFallback />}>
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
        </Suspense>
      </ViewErrorBoundary>
      <Toast key={toast?.id} toast={toast} onClose={closeToast} />
    </>
  );
}
