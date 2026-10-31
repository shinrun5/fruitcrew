import { DayOfWeek, PayPeriodType } from '@prisma/client';
import prisma from './prisma.js';
import { mondayUTC } from './scheduleGen.js';
import { clockModes, entryDay, workedMinutes } from './timeClock.js';
import { dateOfDay, hhmmToMinutes, minuteOfDay, todayUTC } from './time.js';

export interface PayPeriodBounds {
  start: Date; // UTC midnight, inclusive
  end: Date; // UTC midnight, EXCLUSIVE — the first day of the next period
}

/** The pay period containing `reference` (defaults to the stores' today), per the org's
 * configured type/anchor. `anchor` must already be a Monday UTC midnight
 * (enforced where it's written — see routes/managers.ts). */
export function periodContaining(
  type: PayPeriodType,
  anchor: Date,
  // the stores' today, not the server's UTC date — or Sunday evening already reads as next week
  reference: Date = todayUTC(),
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

/** Each employee's total worked hours, across every store in `storeIds`,
 * falling within [period.start, period.end). Combines live Shift rows (for
 * whichever weeks are still resident) with the latest ScheduleSnapshot for
 * any week that's already been archived — see scheduleGen.ts's
 * retireWeek/retireDraftWeek/retirePostedWeek: a store normally only keeps
 * its current draft + posted week live in the Shift table; every other week
 * (which is most of a BIWEEKLY/MONTHLY period, and the entirety of any past
 * period) exists only as a ScheduleSnapshot JSON blob. Counts whatever's on
 * the board (draft or posted) for a resident week, same as Dashboard.tsx's
 * and overview.ts's existing hours figures — not restricted to published-only.
 * With `worked`, a store with a time clock counts its finished stretches on
 * the clock instead of its schedule (Payroll). */
export async function minutesByEmployeeForPeriod(
  allStoreIds: number[],
  period: PayPeriodBounds,
  /** when given, also filled with each person's minutes per week (Monday's time → minutes) */
  perWeek?: Map<number, Map<number, number>>,
  worked = false,
): Promise<Map<number, number>> {
  const totals = new Map<number, number>();
  if (allStoreIds.length === 0) return totals;

  const add = (employeeId: number | null, date: Date, minutes: number) => {
    if (employeeId == null || date < period.start || date >= period.end) return;
    totals.set(employeeId, (totals.get(employeeId) ?? 0) + minutes);
    if (perWeek) {
      const weeks = perWeek.get(employeeId) ?? new Map<number, number>();
      const wk = mondayUTC(date).getTime();
      weeks.set(wk, (weeks.get(wk) ?? 0) + minutes);
      perWeek.set(employeeId, weeks);
    }
  };

  let storeIds = allStoreIds;
  if (worked) {
    const modes = await clockModes(allStoreIds);
    const clocked = allStoreIds.filter((id) => (modes.get(id) ?? 'OFF') !== 'OFF');
    storeIds = allStoreIds.filter((id) => !clocked.includes(id));
    if (clocked.length > 0) {
      const entries = await prisma.timeEntry.findMany({
        where: { storeId: { in: clocked }, clockIn: { gte: period.start, lt: period.end }, clockOut: { not: null } },
        select: { employeeId: true, clockIn: true, clockOut: true, breakMinutes: true },
      });
      for (const e of entries) add(e.employeeId, entryDay(e.clockIn), workedMinutes(e));
    }
    if (storeIds.length === 0) return totals;
  }

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

  for (const s of liveShifts) {
    add(s.employeeId, dateOfDay(s.weekStart, s.day), minuteOfDay(s.end) - minuteOfDay(s.start));
  }
  for (const snap of snapshots) {
    if (!snap) continue;
    const rows = snap.shifts as unknown as { employeeId: number | null; day: DayOfWeek; start: string; end: string }[];
    for (const r of rows) add(r.employeeId, dateOfDay(snap.weekStart, r.day), hhmmToMinutes(r.end) - hhmmToMinutes(r.start));
  }
  // exact minutes — shown as "37h 30m", never rounded (see Frontend lib/time.ts durationLabel)
  return totals;
}

/** Hours past 40 in any one week (Mon–Sun) count as overtime — the US federal
 * rule. Only the days inside the period count, so a period that starts or ends
 * mid-week (monthly, custom dates) can show less than the full week's. */
export const OVERTIME_WEEK_MINUTES = 40 * 60;
export function overtimeMinutes(weeks: Map<number, number> | undefined): number {
  let over = 0;
  for (const m of weeks?.values() ?? []) over += Math.max(0, m - OVERTIME_WEEK_MINUTES);
  return over;
}

/** Legacy decimal hours (to 0.1h) — still sent next to minutes for older app builds. */
export function hoursFromMinutes(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}
