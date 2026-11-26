import React, { useState, useEffect, useRef } from 'react';
import {
  Calendar,
  Clock,
  Play,
  Edit2,
  Trash2,
  Plus,
  ToggleLeft,
  ToggleRight,
  ListMusic,
  RefreshCw,
  MoreHorizontal
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
  const [openMenuId, setOpenMenuId] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (openMenuId === null) return;
    const closeOnOutside = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpenMenuId(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpenMenuId(null);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openMenuId]);

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
    <div className="rounded-3xl bg-slate-900/70 border border-slate-800 p-4 sm:p-6 shadow-xl shadow-black/10">
      {/* 頂部功能區 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-300">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white tracking-tight">
                排程規則
              </h2>
              <p className="text-sm text-slate-400 mt-0.5">
                共 {schedules.length} 條規則，{schedules.filter((schedule) => schedule.is_active).length} 條啟用
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <button
            onClick={fetchSchedules}
            disabled={isLoading}
            className="flex items-center justify-center size-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/60 transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-400"
            title="重新整理排程清單"
            aria-label="重新整理排程清單"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={onOpenNewSchedule}
            className="flex-1 sm:flex-initial min-h-10 flex items-center justify-center gap-2 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-400"
          >
            <Plus className="w-4 h-4" />
            <span>新增排程規則</span>
          </button>
        </div>
      </div>

      {/* 排程規則列表 */}
      <div className="mt-5 space-y-3">
        {schedules.length === 0 && !isLoading && (
          <div className="text-center py-12 text-slate-400 text-sm">
            目前尚無設定任何排程規則，點擊上方按鈕建立新排程。
          </div>
        )}

        {schedules.map((sch) => {
          const isContinuous = sch.schedule_type === 'continuous';
          const isHourly = sch.schedule_type === 'hourly';
          const isInterval = sch.schedule_type === 'interval';
          const isFixedTime = sch.schedule_type === 'fixed_time';
          const typeLabel = isContinuous ? `連續輪播 · 權重 ${sch.weight}`
            : isHourly ? `每小時 :${String(sch.target_time || '00').replace(':', '').padStart(2, '0')}`
              : isInterval ? `每 ${sch.interval_every_tracks} 首插播 ${sch.interval_play_tracks} 首`
                : '指定時間';
          const timingLabel = isFixedTime
            ? `${sch.target_date ? `${sch.target_date} ` : ''}${sch.target_time} · ${sch.interrupt_mode === 'immediate_fade' ? '立即淡出' : '等待播畢'}`
            : isHourly
              ? `${sch.is_all_day ? '全天' : `${sch.start_time || '00:00'}–${sch.end_time || '23:59'}`} · ${sch.interrupt_mode === 'immediate_fade' ? '立即淡出' : '等待播畢'}`
              : sch.is_all_day ? '全天' : `${sch.start_time}–${sch.end_time}`;

          return (
            <div
              key={sch.id}
              className={`relative rounded-2xl border p-4 sm:p-5 transition-colors ${
                sch.is_active
                  ? 'bg-slate-950/45 border-slate-800 hover:border-slate-700'
                  : 'bg-slate-900/45 border-slate-800/70'
              }`}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-800/80 text-slate-300">
                    <ListMusic className="size-5" />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold leading-6 text-slate-100">{sch.title}</h3>
                      <span className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-200">{typeLabel}</span>
                      <span className={`rounded-md px-2 py-1 text-xs font-medium ${sch.is_active ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                        {sch.is_active ? '啟用中' : '已停用'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="size-4 shrink-0 text-slate-500" />
                        {sch.active_from || sch.active_until
                          ? `${sch.active_from || '不限起日'} ~ ${sch.active_until || '不限迄日'}`
                          : '永久生效'}
                      </span>
                      <span>{formatDays(sch.days_of_week)}</span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="size-4 shrink-0 text-slate-500" />
                        {timingLabel}
                      </span>
                      <span>歌單：{sch.playlist_name}</span>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 self-end lg:self-center">
                  <button
                    onClick={() => handleTriggerNow(sch)}
                    disabled={triggeringId === sch.id}
                    className="flex min-h-10 items-center gap-2 rounded-xl border border-purple-500/30 bg-purple-500/10 px-3 text-sm font-medium text-purple-200 transition-colors hover:bg-purple-500/20 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-400"
                  >
                    <Play className="size-4" />
                    <span>{triggeringId === sch.id ? '推播中...' : '立即插播'}</span>
                  </button>
                  <div className="relative" ref={openMenuId === sch.id ? menuRef : null}>
                    <button
                      type="button"
                      onClick={() => setOpenMenuId(openMenuId === sch.id ? null : sch.id)}
                      aria-label={`操作「${sch.title}」`}
                      aria-expanded={openMenuId === sch.id}
                      aria-controls={openMenuId === sch.id ? `schedule-actions-${sch.id}` : undefined}
                      className="flex size-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-slate-300 transition-colors hover:bg-slate-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-400"
                    >
                      <MoreHorizontal className="size-5" />
                    </button>
                    {openMenuId === sch.id && (
                      <div id={`schedule-actions-${sch.id}`} className="absolute right-0 top-full z-20 mt-2 w-44 rounded-xl border border-slate-700 bg-slate-900 p-1.5 shadow-xl shadow-black/30">
                        <button type="button" onClick={() => { setOpenMenuId(null); onEditSchedule(sch); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-slate-200 hover:bg-slate-800 focus-visible:bg-slate-800 focus-visible:outline-none">
                          <Edit2 className="size-4" /> 編輯規則
                        </button>
                        <button type="button" onClick={() => { setOpenMenuId(null); handleToggleActive(sch); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-slate-200 hover:bg-slate-800 focus-visible:bg-slate-800 focus-visible:outline-none">
                          {sch.is_active ? <ToggleRight className="size-4" /> : <ToggleLeft className="size-4" />}
                          {sch.is_active ? '停用規則' : '啟用規則'}
                        </button>
                        <div className="my-1 border-t border-slate-800" />
                        <button type="button" onClick={() => { setOpenMenuId(null); handleDelete(sch); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-rose-300 hover:bg-rose-500/10 focus-visible:bg-rose-500/10 focus-visible:outline-none">
                          <Trash2 className="size-4" /> 刪除規則
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
