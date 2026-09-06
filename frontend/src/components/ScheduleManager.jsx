import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Clock,
  Play,
  Edit2,
  Trash2,
  Plus,
  Radio,
  Sparkles,
  Layers,
  CheckCircle2,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  ListMusic,
  RefreshCw
} from 'lucide-react';
import { authFetch } from '../utils/api.js';

const DAY_LABELS = {
  '0': '日',
  '1': '一',
  '2': '二',
  '3': '三',
  '4': '四',
  '5': '五',
  '6': '六',
};

export default function ScheduleManager({
  playlists = [],
  onOpenNewSchedule,
  onEditSchedule,
  onOpenNewPlaylist,
  onRequestLogin,
  showToast,
  refreshTrigger,
  onScheduleChanged
}) {
  const [schedules, setSchedules] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [triggeringId, setTriggeringId] = useState(null);

  const fetchSchedules = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/schedules');
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setSchedules(json.data || []);
        }
      }
    } catch (err) {
      console.error('Failed to load schedules:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, [refreshTrigger]);

  const handleToggleActive = async (schedule) => {
    try {
      const res = await authFetch(`/api/schedules/${schedule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: schedule.is_active ? 0 : 1 })
      });

      if (res.status === 401) {
        showToast?.('請先以管理員身分登入後再調整排程', 'error');
        onRequestLogin?.();
        return;
      }

      const json = await res.json();
      if (res.ok && json.success) {
        showToast?.(`已${schedule.is_active ? '停用' : '啟用'}「${schedule.title}」`);
        fetchSchedules();
        onScheduleChanged?.();
      }
    } catch (err) {
      showToast?.(`操作失敗: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (schedule) => {
    if (!window.confirm(`確定要刪除排程規則「${schedule.title}」嗎？`)) {
      return;
    }

    try {
      const res = await authFetch(`/api/schedules/${schedule.id}`, {
        method: 'DELETE'
      });

      if (res.status === 401) {
        showToast?.('請先登入管理員帳號', 'error');
        onRequestLogin?.();
        return;
      }

      if (res.ok) {
        showToast?.(`已刪除「${schedule.title}」`);
        fetchSchedules();
        onScheduleChanged?.();
      }
    } catch (err) {
      showToast?.(`刪除異常: ${err.message}`, 'error');
    }
  };

  const handleTriggerNow = async (schedule) => {
    try {
      setTriggeringId(schedule.id);
      const res = await authFetch(`/api/schedules/${schedule.id}/trigger`, {
        method: 'POST'
      });

      if (res.status === 401) {
        showToast?.('請先以管理員身分登入', 'error');
        onRequestLogin?.();
        return;
      }

      const json = await res.json();
      if (res.ok && json.success) {
        showToast?.(json.message || '已成功插播！');
        onScheduleChanged?.();
      } else {
        showToast?.(json.error || '插播失敗', 'error');
      }
    } catch (err) {
      showToast?.(`連線異常: ${err.message}`, 'error');
    } finally {
      setTriggeringId(null);
    }
  };

  const formatDays = (daysStr) => {
    if (!daysStr) return '全週';
    const arr = daysStr.split(',');
    if (arr.length === 7) return '每日';
    if (arr.length === 5 && !arr.includes('0') && !arr.includes('6')) return '週一至週五';
    if (arr.length === 2 && arr.includes('0') && arr.includes('6')) return '週末';
    return arr.map((d) => DAY_LABELS[d] || d).join('、');
  };

  return (
    <div className="rounded-3xl bg-slate-900/70 border border-slate-800 backdrop-blur-xl p-6 shadow-2xl">
      {/* 頂部功能區 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                智慧自動化排程調度中心 (AutoDJ Schedules)
              </h2>
              <p className="text-xs text-slate-400">
                動態調度全天輪播比例、間隔台呼插播或指定精確時間單曲
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <button
            onClick={fetchSchedules}
            disabled={isLoading}
            className="flex items-center justify-center p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition-all active:scale-95 disabled:opacity-50"
            title="重新整理排程清單"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={onOpenNewSchedule}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/25 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>新增排程規則</span>
          </button>
        </div>
      </div>

      {/* 排程規則列表 */}
      <div className="mt-6 space-y-3">
        {schedules.length === 0 && !isLoading && (
          <div className="text-center py-12 text-slate-500 text-xs">
            目前尚無設定任何排程規則，點擊上方按鈕建立新排程。
          </div>
        )}

        {schedules.map((sch) => {
          const isContinuous = sch.schedule_type === 'continuous';
          const isHourly = sch.schedule_type === 'hourly';
          const isInterval = sch.schedule_type === 'interval';
          const isFixedTime = sch.schedule_type === 'fixed_time';

          return (
            <div
              key={sch.id}
              className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                sch.is_active
                  ? 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                  : 'bg-slate-950/20 border-slate-900/50 opacity-60'
              }`}
            >
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                {/* 左側：排程基本資訊與歌單徽章 */}
                <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-slate-800/90 border border-slate-700/80 flex items-center justify-center text-purple-300 shadow-inner flex-shrink-0">
                    <ListMusic className="w-5 h-5 text-purple-300" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-slate-100 truncate">{sch.title}</h3>

                      {/* 類型標籤 */}
                      {isContinuous && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          輪播 (權重 {sch.weight})
                        </span>
                      )}
                      {isHourly && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>每小時 :{String(sch.target_time || '00').replace(':', '').padStart(2, '0')} 分插播</span>
                        </span>
                      )}
                      {isInterval && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          每 {sch.interval_every_tracks} 首插播 {sch.interval_play_tracks} 首
                        </span>
                      )}
                      {isFixedTime && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>指定 {sch.target_time}</span>
                        </span>
                      )}

                      {!sch.is_active && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                          已停用
                        </span>
                      )}
                    </div>

                    {/* 時間細節描述 */}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-500" />
                        <span>{formatDays(sch.days_of_week)}</span>
                      </span>

                      <span className="text-slate-700">•</span>

                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        {isFixedTime ? (
                          <span>
                            {sch.target_date ? `${sch.target_date} ` : '每日 '}
                            {sch.target_time} (
                            {sch.interrupt_mode === 'immediate_fade' ? '淡出插播' : '等待播畢'}
                            )
                          </span>
                        ) : isHourly ? (
                          <span>
                            {sch.is_all_day ? '全天每小時 ' : `${sch.start_time || '00:00'} ~ ${sch.end_time || '23:59'} 每小時 `}
                            第 {String(sch.target_time || '00').replace(':', '').padStart(2, '0')} 分 (
                            {sch.interrupt_mode === 'immediate_fade' ? '淡出插播' : '等待播畢'}
                            )
                          </span>
                        ) : sch.is_all_day ? (
                          <span>全天 24 小時</span>
                        ) : (
                          <span>
                            {sch.start_time} ~ {sch.end_time}
                          </span>
                        )}
                      </span>

                      <span className="text-slate-700">•</span>

                      <span>
                        歌單：{sch.playlist_name}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 右側：動作按鈕 */}
                <div className="flex items-center gap-2 self-end lg:self-center">
                  {/* 立即觸發播放 */}
                  <button
                    onClick={() => handleTriggerNow(sch)}
                    disabled={triggeringId === sch.id}
                    title="立即插入廣播隊列播放"
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-purple-600/10 hover:bg-purple-600/20 text-purple-300 border border-purple-500/30 text-xs font-semibold transition-all disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>{triggeringId === sch.id ? '推播中...' : '立即插播'}</span>
                  </button>

                  {/* 啟用/停用開關 */}
                  <button
                    onClick={() => handleToggleActive(sch)}
                    title={sch.is_active ? '點擊停用' : '點擊啟用'}
                    className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
                  >
                    {sch.is_active ? (
                      <ToggleRight className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <ToggleLeft className="w-5 h-5 text-slate-600" />
                    )}
                  </button>

                  {/* 編輯 */}
                  <button
                    onClick={() => onEditSchedule(sch)}
                    title="編輯排程"
                    className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>

                  {/* 刪除 */}
                  <button
                    onClick={() => handleDelete(sch)}
                    title="刪除排程"
                    className="p-1.5 text-slate-400 hover:text-rose-400 rounded-xl hover:bg-slate-800 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
