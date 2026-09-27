export const DAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const

type Day = (typeof DAYS)[number]

// current UI language — kept in sync by <I18nProvider>. Lets the day / month /
// "x ago" labels below follow the toggle without every call site passing it.
let _lang: 'en' | 'zh' | 'es' = 'en'
export function setTimeLang(l: 'en' | 'zh' | 'es') {
  _lang = l
}

const DAY_LABEL_EN: Record<Day, string> = {
  MONDAY: 'MON',
  TUESDAY: 'TUE',
  WEDNESDAY: 'WED',
  THURSDAY: 'THU',
  FRIDAY: 'FRI',
  SATURDAY: 'SAT',
  SUNDAY: 'SUN',
}
const DAY_LABEL_ZH: Record<Day, string> = {
  MONDAY: '周一',
  TUESDAY: '周二',
  WEDNESDAY: '周三',
  THURSDAY: '周四',
  FRIDAY: '周五',
  SATURDAY: '周六',
  SUNDAY: '周日',
}
const DAY_LABEL_ES: Record<Day, string> = {
  MONDAY: 'LUN',
  TUESDAY: 'MAR',
  WEDNESDAY: 'MIÉ',
  THURSDAY: 'JUE',
  FRIDAY: 'VIE',
  SATURDAY: 'SÁB',
  SUNDAY: 'DOM',
}

const DAY_LABEL_BY_LANG = { en: DAY_LABEL_EN, zh: DAY_LABEL_ZH, es: DAY_LABEL_ES }

/** Weekday label in the current UI language. Reads like a const map, e.g.
 * `DAY_LABEL[shift.day]`, but follows the EN | 中文 | Español toggle. */
export const DAY_LABEL: Record<Day, string> = new Proxy(DAY_LABEL_EN, {
  get: (_t, k: string) => DAY_LABEL_BY_LANG[_lang][k as Day] ?? k,
})

// DateTime columns hold a wall-clock time; read the clock face in UTC
// (matches Backend/src/routes/schedule.ts's toHHMM). Raw 24h "HH:MM" -- this is the
// format <input type="time"> and the split-time comparisons need; for display use hhmm().
export function toHHMM24(iso: string): string {
  const d = new Date(iso)
  const h = String(d.getUTCHours()).padStart(2, '0')
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

/** Raw 24h "HH:MM" -> "h:mm AM/PM" for display. */
export function to12Hour(hhmm24: string): string {
  const [h24 = 0, m = 0] = hhmm24.split(':').map(Number)
  const period = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

/** Raw 24h "HH:MM" -> compact "h:mma" / "h:mmp" (half the width of to12Hour). */
export function to12HourCompact(hhmm24: string): string {
  const [h24 = 0, m = 0] = hhmm24.split(':').map(Number)
  const period = h24 < 12 ? 'a' : 'p'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')}${period}`
}

/** "HH:MM" 24h <-> minutes-since-midnight. */
export function clockToMin(hhmm24: string): number {
  const [h = 0, m = 0] = hhmm24.split(':').map(Number)
  return h * 60 + m
}

export function minToClock(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

/** Display form of a shift's wall-clock time, e.g. "5:00 PM". */
export function hhmm(iso: string): string {
  return to12Hour(toHHMM24(iso))
}

export function toMinutes(iso: string): number {
  const d = new Date(iso)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

/** Same date, new wall-clock time (for splitting a shift at an arbitrary point). */
export function withTime(iso: string, hhmmValue: string): string {
  const d = new Date(iso)
  const [h, m] = hhmmValue.split(':').map(Number)
  d.setUTCHours(h, m, 0, 0)
  return d.toISOString()
}

export function windowsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd)
}

export function timeRange(startIso: string, endIso: string): string {
  return `${hhmm(startIso)}–${hhmm(endIso)}`
}

/** Compact form for tight columns, e.g. "11:30a–10:30p". */
export function timeRangeCompact(startIso: string, endIso: string): string {
  return `${to12HourCompact(toHHMM24(startIso))}–${to12HourCompact(toHHMM24(endIso))}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_ES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
]

/** The date of day `dayIndex` (0 = Mon) within the week starting at `weekStartIso`,
 * as "Sep 8" ("9月8日" in Chinese, "8 sep" in Spanish). */
export function dayDate(weekStartIso: string, dayIndex: number): string {
  const d = new Date(weekStartIso)
  d.setUTCDate(d.getUTCDate() + dayIndex)
  if (_lang === 'zh') return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
  if (_lang === 'es') return `${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]}`
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** "Sep 8 – Sep 14" for a week starting at `weekStartIso`. */
export function weekRangeLabel(weekStartIso: string): string {
  return `${dayDate(weekStartIso, 0)} – ${dayDate(weekStartIso, 6)}`
}

/** Whether a shift (given as its day-of-week + end wall-clock time, both
 * relative to the week starting at `weekStartIso`) has already ended. */
export function shiftHasEnded(weekStartIso: string, day: Day, endIso: string, now = new Date()): boolean {
  const d = new Date(weekStartIso)
  d.setUTCDate(d.getUTCDate() + DAYS.indexOf(day))
  const end = new Date(endIso)
  d.setUTCHours(end.getUTCHours(), end.getUTCMinutes(), 0, 0)
  return d.getTime() < now.getTime()
}

/** The Monday of the current week, as "YYYY-MM-DD" (UTC). */
export function thisMondayYMD(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** `weekStartIso` shifted by whole weeks, as "YYYY-MM-DD" (for PUT /schedule/week). */
export function shiftWeekYMD(weekStartIso: string, deltaWeeks: number): string {
  const d = new Date(weekStartIso)
  d.setUTCDate(d.getUTCDate() + deltaWeeks * 7)
  return d.toISOString().slice(0, 10)
}

/** For real timestamps (not the 1970 wall-clock values): "just now", "5m ago",
 * "3h ago", then a short date. */
export function relativeTime(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  const hr = Math.round(min / 60)
  if (_lang === 'zh') {
    if (min < 1) return '刚刚'
    if (min < 60) return `${min} 分钟前`
    if (hr < 24) return `${hr} 小时前`
    return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }
  if (_lang === 'es') {
    if (min < 1) return 'justo ahora'
    if (min < 60) return `hace ${min}m`
    if (hr < 24) return `hace ${hr}h`
    return new Date(iso).toLocaleDateString('es-ES', { month: 'short', day: 'numeric' })
  }
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  if (hr < 24) return `${hr}h ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
