import React, { useState, useEffect, useRef } from 'react';
import UnifiedPlayerCard from '../components/UnifiedPlayerCard.jsx';
import StreamInfoModal from '../components/StreamInfoModal.jsx';

export default function PlayerView({ currentUser, onSwitchToAdmin }) {
  const [statusData, setStatusData] = useState(null);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const wsRef = useRef(null);

  // 定期輪詢作為備援機制
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setStatusData(json.data);
        }
      }
    } catch {
      // 網路暫態錯誤
    }
  };

  useEffect(() => {
    fetchStatus();

    // 建立 WebSocket 即時推播連線
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
              setStatusData(msg.data);
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
      } catch (err) {
        reconnectTimeout = setTimeout(connectWS, 5000);
      }
    };

    connectWS();

    const timer = setInterval(fetchStatus, 15000);

    return () => {
      clearInterval(timer);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const online = statusData?.online ?? false;
  const bitrate = statusData?.icecast?.bitrate ?? 128;
  const currentTrack = statusData?.currentTrack ?? {
    title: 'CastFlow Live',
    artist: '雲原生自動化廣播電台',
    album: '',
    progress: 0,
    elapsed: 0,
    remaining: null
  };
  const upcoming = statusData?.upcomingTracks ?? statusData?.upcoming ?? [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-3 sm:p-6 lg:p-8 relative overflow-x-hidden selection:bg-indigo-500 selection:text-white">
      {/* 氛圍環境光暈 (Ambient Lighting) */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-indigo-600/10 rounded-full blur-[128px]" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-purple-600/10 rounded-full blur-[128px]" />
        <div className="absolute -top-32 right-1/3 w-80 h-80 bg-pink-600/5 rounded-full blur-[128px]" />
      </div>

      {/* 單一全整合式播放卡片 */}
      <main className="w-full relative z-10 my-auto">
        <UnifiedPlayerCard
          currentTrack={currentTrack}
          upcoming={upcoming}
          online={online}
          bitrate={bitrate}
          onOpenInfoModal={() => setIsInfoModalOpen(true)}
          onSwitchToAdmin={onSwitchToAdmin}
          currentUser={currentUser}
        />
      </main>

      {/* 硬體與連線資訊彈跳視窗 */}
      <StreamInfoModal
        isOpen={isInfoModalOpen}
        onClose={() => setIsInfoModalOpen(false)}
        bitrate={bitrate}
      />
    </div>
  );
}
