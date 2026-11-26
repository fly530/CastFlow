import React, { useState, useEffect, useRef } from 'react';
import { X, Calendar, Clock, Sliders, Volume2, Sparkles, AlertCircle } from 'lucide-react';
import { authFetch, readJson } from '../utils/api.js';

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
  const [activeFrom, setActiveFrom] = useState('');
  const [activeUntil, setActiveUntil] = useState('');
  const [interruptMode, setInterruptMode] = useState('wait_track_end');
  const [weight, setWeight] = useState(1);
  const [intervalEveryTracks, setIntervalEveryTracks] = useState(4);
  const [intervalPlayTracks, setIntervalPlayTracks] = useState(1);
  const [priority, setPriority] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);


  useEffect(() => {
    // 每次 Modal 開啟或切換編輯對象時，重新初始化表單資料
    if (!isOpen) return;
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
      setActiveFrom(editingSchedule.active_from || '');
      setActiveUntil(editingSchedule.active_until || '');
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
      setActiveFrom('');
      setActiveUntil('');
      setInterruptMode('wait_track_end');
      setWeight(1);
      setIntervalEveryTracks(4);
      setIntervalPlayTracks(1);
      setPriority(0);
    }
    setErrorMsg(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingSchedule?.id]);

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
    if (activeFrom && activeUntil && activeFrom > activeUntil) {
      setErrorMsg('結束日期不得早於開始日期');
      return;
    }
    if (scheduleType === 'interval') {
      const every = Number(intervalEveryTracks);
      const play = Number(intervalPlayTracks);
      if (!Number.isInteger(every) || every < 1 || !Number.isInteger(play) || play < 1) {
        setErrorMsg('間隔插播的「每 X 首」與「插播 Y 首」都需為 1 以上的整數');
        return;
      }
    }

    try {
      setIsSaving(true);
      setErrorMsg(null);

      const effectiveAllDay = scheduleType === 'interval' ? true : isAllDay;
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
        // 間隔插播的表單沒有時段設定：一律全天，避免沿用其他分頁留下的時段而被默默限縮
        is_all_day: effectiveAllDay ? 1 : 0,
        // 時間欄位未修改時，畫面上顯示的是預設值 (08:00 ~ 22:00)，送出的也要是同一個值
        start_time: effectiveAllDay ? null : (startTime || (scheduleType === 'hourly' ? '11:00' : '08:00')).substring(0, 5),
        end_time: effectiveAllDay ? null : (endTime || '22:00').substring(0, 5),
        target_time: finalTargetTime,
        target_date: scheduleType === 'fixed_time' && targetDate ? targetDate : null,
        active_from: activeFrom || null,
        active_until: activeUntil || null,
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

      const json = await readJson(res);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6">
      <div role="dialog" aria-modal="true" aria-labelledby="schedule-modal-title" className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/40 sm:max-h-[calc(100dvh-3rem)]">
        {/* 頂部 Header */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-800 px-5 py-4 sm:px-7 sm:py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-300">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 id="schedule-modal-title" className="text-lg font-semibold text-white">
                {editingSchedule ? '編輯排程規則' : '新增排程規則'}
              </h3>
              <p className="text-sm text-slate-400">
                設定播放條件與播出方式
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉排程編輯窗"
            className="flex size-10 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div role="alert" className="mx-5 mt-4 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200 sm:mx-7">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">基本資料</h4>
          {/* 基本欄位：目標歌單 (左) 與 排程名稱 (右) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-1.5">目標歌單</label>
              <select
                value={playlistId}
                onChange={handlePlaylistChange}
                className="w-full px-3.5 py-2 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-purple-500"
              >
                {playlists.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.name} ({pl.trackCount ?? pl.count ?? 0} 首)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-1.5">排程名稱</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如: 主力流行全天輪播、整點台呼、閉店單曲"
                required
                className="w-full px-3.5 py-2 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>
          </div>

          {/* 生效日期區間 */}
          <section className="space-y-5 rounded-2xl border border-slate-800 bg-slate-950/30 p-4 sm:p-5">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">生效條件</h4>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">生效日期區間</label>
            <p className="text-xs text-slate-400 mb-3">留空代表不限制日期；起訖日期當天都包含在內。可只設定其中一端。已排入待播佇列的歌曲仍會播完。</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="schedule-active-from" className="block text-xs text-slate-400 mb-1">開始日期</label>
                <input id="schedule-active-from" type="date" value={activeFrom} onChange={(e) => setActiveFrom(e.target.value)}
                  className="min-h-10 w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:border-purple-500" />
              </div>
              <div>
                <label htmlFor="schedule-active-until" className="block text-xs text-slate-400 mb-1">結束日期</label>
                <input id="schedule-active-until" type="date" value={activeUntil} onChange={(e) => setActiveUntil(e.target.value)}
                  className="min-h-10 w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:border-purple-500" />
              </div>
            </div>
          </div>

          {/* 星期幾選擇 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-slate-300">生效星期</label>
              <div className="flex items-center gap-1.5 text-xs text-purple-400 font-mono">
                <button type="button" onClick={handleSelectAllDays} className="min-h-9 px-1 hover:underline">全週</button>
                <span className="text-slate-600">|</span>
                <button type="button" onClick={handleSelectWeekdays} className="min-h-9 px-1 hover:underline">平日</button>
                <span className="text-slate-600">|</span>
                <button type="button" onClick={handleSelectWeekend} className="min-h-9 px-1 hover:underline">週末</button>
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
                    aria-label={`星期${d.label}`}
                    aria-pressed={selected}
                    className={`min-h-10 min-w-0 flex-1 rounded-xl text-sm font-semibold border transition-colors ${
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
          </section>

          <section className="space-y-4">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">播放方式</h4>
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-200">排程類型</label>
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-950 p-1.5 sm:grid-cols-4">
                {[
                  ['continuous', '連續輪播'],
                  ['hourly', '整點／定分'],
                  ['interval', '間隔插播'],
                  ['fixed_time', '指定時間']
                ].map(([type, label]) => (
                  <button key={type} type="button" onClick={() => {
                    setScheduleType(type);
                    if (type === 'hourly') setIsAllDay(false);
                  }} aria-pressed={scheduleType === type}
                    className={`min-h-10 rounded-lg px-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400 ${
                      scheduleType === type ? 'bg-purple-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                    }`}>{label}</button>
                ))}
              </div>
            </div>

          {/* 連續輪播 (Continuous) */}
          {scheduleType === 'continuous' && (
            <div className="space-y-4 p-4 rounded-2xl bg-slate-950/40 border border-slate-800/60">
              {/* 時段設定 */}
              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-2">時段設定模式</label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setIsAllDay(true)}
                    className={`py-2 px-3 rounded-xl text-sm font-medium border transition-all ${
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
                    className={`py-2 px-3 rounded-xl text-sm font-medium border transition-all ${
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
                        <label className="block text-xs text-slate-400 mb-1">開始時間 (24H制 HH:MM)</label>
                        <input
                          type="time"
                          value={startTime ? startTime.substring(0, 5) : '08:00'}
                          onChange={(e) => setStartTime(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-100 focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">結束時間 (24H制 HH:MM)</label>
                        <input
                          type="time"
                          value={endTime ? endTime.substring(0, 5) : '22:00'}
                          onChange={(e) => setEndTime(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-100 focus:border-purple-500"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-semibold text-slate-200">輪播權重 (Weight: {weight})</span>
                  <span className="text-xs text-slate-400">數值愈大，播出比例愈高 (例如 3:1)</span>
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
                <label className="block text-sm font-semibold text-slate-200 mb-1.5">
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
                      className={`px-3 py-1.5 rounded-xl text-sm font-semibold border transition-all ${
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
                  <span className="text-sm text-slate-400">或指定每小時第</span>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={hourlyMinute}
                    onChange={(e) => {
                      const val = Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0));
                      setHourlyMinute(val);
                    }}
                    className="w-20 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-sm font-mono text-center text-white focus:border-purple-500"
                  />
                  <span className="text-sm text-slate-400">分播出 (例如 30 表示 11:30, 12:30...)</span>
                </div>
              </div>

              {/* 2. 生效時段區間 (幾點到幾點) */}
              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-2">生效時段區間</label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setIsAllDay(false)}
                    className={`py-2 px-3 rounded-xl text-sm font-medium border transition-all ${
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
                    className={`py-2 px-3 rounded-xl text-sm font-medium border transition-all ${
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
                        <label className="block text-xs text-slate-400 mb-1">開始時間 (24H制 HH:MM)</label>
                        <input
                          type="time"
                          value={startTime ? startTime.substring(0, 5) : '11:00'}
                          onChange={(e) => setStartTime(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-100 focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">結束時間 (24H制 HH:MM)</label>
                        <input
                          type="time"
                          value={endTime ? endTime.substring(0, 5) : '22:00'}
                          onChange={(e) => setEndTime(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-100 focus:border-purple-500"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. 插播切入方式 */}
              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-1.5">插播切入方式</label>
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
                    <div className="font-semibold text-sm text-slate-200">等待播畢插播</div>
                    <div className="text-xs text-slate-400 mt-0.5">當前播放中的曲目唱完後平滑切入</div>
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
                    <div className="font-semibold text-sm text-slate-200">淡出立即插播</div>
                    <div className="text-xs text-slate-400 mt-0.5">到點時當前曲目淡出立即播放 (適合整點報時)</div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {scheduleType === 'interval' && (
            <div className="space-y-4 p-4 rounded-2xl bg-slate-950/40 border border-slate-800/60">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-200">間隔插播頻率</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">每經過 X 首歌</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={intervalEveryTracks}
                    onChange={(e) => setIntervalEveryTracks(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">插播 Y 首歌</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={intervalPlayTracks}
                    onChange={(e) => setIntervalPlayTracks(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100"
                  />
                </div>
              </div>
            </div>
          )}

          {scheduleType === 'fixed_time' && (
            <div className="space-y-4 p-4 rounded-2xl bg-slate-950/40 border border-slate-800/60">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-200 mb-1">
                    指定播出時間 (24H制 HH:MM:SS)
                  </label>
                  <input
                    type="time"
                    step="1"
                    value={targetTime}
                    onChange={(e) => setTargetTime(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-200 mb-1">
                    單次指定日期 (選填，須同時符合生效區間)
                  </label>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    placeholder="若空白則為常態每週"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-2">
                  切入過渡行為 (Interrupt Mode)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setInterruptMode('wait_track_end')}
                    className={`p-2.5 rounded-xl border text-left text-sm transition-all ${
                      interruptMode === 'wait_track_end'
                        ? 'border-purple-500 bg-purple-500/10 text-purple-200'
                        : 'border-slate-800 bg-slate-900 text-slate-400'
                    }`}
                  >
                    <div className="font-semibold">溫柔等待播完</div>
                    <div className="text-xs text-slate-500 mt-0.5">當前歌曲播完後自然無縫切入</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInterruptMode('immediate_fade')}
                    className={`p-2.5 rounded-xl border text-left text-sm transition-all ${
                      interruptMode === 'immediate_fade'
                        ? 'border-purple-500 bg-purple-500/10 text-purple-200'
                        : 'border-slate-800 bg-slate-900 text-slate-400'
                    }`}
                  >
                    <div className="font-semibold">立即淡出插播</div>
                    <div className="text-xs text-slate-500 mt-0.5">時間一到強制淡出當前曲目切換</div>
                  </button>
                </div>
              </div>
            </div>
          )}
          </section>

          </div>
          {/* 固定在視窗底部的主要操作 */}
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-800 bg-slate-900 px-5 py-4 sm:px-7">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="min-h-10 rounded-xl px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="min-h-10 rounded-xl bg-purple-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-purple-500 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400"
            >
              {isSaving ? '儲存中...' : '儲存排程'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
