// "Your shift starts at 4:00 PM" — a phone push about an hour before each
// shift. Run every few minutes from cron.ts; JobRun makes each one send once.
//
// Only shifts people can actually see count: a store's posted week, or this
// calendar week after next week got posted (then this week lives on as an
// archived ScheduleSnapshot — see retirePostedWeek). Never drafts. Back-to-back
// shifts are one stretch, reminded once at its start. Push only, no bell entry:
// a reminder a day in the bell list would just pile up. Switch-off-able per
// person (pushMuted 'reminders').

import type { DayOfWeek } from '@prisma/client';
import prisma from './prisma.js';
import { pushUnlessMuted } from './notify.js';

export const REMINDER_LEAD_MIN = 60;
const TZ = process.env.CRON_TZ || 'America/New_York';
const DOW: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const DAY_MS = 86_400_000;

const minOf = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();
const minHHMM = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const to12 = (min: number) => {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** The calendar date (as UTC midnight) and minute-of-day it is right now in the stores' timezone. */
function localNow(now: Date): { date: number; minute: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour) % 24;
  return { date: Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)), minute: hour * 60 + Number(parts.minute) };
}

interface Row { employeeId: number; storeId: number; start: number; end: number }

/** Everyone's shifts on one calendar date, from whatever workers see for it. */
async function shiftsOn(date: number): Promise<Row[]> {
  const dow = (new Date(date).getUTCDay() + 6) % 7; // Monday = 0
  const day = DOW[dow]!;
  const monday = new Date(date - dow * DAY_MS);
  const schedules = await prisma.schedule.findMany({
    where: { publishedAt: { not: null }, postedWeekStart: { gte: monday }, store: { org: { deletedAt: null, pausedAt: null } } },
    select: { storeId: true, postedWeekStart: true },
  });
  if (schedules.length === 0) return [];
  const storeIds = schedules.map((s) => s.storeId);
  const live = await prisma.shift.findMany({
    where: { storeId: { in: storeIds }, weekStart: monday, day, employeeId: { not: null } },
    select: { employeeId: true, storeId: true, start: true, end: true },
  });
  const rows: Row[] = live.map((s) => ({ employeeId: s.employeeId!, storeId: s.storeId, start: minOf(s.start), end: minOf(s.end) }));
  // a store whose week was archived when it posted the next one
  const haveLive = new Set(live.map((s) => s.storeId));
  for (const s of schedules) {
    if (haveLive.has(s.storeId) || s.postedWeekStart!.getTime() === monday.getTime()) continue;
    const snap = await prisma.scheduleSnapshot.findFirst({ where: { storeId: s.storeId, weekStart: monday }, orderBy: { savedAt: 'desc' } });
    for (const f of (snap?.shifts ?? []) as { employeeId: number | null; day: DayOfWeek; start: string; end: string }[]) {
      if (f.day === day && f.employeeId != null) rows.push({ employeeId: f.employeeId, storeId: s.storeId, start: minHHMM(f.start), end: minHHMM(f.end) });
    }
  }
  return rows;
}

/** Back-to-back shifts (same person, same store, one ending as the next starts) as one stretch. */
export function stretches(rows: Row[]): Row[] {
  const out: Row[] = [];
  const sorted = [...rows].sort((a, b) => a.employeeId - b.employeeId || a.storeId - b.storeId || a.start - b.start);
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.employeeId === r.employeeId && last.storeId === r.storeId && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Send every reminder that's due. `now` is injectable for testing. Returns how many went out. */
export async function sendShiftReminders(now = new Date()): Promise<number> {
  const { date, minute } = localNow(now);
  // shifts starting in (now, now + lead] — including just after midnight
  const windows = [{ date, from: minute, to: minute + REMINDER_LEAD_MIN }];
  if (minute + REMINDER_LEAD_MIN >= 1440) windows.push({ date: date + DAY_MS, from: -1, to: minute + REMINDER_LEAD_MIN - 1440 });

  let sent = 0;
  for (const w of windows) {
    const due = stretches(await shiftsOn(w.date)).filter((s) => s.start > w.from && s.start <= w.to);
    if (due.length === 0) continue;
    const [users, stores] = await Promise.all([
      prisma.user.findMany({ where: { employeeId: { in: due.map((d) => d.employeeId) }, approved: true }, select: { id: true, employeeId: true } }),
      prisma.store.findMany({ where: { id: { in: due.map((d) => d.storeId) } }, select: { id: true, name: true, parent: { select: { name: true } } } }),
    ]);
    const userOf = new Map(users.map((u) => [u.employeeId!, u.id]));
    const nameOf = new Map(stores.map((s) => [s.id, s.parent ? `${s.parent.name} · ${s.name}` : s.name]));
    for (const s of due) {
      const userId = userOf.get(s.employeeId);
      if (!userId) continue; // no login — nobody to tell
      const ymd = new Date(w.date).toISOString().slice(0, 10);
      try {
        await prisma.jobRun.create({ data: { job: 'shift-reminder', key: `${s.employeeId}:${s.storeId}:${ymd}:${s.start}` } });
      } catch {
        continue; // already reminded
      }
      pushUnlessMuted(userId, 'reminders', {
        title: `Your shift starts at ${to12(s.start)}`,
        body: `${nameOf.get(s.storeId) ?? 'Work'} · ${to12(s.start)}–${to12(s.end)}`,
        link: '/my-shifts',
      });
      sent++;
    }
  }
  // keep the de-dupe table small: nothing older than a couple of weeks matters
  await prisma.jobRun.deleteMany({ where: { job: 'shift-reminder', ranAt: { lt: new Date(now.getTime() - 14 * DAY_MS) } } });
  return sent;
}
