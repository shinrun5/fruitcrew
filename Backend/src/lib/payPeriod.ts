import { DayOfWeek, PayPeriodType } from '@prisma/client';
import prisma from './prisma.js';
import { mondayUTC, WEEK_DAYS } from './scheduleGen.js';

export interface PayPeriodBounds {
  start: Date; // UTC midnight, inclusive
  end: Date; // UTC midnight, EXCLUSIVE — the first day of the next period
}

/** The pay period containing `reference` (defaults to now), per the org's
 * configured type/anchor. `anchor` must already be a Monday UTC midnight
 * (enforced where it's written — see routes/managers.ts). */
export function periodContaining(
  type: PayPeriodType,
  anchor: Date,
  reference: Date = new Date(),
): PayPeriodBounds {
  if (type === 'MONTHLY') {
    const start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
    const end = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1));
    return { start, end };
  }
  if (type === 'WEEKLY') {
    const start = mondayUTC(reference);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return { start, end };
  }
  // BIWEEKLY: which 14-day bucket (relative to anchor) reference's Monday falls in.
  const refMonday = mondayUTC(reference);
  const daysSinceAnchor = Math.round((refMonday.getTime() - anchor.getTime()) / 86_400_000);
  const periodIndex = Math.floor(daysSinceAnchor / 14);
  const start = new Date(anchor);
  start.setUTCDate(start.getUTCDate() + periodIndex * 14);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 14);
  return { start, end };
}

const minOfDate = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();
const minOfHHMM = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const dateFor = (weekStart: Date, day: DayOfWeek) => {
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() + WEEK_DAYS.indexOf(day));
  return d;
};

/** Each employee's total worked hours, across every store in `storeIds`,
 * falling within [period.start, period.end). Combines live Shift rows (for
 * whichever weeks are still resident) with the latest ScheduleSnapshot for
 * any week that's already been archived — see scheduleGen.ts's
 * retireWeek/retireDraftWeek/retirePostedWeek: a store normally only keeps
 * its current draft + posted week live in the Shift table; every other week
 * (which is most of a BIWEEKLY/MONTHLY period, and the entirety of any past
 * period) exists only as a ScheduleSnapshot JSON blob. Counts whatever's on
 * the board (draft or posted) for a resident week, same as Dashboard.tsx's
 * and overview.ts's existing hours figures — not restricted to published-only. */
export async function hoursByEmployeeForPeriod(
  storeIds: number[],
  period: PayPeriodBounds,
): Promise<Map<number, number>> {
  const totals = new Map<number, number>();
  if (storeIds.length === 0) return totals;

  const weeks: Date[] = [];
  for (const w = mondayUTC(period.start); w < period.end; w.setUTCDate(w.getUTCDate() + 7)) {
    weeks.push(new Date(w));
  }
  if (weeks.length === 0) return totals;

  const liveShifts = await prisma.shift.findMany({
    where: { storeId: { in: storeIds }, weekStart: { in: weeks } },
    select: { employeeId: true, storeId: true, weekStart: true, day: true, start: true, end: true },
  });
  const covered = new Set(liveShifts.map((s) => `${s.storeId}|${s.weekStart.getTime()}`));

  const missing: { storeId: number; weekStart: Date }[] = [];
  for (const storeId of storeIds) {
    for (const weekStart of weeks) {
      if (!covered.has(`${storeId}|${weekStart.getTime()}`)) missing.push({ storeId, weekStart });
    }
  }
  // ScheduleSnapshot has no natural "latest per (storeId, weekStart) group"
  // batch query, so these stay one findFirst each — a payroll period only
  // ever spans a handful of store×week pairs, so this is not a hot path.
  const snapshots = await Promise.all(
    missing.map(({ storeId, weekStart }) =>
      prisma.scheduleSnapshot.findFirst({ where: { storeId, weekStart }, orderBy: { savedAt: 'desc' } }),
    ),
  );

  const add = (employeeId: number | null, date: Date, startMin: number, endMin: number) => {
    if (employeeId == null || date < period.start || date >= period.end) return;
    totals.set(employeeId, (totals.get(employeeId) ?? 0) + (endMin - startMin) / 60);
  };

  for (const s of liveShifts) {
    add(s.employeeId, dateFor(s.weekStart, s.day), minOfDate(s.start), minOfDate(s.end));
  }
  for (const snap of snapshots) {
    if (!snap) continue;
    const rows = snap.shifts as unknown as { employeeId: number | null; day: DayOfWeek; start: string; end: string }[];
    for (const r of rows) add(r.employeeId, dateFor(snap.weekStart, r.day), minOfHHMM(r.start), minOfHHMM(r.end));
  }
  for (const [id, h] of totals) totals.set(id, Math.round(h * 10) / 10); // same rounding as Dashboard.tsx's weekLoad
  return totals;
}
