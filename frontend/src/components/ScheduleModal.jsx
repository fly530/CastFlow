import React, { useState, useEffect, useRef } from 'react';
import { X, Calendar, Clock, Sliders, Volume2, Sparkles, AlertCircle } from 'lucide-react';
import { authFetch } from '../utils/api.js';

const DAYS = [
  { val: '1', label: '一' },
  { val: '2', label: '二' },
  { val: '3', label: '三' },
  { val: '4', label: '四' },
  { val: '5', label: '五' },
  { val: '6', label: '六' },
  { val: '0', label: '日' },
];

export default function ScheduleModal({ isOpen, onClose, editingSchedule, playlists = [], onSaved, onRequestLogin }) {
  const [title, setTitle] = useState('');
  const [playlistId, setPlaylistId] = useState('');
  const [scheduleType, setScheduleType] = useState('continuous');
  const [daysOfWeek, setDaysOfWeek] = useState(['0', '1', '2', '3', '4', '5', '6']);
  const [isAllDay, setIsAllDay] = useState(true);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('22:00');
  const [targetTime, setTargetTime] = useState('21:30:00');
  const [hourlyMinute, setHourlyMinute] = useState(0);
  const [targetDate, setTargetDate] = useState('');
  const [interruptMode, setInterruptMode] = useState('wait_track_end');
  const [weight, setWeight] = useState(1);
  const [intervalEveryTracks, setIntervalEveryTracks] = useState(4);
  const [intervalPlayTracks, setIntervalPlayTracks] = useState(1);
  const [priority, setPriority] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const prevIsOpenRef = useRef(false);

  useEffect(() => {
    // 僅在彈出視窗從關閉切換至開啟，或切換編輯不同項目時進行資料初始化
    if (isOpen && !prevIsOpenRef.current) {
      if (editingSchedule) {
        setTitle(editingSchedule.title || '');
        setPlaylistId(editingSchedule.playlist_id || (playlists[0]?.id ?? 'A'));
        setScheduleType(editingSchedule.schedule_type || 'continuous');
        setDaysOfWeek((editingSchedule.days_of_week || '0,1,2,3,4,5,6').split(','));
        setIsAllDay(Boolean(editingSchedule.is_all_day));
        setStartTime(editingSchedule.start_time ? editingSchedule.start_time.substring(0, 5) : '08:00');
        setEndTime(editingSchedule.end_time ? editingSchedule.end_time.substring(0, 5) : '22:00');
        setTargetTime(editingSchedule.target_time || '21:30:00');
        if (editingSchedule.schedule_type === 'hourly') {
          const rawMin = (editingSchedule.target_time || '00').toString().replace(':', '').trim();
          setHourlyMinute(parseInt(rawMin, 10) || 0);
        } else {
          setHourlyMinute(0);
        }
        setTargetDate(editingSchedule.target_date || '');
        setInterruptMode(editingSchedule.interrupt_mode || 'wait_track_end');
        setWeight(editingSchedule.weight || 1);
        setIntervalEveryTracks(editingSchedule.interval_every_tracks || 4);
        setIntervalPlayTracks(editingSchedule.interval_play_tracks || 1);
        setPriority(editingSchedule.priority || 0);
      } else {
        const defaultPl = playlists[0];
        const initialPlId = defaultPl?.id ?? 'A';
        const initialTitle = defaultPl?.name || '';
        setTitle(initialTitle);
        setPlaylistId(initialPlId);
        setScheduleType('continuous');
        setDaysOfWeek(['0', '1', '2', '3', '4', '5', '6']);
        setIsAllDay(true);
        setStartTime('08:00');
        setEndTime('22:00');
        setTargetTime('21:30:00');
        setHourlyMinute(0);
        setTargetDate('');
        setInterruptMode('wait_track_end');
        setWeight(1);
        setIntervalEveryTracks(4);
        setIntervalPlayTracks(1);
        setPriority(0);
      }
      setErrorMsg(null);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, editingSchedule, playlists]);

  if (!isOpen) return null;

  const handlePlaylistChange = (e) => {
    const newId = e.target.value;
    setPlaylistId(newId);
    const matched = playlists.find((p) => p.id === newId);
    if (matched?.name) {
      // 若目前是新增模式，或者標題為空、或者標題與某個歌單名稱相同，則自動帶入新歌單名稱
      if (!editingSchedule || !title.trim() || playlists.some((p) => p.name === title.trim())) {
        setTitle(matched.name);
      }
    }
  };

  const toggleDay = (dayVal) => {
    if (daysOfWeek.includes(dayVal)) {
      if (daysOfWeek.length > 1) {
        setDaysOfWeek(daysOfWeek.filter((d) => d !== dayVal));
      }
    } else {
      setDaysOfWeek([...daysOfWeek, dayVal]);
    }
  };

  const handleSelectAllDays = () => {
    setDaysOfWeek(['0', '1', '2', '3', '4', '5', '6']);
  };

  const handleSelectWeekdays = () => {
    setDaysOfWeek(['1', '2', '3', '4', '5']);
  };

  const handleSelectWeekend = () => {
    setDaysOfWeek(['0', '6']);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('請輸入排程標題');
      return;
    }
    if (!playlistId) {
      setErrorMsg('請選擇對應歌單');
      return;
    }

    try {
      setIsSaving(true);
      setErrorMsg(null);

      let finalTargetTime = null;
      if (scheduleType === 'fixed_time') {
        finalTargetTime = targetTime;
      } else if (scheduleType === 'hourly') {
        finalTargetTime = String(hourlyMinute).padStart(2, '0');
      }

      const payload = {
        title: title.trim(),
        playlist_id: playlistId,
        schedule_type: scheduleType,
        days_of_week: daysOfWeek.join(','),
        is_all_day: isAllDay ? 1 : 0,
        start_time: !isAllDay ? (startTime ? startTime.substring(0, 5) : null) : null,
        end_time: !isAllDay ? (endTime ? endTime.substring(0, 5) : null) : null,
        target_time: finalTargetTime,
        target_date: scheduleType === 'fixed_time' && targetDate ? targetDate : null,
        interrupt_mode: interruptMode,
        weight: Number(weight),
        interval_every_tracks: Number(intervalEveryTracks),
        interval_play_tracks: Number(intervalPlayTracks),
        priority: Number(priority)
      };

      const url = editingSchedule ? `/api/schedules/${editingSchedule.id}` : '/api/schedules';
      const method = editingSchedule ? 'PUT' : 'POST';

      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.status === 401) {
        setErrorMsg('請先以管理員身分登入後再進行排程儲存');
        onRequestLogin?.();
        return;
      }

      const json = await res.json();
      if (res.ok && json.success) {
        onSaved?.(json.message || '儲存成功');
        onClose();
      } else {
        setErrorMsg(json.error || '儲存失敗');
      }
    } catch (err) {
      setErrorMsg(`網路異常: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl p-6 sm:p-8 my-8 overflow-hidden">
        {/* 頂部 Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {editingSchedule ? '編輯排程規則' : '新增排程規則'}
              </h3>
              <p className="text-xs text-slate-400">
                設定智慧自動化排程播送規則與時段權重
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          {/* 基本欄位：目標歌單 (左) 與 排程名稱 (右) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">目標歌單</label>
              <select
                value={playlistId}
                onChange={handlePlaylistChange}
                className="w-full px-3.5 py-2 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-purple-500"
              >
                {playlists.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.name} ({pl.trackCount ?? pl.count ?? 0} 首)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">排程名稱</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如: 主力流行全天輪播、整點台呼、閉店單曲"
                required
                className="w-full px-3.5 py-2 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          {/* 排程類型選擇 (四個 Tab) */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">排程播放類型</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1.5 bg-slate-950 rounded-2xl border border-slate-800">
              <button
                type="button"
                onClick={() => setScheduleType('continuous')}
                className={`py-2 px-2 rounded-xl text-xs font-medium transition-all ${
                  scheduleType === 'continuous'
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/25'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                連續輪播 (Continuous)
              </button>
              <button
                type="button"
                onClick={() => {
                  setScheduleType('hourly');
                  setIsAllDay(false);
                }}
                className={`py-2 px-2 rounded-xl text-xs font-medium transition-all ${
                  scheduleType === 'hourly'
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/25'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                整點/定分插播 (Hourly)
              </button>
              <button
                type="button"
                onClick={() => setScheduleType('interval')}
                className={`py-2 px-2 rounded-xl text-xs font-medium transition-all ${
                  scheduleType === 'interval'
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/25'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                間隔插播 (Interval)
              </button>
              <button
                type="button"
                onClick={() => setScheduleType('fixed_time')}
                className={`py-2 px-2 rounded-xl text-xs font-medium transition-all ${
                  scheduleType === 'fixed_time'
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/25'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                指定時間 (Fixed Time)
              </button>
            </div>
          </div>

          {/* 星期幾選擇 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-300">生效星期</label>
              <div className="flex items-center gap-1.5 text-[11px] text-purple-400 font-mono">
                <button type="button" onClick={handleSelectAllDays} className="hover:underline">全週</button>
                <span className="text-slate-600">|</span>
                <button type="button" onClick={handleSelectWeekdays} className="hover:underline">平日</button>
                <span className="text-slate-600">|</span>
                <button type="button" onClick={handleSelectWeekend} className="hover:underline">週末</button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {DAYS.map((d) => {
                const selected = daysOfWeek.includes(d.val);
                return (
                  <button
                    key={d.val}
                    type="button"
                    onClick={() => toggleDay(d.val)}
                    className={`flex-1 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                      selected
                        ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                        : 'bg-slate-950/40 border-slate-800 text-slate-500 hover:border-slate-700'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 連續輪播 (Continuous) */}
          {scheduleType === 'continuous' && (
            <div className="space-y-4 p-4 rounded-2xl bg-slate-950/40 border border-slate-800/60">
              {/* 時段設定 */}
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-2">時段設定模式</label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setIsAllDay(true)}
                    className={`py-2 px-3 rounded-xl text-xs font-medium border transition-all ${
                      isAllDay
                        ? 'bg-purple-600/20 border-purple-500 text-purple-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    全天 24 小時輪播
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAllDay(false)}
                    className={`py-2 px-3 rounded-xl text-xs font-medium border transition-all ${
                      !isAllDay
                        ? 'bg-purple-600/20 border-purple-500 text-purple-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    指定時段輪播 (幾點到幾點)
                  </button>
                </div>

                {!isAllDay && (
                  <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800/80 space-y-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">開始時間 (24H制 HH:MM)</label>
                        <input
                          type="time"
                          value={startTime ? startTime.substring(0, 5) : '08:00'}
                          onChange={(e) => setStartTime(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">結束時間 (24H制 HH:MM)</label>
                        <input
                          type="time"
                          value={endTime ? endTime.substring(0, 5) : '22:00'}
                          onChange={(e) => setEndTime(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 focus:border-purple-500"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-200">輪播權重 (Weight: {weight})</span>
                  <span className="text-[11px] text-slate-400">數值愈大，播出比例愈高 (例如 3:1)</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  className="w-full accent-purple-500 cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* 整點 / 定分插播 (Hourly) */}
          {scheduleType === 'hourly' && (
            <div className="space-y-4 p-4 rounded-2xl bg-slate-950/40 border border-slate-800/60">
              {/* 1. 每小時播放時間點 */}
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                  每小時播放時間點 (第幾分鐘)
                </label>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  {[
                    { label: '整點 (:00)', val: 0 },
                    { label: '每半點 (:30)', val: 30 },
                    { label: '每 15 分 (:15)', val: 15 },
                    { label: '每 45 分 (:45)', val: 45 },
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      type="button"
                      onClick={() => setHourlyMinute(preset.val)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                        Number(hourlyMinute) === preset.val
                          ? 'bg-purple-600/20 border-purple-500 text-purple-200'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">或指定每小時第</span>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={hourlyMinute}
                    onChange={(e) => {
                      const val = Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0));
                      setHourlyMinute(val);
                    }}
                    className="w-20 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-center text-white focus:border-purple-500"
                  />
                  <span className="text-xs text-slate-400">分播出 (例如 30 表示 11:30, 12:30...)</span>
                </div>
              </div>

              {/* 2. 生效時段區間 (幾點到幾點) */}
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-2">生效時段區間</label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setIsAllDay(false)}
                    className={`py-2 px-3 rounded-xl text-xs font-medium border transition-all ${
                      !isAllDay
                        ? 'bg-purple-600/20 border-purple-500 text-purple-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    指定時段 (幾點到幾點)
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAllDay(true)}
                    className={`py-2 px-3 rounded-xl text-xs font-medium border transition-all ${
                      isAllDay
                        ? 'bg-purple-600/20 border-purple-500 text-purple-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    全天 24 小時每小時
                  </button>
                </div>

                {!isAllDay && (
                  <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800/80 space-y-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">開始時間 (24H制 HH:MM)</label>
                        <input
                          type="time"
                          value={startTime ? startTime.substring(0, 5) : '11:00'}
                          onChange={(e) => setStartTime(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">結束時間 (24H制 HH:MM)</label>
                        <input
                          type="time"
                          value={endTime ? endTime.substring(0, 5) : '22:00'}
                          onChange={(e) => setEndTime(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 focus:border-purple-500"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. 插播切入方式 */}
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1.5">插播切入方式</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setInterruptMode('wait_track_end')}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      interruptMode === 'wait_track_end'
                        ? 'bg-purple-600/10 border-purple-500 text-purple-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-semibold text-xs text-slate-200">等待播畢插播</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">當前播放中的曲目唱完後平滑切入</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInterruptMode('immediate_fade')}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      interruptMode === 'immediate_fade'
                        ? 'bg-purple-600/10 border-purple-500 text-purple-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-semibold text-xs text-slate-200">淡出立即插播</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">到點時當前曲目淡出立即播放 (適合整點報時)</div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {scheduleType === 'interval' && (
            <div className="space-y-4 p-4 rounded-2xl bg-slate-950/40 border border-slate-800/60">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">間隔插播頻率</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">每經過 X 首歌</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={intervalEveryTracks}
                    onChange={(e) => setIntervalEveryTracks(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">插播 Y 首歌</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={intervalPlayTracks}
                    onChange={(e) => setIntervalPlayTracks(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100"
                  />
                </div>
              </div>
            </div>
          )}

          {scheduleType === 'fixed_time' && (
            <div className="space-y-4 p-4 rounded-2xl bg-slate-950/40 border border-slate-800/60">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1">
                    指定播出時間 (24H制 HH:MM:SS)
                  </label>
                  <input
                    type="time"
                    step="1"
                    value={targetTime}
                    onChange={(e) => setTargetTime(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1">
                    單次指定日期 (選填)
                  </label>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    placeholder="若空白則為常態每週"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-2">
                  切入過渡行為 (Interrupt Mode)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setInterruptMode('wait_track_end')}
                    className={`p-2.5 rounded-xl border text-left text-xs transition-all ${
                      interruptMode === 'wait_track_end'
                        ? 'border-purple-500 bg-purple-500/10 text-purple-200'
                        : 'border-slate-800 bg-slate-900 text-slate-400'
                    }`}
                  >
                    <div className="font-semibold">溫柔等待播完</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">當前歌曲播完後自然無縫切入</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInterruptMode('immediate_fade')}
                    className={`p-2.5 rounded-xl border text-left text-xs transition-all ${
                      interruptMode === 'immediate_fade'
                        ? 'border-purple-500 bg-purple-500/10 text-purple-200'
                        : 'border-slate-800 bg-slate-900 text-slate-400'
                    }`}
                  >
                    <div className="font-semibold">立即淡出插播</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">時間一到強制淡出當前曲目切換</div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 底部按鈕 */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/25 transition-all disabled:opacity-50"
            >
              {isSaving ? '儲存中...' : '儲存排程'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
