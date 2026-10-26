// "Your Sunday, Oct 25 shift is now 12:00 PM–6:00 PM" — told to whoever a
// manager's hand edit touches in a week the crew already has and that's still
// running (see isRunningWeek): there's no repost for those, the edit is live
// at once. One board action is often several calls (shorten one row, delete
// the next), so each person/day waits for the edits to settle and is told the
// end result once — and nothing at all if it ended up the way it started.
// Kept in memory: a restart mid-wait just drops that one notice.

import type { DayOfWeek } from '@prisma/client';
import prisma from './prisma.js';
import { inBackground, notify, userIdsForEmployees } from './notify.js';
import { sectionLabel } from './responsibilities.js';
import { dateOfDay, minuteOfDay, to12h } from './time.js';

const SETTLE_MS = Number(process.env.SHIFT_NOTICE_SETTLE_MS ?? 20_000);

/** person/day → how their day looked before the first edit */
const before = new Map<string, Promise<string>>();
const timers = new Map<string, NodeJS.Timeout>();

/** "10:00 AM–6:00 PM (Front)", back-to-back rows as one; "" when they're off. */
async function describe(employeeId: number, storeId: number, weekStart: Date, day: DayOfWeek): Promise<string> {
  const rows = await prisma.shift.findMany({
    where: { employeeId, storeId, weekStart, day },
    orderBy: { start: 'asc' },
    select: { start: true, end: true, section: { select: { name: true, scope: true, archivedAt: true } } },
  });
  const spans: { start: number; end: number; section: string | null }[] = [];
  for (const r of rows) {
    const s = minuteOfDay(r.start);
    const section = sectionLabel(r.section);
    const last = spans[spans.length - 1];
    if (last && s <= last.end && last.section === section) last.end = Math.max(last.end, minuteOfDay(r.end));
    else spans.push({ start: s, end: minuteOfDay(r.end), section });
  }
  return spans.map((x) => `${to12h(x.start)}–${to12h(x.end)}${x.section ? ` (${x.section})` : ''}`).join(', ');
}

async function tell(employeeId: number, storeId: number, weekStart: Date, day: DayOfWeek, was: string): Promise<void> {
  const now = await describe(employeeId, storeId, weekStart, day);
  if (now === was) return;
  const [userIds, store] = await Promise.all([
    userIdsForEmployees([employeeId]),
    prisma.store.findUnique({ where: { id: storeId }, select: { name: true } }),
  ]);
  const date = dateOfDay(weekStart, day).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const body = !now
    ? `You're no longer working ${date}.`
    : !was
      ? `You're now working ${date}: ${now}.`
      : `Your ${date} shift is now ${now}.`;
  for (const userId of userIds) {
    await notify(userId, { kind: 'GENERIC', topic: 'schedule', title: `Schedule change at ${store?.name ?? 'work'}`, body, link: '/my-shifts' });
  }
}

/** Call just before changing someone's shift(s) on `day`: notes how their day
 * looked (first edit only) and restarts the wait before telling them. */
export async function shiftChanging(storeId: number, weekStart: Date, day: DayOfWeek, employeeId: number | null): Promise<void> {
  if (employeeId == null) return;
  const key = `${employeeId}|${storeId}|${weekStart.getTime()}|${day}`;
  if (!before.has(key)) before.set(key, describe(employeeId, storeId, weekStart, day));
  const was = await before.get(key)!;
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      before.delete(key);
      inBackground('shiftChanged', tell(employeeId, storeId, weekStart, day, was));
    }, SETTLE_MS),
  );
}
