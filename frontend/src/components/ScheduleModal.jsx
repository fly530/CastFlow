import React, { useState, useEffect, useId } from 'react';
import { Calendar, AlertCircle } from 'lucide-react';
import { authFetch, readJson } from '../utils/api.js';
import Modal, { ModalCloseButton } from './Modal.jsx';

const DAYS = [
  { val: '1', label: '一' },
  { val: '2', label: '二' },
  { val: '3', label: '三' },
  { val: '4', label: '四' },
  { val: '5', label: '五' },
  { val: '6', label: '六' },
  { val: '0', label: '日' },
];

// 「等待播畢 / 淡出立即插播」在整點與指定時間兩種排程共用；原本兩處的文案不一樣
const INTERRUPT_MODES = [
  { value: 'wait_track_end', label: '等待播畢插播', hint: '目前的歌播完後接著播出' },
  { value: 'immediate_fade', label: '淡出立即插播', hint: '時間一到就淡出目前的歌並切入 (適合整點報時)' }
];

function InterruptModePicker({ value, onChange, labelId }) {
  return (
    <div role="group" aria-labelledby={labelId} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {INTERRUPT_MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          aria-pressed={value === m.value}
          onClick={() => onChange(m.value)}
          className={`p-2.5 rounded-xl border text-left transition-all ${
            value === m.value
              ? 'bg-purple-600/10 border-purple-500 text-purple-300'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
          }`}
        >
          <div className="font-semibold text-xs text-slate-200">{m.label}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">{m.hint}</div>
        </button>
      ))}
    </div>
  );
}

