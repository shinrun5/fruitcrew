import { DayOfWeek } from '@prisma/client';

/** The timezone the stores' wall-clock times and the cron schedule are read in. */
export const STORE_TZ = process.env.CRON_TZ || 'America/New_York';

// Every DateTime column that represents a wall-clock time (shift/requirement/
// availability start-end, etc.) is stored anchored to 1970-01-01 and read
// back in UTC — toHHMM/toClock are the shared read/write pair for that.

/** The DateTime columns hold a wall-clock time (e.g. 11:30); read the clock face in UTC. */
export function toHHMM(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** "HH:MM" -> the 1970-01-01 wall-clock DateTime the rest of the app stores (matches toHHMM). */
export function toClock(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

/** A valid zero-padded 24h "HH:MM". */
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Minutes since midnight of a wall-clock DateTime. */
export const minuteOfDay = (d: Date): number => d.getUTCHours() * 60 + d.getUTCMinutes();

/** Minutes since midnight of an "HH:MM" string. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Minutes since midnight -> "HH:MM" (the inverse of hhmmToMinutes). */
export const minutesToHHMM = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** "4:30 PM" from a wall-clock DateTime or minutes since midnight. */
export function to12h(t: Date | number): string {
  const min = typeof t === 'number' ? t : minuteOfDay(t);
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** A "YYYY-MM-DD" from the client as UTC midnight, or null if it isn't one. */
export function parseYMD(s: unknown): Date | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Today's date as UTC midnight. */
export function todayUTC(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

export const WEEK_DAYS: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
  DayOfWeek.SUNDAY,
];

export const isDayOfWeek = (v: unknown): v is DayOfWeek =>
  typeof v === 'string' && (WEEK_DAYS as string[]).includes(v);

/** Midnight-UTC date of `day` within the week starting at `weekStart`. */
export function dateOfDay(weekStart: Date, day: DayOfWeek): Date {
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() + WEEK_DAYS.indexOf(day));
  return d;
}
