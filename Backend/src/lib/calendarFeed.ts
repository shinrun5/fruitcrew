import type { DayOfWeek } from '@prisma/client';
import prisma from './prisma.js';
import { mondayUTC, WEEK_DAYS } from './scheduleGen.js';
import { toHHMM } from './time.js';

// A person's shifts as an iCalendar (.ics) feed — what Apple, Google and
// Outlook Calendar subscribe to, so shifts show up next to everything else and
// stay current as schedules are posted or changed. Same rule as My Shifts:
// only what's been posted ever shows (never a draft), plus the rest of this
// week once next week is up, and a few weeks back so recent shifts don't
// vanish from someone's calendar.

const WEEKS_BACK = 4;
const APP_URL = process.env.APP_URL ?? 'https://fruitcrew.app';

export type FeedLang = 'en' | 'zh' | 'es';
const WORDS: Record<FeedLang, { calName: string; shiftAt: (store: string) => string; with: string; open: string }> = {
  en: { calName: 'FruitCrew shifts', shiftAt: (s) => `Shift at ${s}`, with: 'Working with', open: 'Open in FruitCrew' },
  zh: { calName: 'FruitCrew 班次', shiftAt: (s) => `在 ${s} 上班`, with: '同班', open: '在 FruitCrew 中打开' },
  es: { calName: 'Turnos de FruitCrew', shiftAt: (s) => `Turno en ${s}`, with: 'Con', open: 'Abrir en FruitCrew' },
};

interface Row {
  employeeId: number | null;
  name: string | null;
  day: DayOfWeek;
  start: number; // minutes after midnight, store wall-clock
  end: number;
}
const minOfHHMM = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};
const minOfClock = (d: Date) => minOfHHMM(toHHMM(d));

/** One week of one store's schedule as people saw it: the live rows, or the
 * newest saved copy once that week has been archived. */
async function weekRows(storeId: number, weekStart: Date, preferLive: boolean): Promise<Row[]> {
  if (preferLive) {
    const live = await prisma.shift.findMany({
      where: { storeId, weekStart },
      select: { employeeId: true, day: true, start: true, end: true, employee: { select: { name: true } } },
    });
    if (live.length) {
      return live.map((r) => ({ employeeId: r.employeeId, name: r.employee?.name ?? null, day: r.day, start: minOfClock(r.start), end: minOfClock(r.end) }));
    }
  }
  const snap = await prisma.scheduleSnapshot.findFirst({ where: { storeId, weekStart }, orderBy: { savedAt: 'desc' } });
  const frozen = (snap?.shifts ?? []) as { employeeId: number | null; employeeName: string | null; day: DayOfWeek; start: string; end: string }[];
  return frozen.map((f) => ({ employeeId: f.employeeId, name: f.employeeName, day: f.day, start: minOfHHMM(f.start), end: minOfHHMM(f.end) }));
}

// --- iCalendar text helpers (RFC 5545)
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
/** Lines longer than 75 bytes are folded onto continuation lines starting with a space. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 74) {
      out.push(cur);
      cur = ' ' + ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}
const pad = (n: number) => String(n).padStart(2, '0');
/** A floating local time (no zone) — the store's wall clock, shown as-is. */
function localStamp(date: Date, minutes: number): string {
  const d = new Date(date.getTime() + Math.floor(minutes / 1440) * 86_400_000);
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(Math.floor(m / 60))}${pad(m % 60)}00`;
}
const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** The .ics text for one login's calendar link. */
export async function buildCalendarFeed(userId: number, lang: FeedLang): Promise<string> {
  const w = WORDS[lang];
  const now = new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vortyx LLC//FruitCrew//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(w.calName)}`,
    // ask calendar apps to check back often (Google decides on its own)
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      employeeId: true,
      org: { select: { pausedAt: true, deletedAt: true } },
      employee: {
        select: {
          employeeStores: {
            select: { store: { select: { id: true, name: true, parent: { select: { name: true } }, schedule: true, org: { select: { pausedAt: true, deletedAt: true } } } } },
          },
        },
      },
    },
  });

  const employeeId = user?.employeeId;
  const thisMonday = mondayUTC();
  for (const { store } of user?.employee?.employeeStores ?? []) {
    const sched = store.schedule;
    // nothing ever posted, or a paused/deleted business: no shifts to show
    if (!sched?.postedWeekStart || store.org.pausedAt || store.org.deletedAt || employeeId == null) continue;
    const storeName = store.parent ? `${store.parent.name} · ${store.name}` : store.name;
    const draftOnly = sched.weekStart && sched.weekStart.getTime() !== sched.postedWeekStart.getTime() ? sched.weekStart.getTime() : null;

    for (let t = thisMonday.getTime() - WEEKS_BACK * 7 * 86_400_000; t <= sched.postedWeekStart.getTime(); t += 7 * 86_400_000) {
      const weekStart = new Date(t);
      const posted = t === sched.postedWeekStart.getTime();
      // a week that's only a draft right now: show the last posted copy, never the draft itself
      const rows = await weekRows(store.id, weekStart, posted || t !== draftOnly);
      for (const r of rows.filter((x) => x.employeeId === employeeId)) {
        const date = new Date(t + WEEK_DAYS.indexOf(r.day) * 86_400_000);
        const end = r.end <= r.start ? r.end + 1440 : r.end; // past midnight
        const coworkers = rows
          .filter((o) => o.employeeId != null && o.employeeId !== employeeId && o.day === r.day && o.start < end && r.start < (o.end <= o.start ? o.end + 1440 : o.end))
          .map((o) => o.name)
          .filter((n): n is string => !!n);
        const description = [coworkers.length ? `${w.with}: ${coworkers.join(', ')}` : null, `${w.open}: ${APP_URL}/my-shifts`]
          .filter(Boolean)
          .join('\n');
        lines.push(
          'BEGIN:VEVENT',
          // stable across re-generations of the same shift, so calendars update instead of duplicating
          `UID:fc-${store.id}-${localStamp(date, r.start)}-${employeeId}@fruitcrew.app`,
          `DTSTAMP:${utcStamp(now)}`,
          `DTSTART:${localStamp(date, r.start)}`,
          `DTEND:${localStamp(date, end)}`,
          `SUMMARY:${esc(w.shiftAt(storeName))}`,
          `LOCATION:${esc(storeName)}`,
          `DESCRIPTION:${esc(description)}`,
          'TRANSP:OPAQUE',
          'END:VEVENT',
        );
      }
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
