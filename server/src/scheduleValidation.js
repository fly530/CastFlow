/**
 * 排程規則的輸入驗證與正規化 (POST / PUT /api/schedules 共用)。
 *
 * 原本 body 直接寫進資料庫：間隔欄位清空會存成 0，規則就默默失效
 * (排程器只看 interval_every_tracks > 0)；時間格式錯了排程永遠不會到點，
 * 介面上卻看不出來。這裡把不合理的值擋在寫入之前，回傳看得懂的錯誤訊息。
 *
 * PUT 只帶部分欄位 (例如啟用／停用只送 is_active)：先與既有資料合併再驗證，
 * 但只回傳本次有帶的欄位，避免覆寫沒送的欄位。
 */

export const SCHEDULE_TYPES = ['continuous', 'interval', 'fixed_time', 'hourly'];
export const INTERRUPT_MODES = ['wait_track_end', 'immediate_fade'];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const toFlag = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
const blankToNull = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

function toInt(v) {
  if (v === undefined || v === null || v === '') return NaN;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

/**
 * @param input  request body
 * @param options.existing  既有排程 (PUT 時)；null 表示新增
 * @param options.playlistExists  (id) => boolean
 * @returns {{ error: string } | { data: object }}
 */
export function normalizeSchedule(input, { existing = null, playlistExists = () => true } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: '排程資料格式不正確' };
  }
  const isCreate = !existing;
  // 只切換啟用狀態 (列表上的開關)：不重新驗證整條規則，舊資料有瑕疵也能停用
  if (!isCreate && Object.keys(input).every((k) => k === 'is_active')) {
    return { data: 'is_active' in input ? { is_active: toFlag(input.is_active) } : {} };
  }
  const merged = { ...(existing || {}), ...input };
  const out = {};

  // 字串欄位
  const title = blankToNull(merged.title) ?? (isCreate ? '新排程' : null);
  if (!title) return { error: '排程名稱不可為空' };
  if (title.length > 100) return { error: '排程名稱最多 100 字' };
  out.title = title;

  const type = merged.schedule_type || 'continuous';
  if (!SCHEDULE_TYPES.includes(type)) return { error: `不支援的排程類型：${type}` };
  out.schedule_type = type;

  if (!merged.playlist_id || !playlistExists(merged.playlist_id)) {
    return { error: '請選擇存在的歌單' };
  }
  out.playlist_id = merged.playlist_id;

  const days = String(merged.days_of_week ?? '0,1,2,3,4,5,6')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
  if (days.length === 0 || days.some((d) => !/^[0-6]$/.test(d))) {
    return { error: '請至少選擇一個星期幾' };
  }
  out.days_of_week = [...new Set(days)].sort().join(',');

  const mode = merged.interrupt_mode || 'wait_track_end';
  if (!INTERRUPT_MODES.includes(mode)) return { error: `不支援的插播方式：${mode}` };
  out.interrupt_mode = mode;

  // 時段：只有 continuous / interval / hourly 會用到；全天時清空，避免殘留舊值
  out.is_all_day = merged.is_all_day === undefined ? 1 : toFlag(merged.is_all_day);
  const usesWindow = type !== 'fixed_time';
  if (usesWindow && !out.is_all_day) {
    const start = blankToNull(merged.start_time);
    const end = blankToNull(merged.end_time);
    if (!start || !end || !TIME_RE.test(start) || !TIME_RE.test(end)) {
      return { error: '請填寫正確的時段 (HH:MM)' };
    }
    out.start_time = start;
    out.end_time = end;
  } else {
    out.start_time = null;
    out.end_time = null;
  }

  // 到點時間
  if (type === 'fixed_time') {
    const t = blankToNull(merged.target_time);
    if (!t || !TIME_RE.test(t)) return { error: '請填寫正確的插播時間 (HH:MM)' };
    out.target_time = t.length === 5 ? `${t}:00` : t;
    const date = blankToNull(merged.target_date);
    if (date && !DATE_RE.test(date)) return { error: '指定日期格式需為 YYYY-MM-DD' };
    out.target_date = date;
  } else if (type === 'hourly') {
    const minute = toInt(String(merged.target_time ?? '0').replace(':', ''));
    if (!(minute >= 0 && minute <= 59)) return { error: '每小時插播的分鐘需為 0 ~ 59' };
    out.target_time = String(minute).padStart(2, '0');
    out.target_date = null;
  } else {
    out.target_time = null;
    out.target_date = null;
  }

  // 生效日期區間：建立時空白代表永久生效；更新時與既有值合併後驗證，
  // 並由下方 touched 集合只寫入請求實際帶來的日期欄位。
  const activeFrom = blankToNull(merged.active_from);
  const activeUntil = blankToNull(merged.active_until);
  for (const [value, label] of [[activeFrom, '生效起日'], [activeUntil, '生效迄日']]) {
    if (value && !DATE_RE.test(value)) return { error: `${label}格式需為 YYYY-MM-DD` };
    if (value) {
      const date = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        return { error: `${label}不是有效日期` };
      }
    }
  }
  if (activeFrom && activeUntil && activeFrom > activeUntil) {
    return { error: '生效迄日不得早於生效起日' };
  }
  out.active_from = activeFrom;
  out.active_until = activeUntil;

  // 數值欄位
  const weight = merged.weight === undefined || merged.weight === null ? 1 : toInt(merged.weight);
  if (!(weight >= 1 && weight <= 100)) return { error: '輪播權重需為 1 ~ 100 的整數' };
  out.weight = weight;

  const priority = merged.priority === undefined || merged.priority === null ? 0 : toInt(merged.priority);
  if (!(priority >= -100 && priority <= 100)) return { error: '優先順序需為 -100 ~ 100 的整數' };
  out.priority = priority;

  if (type === 'interval') {
    const every = toInt(merged.interval_every_tracks);
    if (!(every >= 1 && every <= 100)) return { error: '間隔插播的「每 X 首」需為 1 ~ 100 的整數' };
    const play = merged.interval_play_tracks === undefined ? 1 : toInt(merged.interval_play_tracks);
    if (!(play >= 1 && play <= 20)) return { error: '間隔插播的「插播 Y 首」需為 1 ~ 20 的整數' };
    out.interval_every_tracks = every;
    out.interval_play_tracks = play;
  } else {
    // 其他類型不使用；保留可解析的值，不讓前端預設值擋住儲存
    const every = toInt(merged.interval_every_tracks);
    const play = toInt(merged.interval_play_tracks);
    out.interval_every_tracks = every >= 0 ? every : 0;
    out.interval_play_tracks = play >= 1 ? play : 1;
  }

  out.is_active = merged.is_active === undefined ? 1 : toFlag(merged.is_active);

  if (isCreate) return { data: out };

  // PUT：只寫入本次有帶的欄位，加上因類型／全天切換而必須一起清掉的欄位
  const touched = new Set(Object.keys(input).filter((k) => k in out));
  if ('schedule_type' in input || 'is_all_day' in input) {
    ['start_time', 'end_time', 'target_time', 'target_date'].forEach((k) => touched.add(k));
  }
  return { data: Object.fromEntries([...touched].map((k) => [k, out[k]])) };
}