/** 「全天 / 指定時段」切換 + 起訖時間 (連續輪播與整點插播共用) */
function TimeRangeFields({ uid, isAllDay, setIsAllDay, startTime, setStartTime, endTime, setEndTime, defaults, labels }) {
  const options = [
    { allDay: labels.allDayFirst, label: labels.first },
    { allDay: !labels.allDayFirst, label: labels.second }
  ];
  return (
    <>
      <div role="group" aria-labelledby={`${uid}-range`} className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        {options.map((o) => (
          <button
            key={String(o.allDay)}
            type="button"
            aria-pressed={isAllDay === o.allDay}
            onClick={() => setIsAllDay(o.allDay)}
            className={`py-2 px-3 rounded-xl text-xs font-medium border transition-all ${
              isAllDay === o.allDay
                ? 'bg-purple-600/20 border-purple-500 text-purple-200'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {!isAllDay && (
        <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800/80">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${uid}-start`} className="block text-[11px] text-slate-400 mb-1">
                開始時間 (24 小時制)
              </label>
              <input
                id={`${uid}-start`}
                type="time"
                value={startTime ? startTime.substring(0, 5) : defaults.start}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 focus:border-purple-500"
              />
            </div>
            <div>
              <label htmlFor={`${uid}-end`} className="block text-[11px] text-slate-400 mb-1">
                結束時間 (24 小時制)
              </label>
              <input
                id={`${uid}-end`}
                type="time"
                value={endTime ? endTime.substring(0, 5) : defaults.end}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 focus:border-purple-500"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function ScheduleModal({ isOpen, onClose, editingSchedule, playlists = [], onSaved }) {
  const uid = useId();
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

      if (res.status === 401) return; // 登入失效：authFetch 已登出，整個後台會切回登入頁

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

  const typeButtons = [
    { value: 'continuous', label: '連續輪播 (Continuous)' },
    { value: 'hourly', label: '整點/定分插播 (Hourly)' },
    { value: 'interval', label: '間隔插播 (Interval)' },
    { value: 'fixed_time', label: '指定時間 (Fixed Time)' }
  ];
  const fieldClass =
    'w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-purple-500';

  return (
    <Modal onClose={onClose} titleId={`${uid}-title`} dismissible={!isSaving} panelClassName="max-w-2xl p-6 sm:p-8">
      {/* 頂部 Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center"
            aria-hidden="true"
          >
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h3 id={`${uid}-title`} className="text-base font-bold text-white">
              {editingSchedule ? '編輯排程規則' : '新增排程規則'}
            </h3>
            <p className="text-xs text-slate-400">設定智慧自動化排程播送規則與時段權重</p>
          </div>
        </div>
        <ModalCloseButton onClick={onClose} disabled={isSaving} />
      </div>

      {errorMsg && (
        <div role="alert" className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        {/* 基本欄位：目標歌單 (左) 與 排程名稱 (右) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor={`${uid}-playlist`} className="block text-xs font-semibold text-slate-300 mb-1.5">
              目標歌單
            </label>
            <select
              id={`${uid}-playlist`}
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
            <label htmlFor={`${uid}-name`} className="block text-xs font-semibold text-slate-300 mb-1.5">
              排程名稱
            </label>
            <input
              id={`${uid}-name`}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如: 主力流行全天輪播、整點台呼、閉店單曲"
              required
              className="w-full px-3.5 py-2 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
            />
          </div>
        </div>

        {/* 生效日期區間：空白代表不限制，日期區間首尾皆包含 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
          <div>
            <label htmlFor={`${uid}-active-from`} className="block text-xs font-semibold text-slate-300 mb-1.5">
              生效起日 <span className="font-normal text-slate-500">(選填)</span>
            </label>
            <input
              id={`${uid}-active-from`}
              type="date"
              value={activeFrom}
              max={activeUntil || undefined}
              onChange={(e) => setActiveFrom(e.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor={`${uid}-active-until`} className="block text-xs font-semibold text-slate-300 mb-1.5">
              生效迄日 <span className="font-normal text-slate-500">(選填)</span>
            </label>
            <input
              id={`${uid}-active-until`}
              type="date"
              value={activeUntil}
              min={activeFrom || undefined}
              onChange={(e) => setActiveUntil(e.target.value)}
              className={fieldClass}
            />
          </div>
          <p className="sm:col-span-2 -mt-1 text-[11px] leading-relaxed text-slate-500">
            留白表示不限制生效日期；設定後，起日與迄日當天都會生效。
          </p>
        </div>

        {/* 排程類型選擇 (四個 Tab) */}
        <div>
          <span id={`${uid}-type`} className="block text-xs font-semibold text-slate-300 mb-2">
            排程播放類型
          </span>
          <div
            role="group"
            aria-labelledby={`${uid}-type`}
            className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1.5 bg-slate-950 rounded-2xl border border-slate-800"
          >
            {typeButtons.map((t) => (
              <button
                key={t.value}
                type="button"
                aria-pressed={scheduleType === t.value}
                onClick={() => {
                  setScheduleType(t.value);
                  if (t.value === 'hourly') setIsAllDay(false);
                }}
                className={`py-2 px-2 rounded-xl text-xs font-medium transition-all ${
                  scheduleType === t.value
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/25'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* 星期幾選擇 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span id={`${uid}-days`} className="text-xs font-semibold text-slate-300">
              生效星期
            </span>
            <div className="flex items-center gap-1.5 text-[11px] text-purple-400 font-mono">
              <button type="button" onClick={handleSelectAllDays} className="hover:underline">
                全週
              </button>
              <span className="text-slate-600" aria-hidden="true">|</span>
              <button type="button" onClick={handleSelectWeekdays} className="hover:underline">
                平日
              </button>
              <span className="text-slate-600" aria-hidden="true">|</span>
              <button type="button" onClick={handleSelectWeekend} className="hover:underline">
                週末
              </button>
            </div>
          </div>
          <div role="group" aria-labelledby={`${uid}-days`} className="flex items-center gap-1.5 sm:gap-2">
            {DAYS.map((d) => {
              const selected = daysOfWeek.includes(d.val);
              return (
                <button
                  key={d.val}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`星期${d.label}`}
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
            <div>
              <span id={`${uid}-range`} className="block text-xs font-semibold text-slate-200 mb-2">
                時段設定模式
              </span>
              <TimeRangeFields
                uid={uid}
                isAllDay={isAllDay}
                setIsAllDay={setIsAllDay}
                startTime={startTime}
                setStartTime={setStartTime}
                endTime={endTime}
                setEndTime={setEndTime}
                defaults={{ start: '08:00', end: '22:00' }}
                labels={{ allDayFirst: true, first: '全天 24 小時輪播', second: '指定時段輪播 (幾點到幾點)' }}
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                <label htmlFor={`${uid}-weight`} className="text-xs font-semibold text-slate-200">
                  輪播權重 (Weight: {weight})
                </label>
                <span className="text-[11px] text-slate-400">數值愈大，播出比例愈高 (例如 3:1)</span>
              </div>
              <input
                id={`${uid}-weight`}
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
              <span id={`${uid}-minute-presets`} className="block text-xs font-semibold text-slate-200 mb-1.5">
                每小時播放時間點 (第幾分鐘)
              </span>
              <div role="group" aria-labelledby={`${uid}-minute-presets`} className="flex items-center gap-2 flex-wrap mb-2">
                {[
                  { label: '整點 (:00)', val: 0 },
                  { label: '每半點 (:30)', val: 30 },
                  { label: '每 15 分 (:15)', val: 15 },
                  { label: '每 45 分 (:45)', val: 45 }
                ].map((preset) => (
                  <button
                    key={preset.val}
                    type="button"
                    aria-pressed={Number(hourlyMinute) === preset.val}
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

              <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
                <label htmlFor={`${uid}-minute`} className="text-xs text-slate-400">
                  或指定每小時第
                </label>
                <input
                  id={`${uid}-minute`}
                  type="number"
                  min="0"
                  max="59"
                  value={hourlyMinute}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0));
                    setHourlyMinute(val);
                  }}
                  className="w-20 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-center text-white focus:outline-none focus:border-purple-500"
                />
                <span className="text-xs text-slate-400">分播出 (例如 30 表示 11:30, 12:30...)</span>
              </div>
            </div>

            {/* 2. 生效時段區間 (幾點到幾點) */}
            <div>
              <span id={`${uid}-range`} className="block text-xs font-semibold text-slate-200 mb-2">
                生效時段區間
              </span>
              <TimeRangeFields
                uid={uid}
                isAllDay={isAllDay}
                setIsAllDay={setIsAllDay}
                startTime={startTime}
                setStartTime={setStartTime}
                endTime={endTime}
                setEndTime={setEndTime}
                defaults={{ start: '11:00', end: '22:00' }}
                labels={{ allDayFirst: false, first: '指定時段 (幾點到幾點)', second: '全天 24 小時每小時' }}
              />
            </div>

            {/* 3. 插播切入方式 */}
            <div>
              <span id={`${uid}-interrupt`} className="block text-xs font-semibold text-slate-200 mb-1.5">
                插播切入方式
              </span>
              <InterruptModePicker value={interruptMode} onChange={setInterruptMode} labelId={`${uid}-interrupt`} />
            </div>
          </div>
        )}

        {scheduleType === 'interval' && (
          <div className="space-y-4 p-4 rounded-2xl bg-slate-950/40 border border-slate-800/60">
            <span className="block text-xs font-semibold text-slate-200">間隔插播頻率</span>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${uid}-every`} className="block text-[11px] text-slate-400 mb-1">
                  每經過 X 首歌
                </label>
                <input
                  id={`${uid}-every`}
                  type="number"
                  min="1"
                  max="50"
                  value={intervalEveryTracks}
                  onChange={(e) => setIntervalEveryTracks(e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-play`} className="block text-[11px] text-slate-400 mb-1">
                  插播 Y 首歌
                </label>
                <input
                  id={`${uid}-play`}
                  type="number"
                  min="1"
                  max="10"
                  value={intervalPlayTracks}
                  onChange={(e) => setIntervalPlayTracks(e.target.value)}
                  className={fieldClass}
                />
              </div>
            </div>
          </div>
        )}

        {scheduleType === 'fixed_time' && (
          <div className="space-y-4 p-4 rounded-2xl bg-slate-950/40 border border-slate-800/60">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${uid}-target-time`} className="block text-xs font-semibold text-slate-200 mb-1">
                  指定播出時間 (24 小時制，可到秒)
                </label>
                <input
                  id={`${uid}-target-time`}
                  type="time"
                  step="1"
                  value={targetTime}
                  onChange={(e) => setTargetTime(e.target.value)}
                  required
                  className={fieldClass}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-target-date`} className="block text-xs font-semibold text-slate-200 mb-1">
                  單次指定日期 (選填)
                </label>
                <input
                  id={`${uid}-target-date`}
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  aria-describedby={`${uid}-target-date-hint`}
                  className={fieldClass}
                />
                <p id={`${uid}-target-date-hint`} className="mt-1 text-[10px] text-slate-500">
                  留空則依上方的生效星期每週重複
                </p>
              </div>
            </div>

            <div>
              <span id={`${uid}-interrupt`} className="block text-xs font-semibold text-slate-200 mb-2">
                插播切入方式
              </span>
              <InterruptModePicker value={interruptMode} onChange={setInterruptMode} labelId={`${uid}-interrupt`} />
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
    </Modal>
  );
}
