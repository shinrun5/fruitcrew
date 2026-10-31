import type { DayOfWeek } from '@prisma/client';
import prisma from './prisma.js';
import { sectionLabel } from './responsibilities.js';
import { isRunningWeek, isTradableWeek } from './scheduleGen.js';
import { inBackground } from './notify.js';
import { tellOpenShifts } from './openShifts.js';
import { shiftChanging } from './shiftNotice.js';

// What every hand edit to a shift does besides the edit itself — shared by the
// board's own edits (routes/shifts.ts) and the schedule assistant's.

export const weekPointers = (storeId: number) =>
  prisma.schedule.findUnique({ where: { storeId }, select: { weekStart: true, postedWeekStart: true, publishedAt: true } });

/** Call before a hand edit (not a solver regenerate, not an approved swap —
 * those tell people themselves). In a running week the crew can see (see
 * isRunningWeek) the edit is live at once, so whoever it touches is told. */
export async function noticeHandEdit(storeId: number, weekStart: Date, touched: { day: DayOfWeek; employeeId: number | null }[]) {
  const sched = await weekPointers(storeId);
  if (!isRunningWeek(sched, weekStart) || !isTradableWeek(sched, weekStart)) return;
  for (const t of touched) await shiftChanging(storeId, weekStart, t.day, t.employeeId);
}

/** A hand edit to the posted week while it's the one on the board shouldn't
 * reach workers until the manager reposts. A next-week draft never affects
 * what's posted, and a running week has nothing to repost — it's live as is. */
export async function markUnposted(storeId: number, shiftWeekStart: Date): Promise<void> {
  const schedule = await weekPointers(storeId);
  if (!schedule?.postedWeekStart || schedule.postedWeekStart.getTime() !== shiftWeekStart.getTime()) return;
  if (isRunningWeek(schedule, shiftWeekStart)) return;
  await prisma.schedule.updateMany({
    where: { storeId, publishedAt: { not: null } },
    data: { publishedAt: null },
  });
}

/** A shift just left open (nobody on it) in a week the crew can see: tell the
 * store it's up for grabs. One held back for a repost waits — posting
 * announces it then. */
export async function announceIfOpen(
  shift: { storeId: number; weekStart: Date; day: DayOfWeek; start: Date; end: Date; employeeId: number | null; sectionId: number | null },
  exceptEmployeeId: number | null = null,
): Promise<void> {
  if (shift.employeeId != null || !isTradableWeek(await weekPointers(shift.storeId), shift.weekStart)) return;
  const section =
    shift.sectionId != null
      ? await prisma.responsibility.findUnique({ where: { id: shift.sectionId }, select: { name: true, scope: true, archivedAt: true } })
      : null;
  inBackground('openShift', tellOpenShifts(shift.storeId, shift.weekStart, [{ ...shift, sectionName: sectionLabel(section) }], exceptEmployeeId));
}
