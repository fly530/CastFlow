import React, { useState } from 'react';
import { useRadioStatus } from '../hooks/useRadioStatus.js';
import UnifiedPlayerCard from '../components/UnifiedPlayerCard.jsx';
import StreamInfoModal from '../components/StreamInfoModal.jsx';

export default function PlayerView({ currentUser, onSwitchToAdmin }) {
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const { status: statusData } = useRadioStatus({ pollMs: 15000 });

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
