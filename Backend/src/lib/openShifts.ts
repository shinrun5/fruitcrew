// Open shifts a manager has put out for the crew: unassigned Shift rows in a
// week the crew can see (see isTradableWeek) show up in everyone's Market,
// and whoever's at that store hears about them — in-app and phone always,
// email unless they've turned off marketplace emails.

import type { DayOfWeek } from '@prisma/client';
import prisma from './prisma.js';
import { notify } from './notify.js';
import { dateOfDay, hhmmToMinutes, minuteOfDay, to12h } from './time.js';

export interface OpenShift {
  day: DayOfWeek;
  /** "HH:MM", or a stored wall-clock time */
  start: string | Date;
  end: string | Date;
  sectionName?: string | null;
}

const minutes = (t: string | Date) => (typeof t === 'string' ? hhmmToMinutes(t) : minuteOfDay(t));

/** "Tue, Oct 27, 3:00 PM–9:00 PM (Front)" */
function label(weekStart: Date, s: OpenShift): string {
  const date = dateOfDay(weekStart, s.day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${date}, ${to12h(minutes(s.start))}–${to12h(minutes(s.end))}${s.sectionName ? ` (${s.sectionName})` : ''}`;
}

/** Tell this store's crew (bar `exceptEmployeeId` — whoever just gave it up)
 * that these shifts are up for grabs. */
export async function tellOpenShifts(
  storeId: number,
  weekStart: Date,
  shifts: OpenShift[],
  exceptEmployeeId: number | null = null,
): Promise<void> {
  if (shifts.length === 0) return;
  const [store, users] = await Promise.all([
    prisma.store.findUnique({ where: { id: storeId }, select: { name: true } }),
    prisma.user.findMany({
      where: {
        employee: { is: { employeeStores: { some: { storeId } } } },
        ...(exceptEmployeeId != null ? { employeeId: { not: exceptEmployeeId } } : {}),
      },
      select: { id: true, notifyOnMarketplacePost: true },
    }),
  ]);
  const sorted = [...shifts].sort((a, b) => dateOfDay(weekStart, a.day).getTime() - dateOfDay(weekStart, b.day).getTime() || minutes(a.start) - minutes(b.start));
  const where = store?.name ?? 'work';
  const title = sorted.length === 1 ? `Open shift at ${where}` : `${sorted.length} open shifts at ${where}`;
  const listed = sorted.slice(0, 3).map((s) => label(weekStart, s));
  if (sorted.length > 3) listed.push(`and ${sorted.length - 3} more`);
  const body = `${listed.join(' · ')} — ${sorted.length === 1 ? 'up for grabs. Open Market to pick it up.' : 'up for grabs. Open Market to pick one up.'}`;
  for (const u of users) {
    await notify(u.id, { kind: 'GENERIC', topic: 'openShifts', title, body, link: '/marketplace', email: u.notifyOnMarketplacePost });
  }
}
