import { DayOfWeek } from '@prisma/client';
import prisma from './prisma.js';
import { callSolver } from './solverClient.js';
import { toHHMM } from './time.js';

/** Regenerating the week workers are looking at right now — refused on purpose,
 * an expected situation rather than a failure (see generateScheduleForStore). */
export class PostedWeekError extends Error {
  constructor() {
    super("This week's schedule is already posted, so it can't be regenerated. Start next week to plan it.");
  }
}

/** Midnight UTC of the Monday on or before `d`. */
export function mondayUTC(d = new Date()): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay();
  x.setUTCDate(x.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return x;
}

/** One store's shift rows for a given week, with denormalised names — the
 * frozen form for a snapshot. */
export async function freezeShifts(storeId: number, weekStart: Date) {
  const shifts = await prisma.shift.findMany({
    where: { storeId, weekStart },
    include: { employee: true, store: true },
  });
  return shifts.map((s) => ({
    employeeId: s.employeeId,
    employeeName: s.employee?.name ?? null,
    storeId: s.storeId,
    storeName: s.store.name,
    day: s.day,
    start: toHHMM(s.start),
    end: toHHMM(s.end),
  }));
}

/** How many calendar weeks back a manager can still edit a past week (with a
 * confirm popup) via the normal board — see routes/schedule.ts's /status and
 * /snapshots/:id/restore. Anything older renders read-only from its
 * ScheduleSnapshot only, which is what makes retireStaleWeeks below safe. */
export const PAST_WEEK_EDITABLE_WEEKS = 4;

/** Midnight UTC of the Monday `PAST_WEEK_EDITABLE_WEEKS` weeks before `from`
 * — weeks strictly older than this are fully locked. */
export function editableCutoffUTC(from = mondayUTC()): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - PAST_WEEK_EDITABLE_WEEKS * 7);
  return d;
}

/** Archives one week's live Shift rows into a (non-'posted') ScheduleSnapshot,
 * then deletes them — but only if that week isn't the store's current posted
 * or draft week (so a caller can't accidentally destroy a week that's still
 * in active use just because it was, a moment ago, the "outgoing" one). Used
 * whenever a draft or the posted week moves on to a different week, and by
 * retireStaleWeeks below once a resumed-then-abandoned old week ages out. */
export async function retireWeek(storeId: number, outgoingWeek: Date, label: string | null = null): Promise<void> {
  const [schedule, existing] = await Promise.all([
    prisma.schedule.findUnique({ where: { storeId } }),
    freezeShifts(storeId, outgoingWeek),
  ]);
  if (existing.length === 0) return;
  const stillInUse =
    (schedule?.weekStart && schedule.weekStart.getTime() === outgoingWeek.getTime()) ||
    (schedule?.postedWeekStart && schedule.postedWeekStart.getTime() === outgoingWeek.getTime());
  if (stillInUse) return;

  await prisma.$transaction([
    prisma.scheduleSnapshot.create({
      data: { storeId, weekStart: outgoingWeek, label, shifts: existing },
    }),
    prisma.shift.deleteMany({ where: { storeId, weekStart: outgoingWeek } }),
  ]);
}

/** Archive+prune a draft week that's being abandoned (the manager or cron is
 * moving the edit-focus pointer to a different week). Guarded against ever
 * touching the currently posted week. */
export async function retireDraftWeek(storeId: number, outgoingDraftWeek: Date): Promise<void> {
  await retireWeek(storeId, outgoingDraftWeek, null);
}

/** Archive+prune a posted week that's just been superseded by a newly
 * published one. Guarded against touching a week that's simultaneously still
 * the current draft (e.g. republishing the same week). */
export async function retirePostedWeek(storeId: number, oldPostedWeek: Date, newPostedWeek: Date): Promise<void> {
  if (oldPostedWeek.getTime() === newPostedWeek.getTime()) return;
  await retireWeek(storeId, oldPostedWeek, null);
}

/** Sweeps every store for live Shift rows older than `cutoff` and retires
 * them (freeze-if-needed + delete) — normally a no-op, since a week's Shift
 * rows are retired the instant it stops being resident, but a manager can
 * resume an old week (see POST /schedule/snapshots/:id/restore) and then not
 * touch it again, leaving it resident-but-aging. retireWeek's own guard means
 * this never touches whichever week is still actually the draft or posted
 * one, however old that might be — only genuinely abandoned old weeks. */
export async function retireStaleWeeks(cutoff: Date): Promise<void> {
  const stale = await prisma.shift.findMany({
    where: { weekStart: { lt: cutoff } },
    select: { storeId: true, weekStart: true },
    distinct: ['storeId', 'weekStart'],
  });
  for (const { storeId, weekStart } of stale) {
    await retireWeek(storeId, weekStart, null);
  }
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

export interface GenResult {
  feasible: boolean;
  created: number;
  optimal: boolean;
  objective: number | null;
  unfilled: number;
  spread: number | null;
  shiftsPerEmployee: Record<string, number>;
  gaps: unknown[];
}

/**
 * Solve and write one store's schedule for whatever week its Schedule.weekStart
 * points at. Always a draft — never publishes. Honours one-week availability
 * overrides and time-off notices for that week.
 *
 * Throws for setup problems (no store / no requirements / solver unreachable);
 * returns `feasible: false` when the solver simply can't fill the week.
 */
export async function generateScheduleForStore(
  storeId: number,
  opts: { solveSeconds?: number; replace?: boolean; snapshotLabel?: string } = {},
): Promise<GenResult> {
  const solveSeconds = opts.solveSeconds ?? 5;
  const replace = opts.replace !== false;

  const scheduleRow = await prisma.schedule.findUnique({ where: { storeId } });
  const weekStart = scheduleRow?.weekStart ?? null;
  const targetWeek = weekStart ?? mondayUTC();

  // The draft being generated must never be the same week that's currently
  // posted — that would silently rewrite what employees are actively working
  // out from under them, bypassing every guard that otherwise protects the
  // posted week. This can only happen if the draft pointer gets moved back
  // onto the posted week (e.g. an over-advanced draft getting corrected by
  // the weekend cron) — refuse rather than let it corrupt what's live.
  if (
    replace &&
    scheduleRow?.postedWeekStart &&
    scheduleRow.postedWeekStart.getTime() === targetWeek.getTime()
  ) {
    throw new PostedWeekError();
  }

  if (opts.snapshotLabel) {
    const existing = await freezeShifts(storeId, targetWeek);
    if (existing.length > 0) {
      await prisma.scheduleSnapshot.create({
        data: { storeId, weekStart: targetWeek, label: opts.snapshotLabel, shifts: existing },
      });
    }
  }

  const [store, employees, requirements] = await Promise.all([
    prisma.store.findUnique({ where: { id: storeId } }),
    prisma.employee.findMany({
      where: { standby: false, employeeStores: { some: { storeId } } },
      include: { employeeStores: { where: { storeId } } },
    }),
    prisma.shiftRequirement.findMany({ where: { storeId } }),
  ]);

  if (!store) throw new Error('Store not found');
  if (requirements.length === 0) throw new Error('This store has no shift requirements yet');

  // who holds this store's built-in "Opener" responsibility (see
  // lib/responsibilities.ts) — replaces the old EmployeeStore.canOpen flag;
  // the solver payload's own "canOpen"/"needOpen" fields stay unchanged
  const openerIds = new Set(
    (
      await prisma.employeeResponsibility.findMany({
        where: { storeId, responsibility: { name: 'Opener' } },
        select: { employeeId: true },
      })
    ).map((r) => r.employeeId),
  );

  // A one-week override, if present, fully replaces an employee's standing availability.
  const empIdsInPlay = new Set(employees.map((e) => e.id));
  const availability = await prisma.recurringAvailability.findMany({
    where: { employeeId: { in: [...empIdsInPlay] } },
  });
  // everything week-specific below keys off targetWeek, not the stored
  // weekStart — a store's first-ever generate has no stored week yet, and
  // skipping these then would ignore one-week changes, time off and holidays
  const overrides = await prisma.weekAvailability.findMany({
    where: { weekStart: targetWeek, employeeId: { in: [...empIdsInPlay] } },
  });
  const overrideByEmp = new Map(
    overrides.map((o) => [
      o.employeeId,
      o.windows as unknown as { day: DayOfWeek; start: string; end: string }[],
    ]),
  );
  let effectiveAvailability: { employeeId: number; day: DayOfWeek; start: string; end: string }[] = [];
  for (const e of employees) {
    const ov = overrideByEmp.get(e.id);
    if (ov) {
      for (const w of ov) effectiveAvailability.push({ employeeId: e.id, day: w.day, start: w.start, end: w.end });
    } else {
      for (const a of availability) {
        if (a.employeeId === e.id) {
          effectiveAvailability.push({ employeeId: e.id, day: a.day, start: toHHMM(a.start), end: toHHMM(a.end) });
        }
      }
    }
  }

  // Time-off notices covering any day of this week -> drop that day for that employee.
  {
    const weekEnd = new Date(targetWeek);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const vacations = await prisma.timeOffRequest.findMany({
      where: {
        cancelledAt: null,
        employeeId: { in: [...empIdsInPlay] },
        startDate: { lte: weekEnd },
        endDate: { gte: targetWeek },
      },
    });
    const offDays = new Map<number, Set<DayOfWeek>>();
    for (const v of vacations) {
      const set = offDays.get(v.employeeId) ?? new Set<DayOfWeek>();
      for (let i = 0; i < 7; i++) {
        const d = new Date(targetWeek);
        d.setUTCDate(d.getUTCDate() + i);
        if (d >= v.startDate && d <= v.endDate) set.add(WEEK_DAYS[i]!);
      }
      offDays.set(v.employeeId, set);
    }
    effectiveAvailability = effectiveAvailability.filter((a) => !offDays.get(a.employeeId)?.has(a.day));
  }

  // Store holidays in this week where the store is marked closed -> no shifts that
  // day: drop the weekday's availability, requirements and fixed shifts.
  const closedHolidayDays = new Set<DayOfWeek>();
  {
    const weekEnd = new Date(targetWeek);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const holidays = await prisma.storeHoliday.findMany({
      where: { storeId, closed: true, date: { gte: targetWeek, lte: weekEnd } },
      select: { date: true },
    });
    for (const h of holidays) {
      const i = Math.round((h.date.getTime() - targetWeek.getTime()) / 86_400_000);
      if (i >= 0 && i < 7) closedHolidayDays.add(WEEK_DAYS[i]!);
    }
    if (closedHolidayDays.size) {
      effectiveAvailability = effectiveAvailability.filter((a) => !closedHolidayDays.has(a.day));
    }
  }

  // Cross-store, same day: if someone already has a shift at another store, carve
  // that time (plus a travel buffer) out of their availability here — so the
  // solver can still send them here for a non-overlapping window ("Mango till 4,
  // then Ciao for the night") but never double-books them.
  const TRAVEL_MIN = 0;
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  // same week only — another store can have both a posted week and a next-week
  // draft resident at once, and a Monday in a different week isn't a clash
  const otherShifts = await prisma.shift.findMany({
    where: { storeId: { not: storeId }, weekStart: targetWeek, employeeId: { in: [...empIdsInPlay] } },
    select: { employeeId: true, day: true, start: true, end: true },
  });
  // A weekly cap is per person, not per store: what someone's already working
  // elsewhere this week comes off what this store can give them.
  const elsewhereMin = new Map<number, number>();
  const elsewhereDays = new Map<number, Set<string>>();
  for (const s of otherShifts) {
    if (s.employeeId == null) continue;
    const mins = (s.end.getTime() - s.start.getTime()) / 60_000;
    elsewhereMin.set(s.employeeId, (elsewhereMin.get(s.employeeId) ?? 0) + mins);
    (elsewhereDays.get(s.employeeId) ?? elsewhereDays.set(s.employeeId, new Set()).get(s.employeeId)!).add(s.day);
  }
  if (otherShifts.length > 0) {
    const min = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();
    const pad = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
    const busy = new Map<string, [number, number][]>(); // `${empId}|${day}` -> intervals
    for (const s of otherShifts) {
      if (s.employeeId == null) continue;
      const k = `${s.employeeId}|${s.day}`;
      (busy.get(k) ?? busy.set(k, []).get(k)!).push([
        min(s.start) - TRAVEL_MIN,
        min(s.end) + TRAVEL_MIN,
      ]);
    }
    effectiveAvailability = effectiveAvailability.flatMap((a) => {
      const b = busy.get(`${a.employeeId}|${a.day}`);
      if (!b) return [a];
      let free: [number, number][] = [[toMin(a.start), toMin(a.end)]];
      for (const [bs, be] of b) {
        const next: [number, number][] = [];
        for (const [fs, fe] of free) {
          if (be <= fs || bs >= fe) next.push([fs, fe]);
          else {
            if (bs > fs) next.push([fs, bs]);
            if (be < fe) next.push([be, fe]);
          }
        }
        free = next;
      }
      return free
        .filter(([s, e]) => e - s >= 30)
        .map((w) => ({ employeeId: a.employeeId, day: a.day, start: pad(w[0]), end: pad(w[1]) }));
    });
  }

  const anyoneOpens = !store.requiresOpenerSkill;

  // --- fixed (standing) shifts: place them verbatim, solve only the remaining need ---
  const fixedShifts = await prisma.fixedShift.findMany({
    where: { storeId },
    include: { employee: { include: { employeeStores: { where: { storeId } } } } },
  });
  const fixedRows = fixedShifts
    .filter((f) => !closedHolidayDays.has(f.day))
    .map((f) => ({
      employeeId: f.employeeId,
      storeId,
      weekStart: targetWeek,
      day: f.day,
      start: f.start,
      end: f.end,
    }));
  const minOf = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();
  // A fixed schedule IS the schedule at this store: someone with any fixed shift
  // here works exactly those days, nothing more — even if they're available all
  // week. Drop them from the solver's pool entirely; only their fixed rows land.
  const fixedEmpIds = new Set(fixedShifts.map((f) => f.employeeId));
  effectiveAvailability = effectiveAvailability.filter((a) => !fixedEmpIds.has(a.employeeId));
  const usedUp = new Set(
    employees
      .filter(
        (e) =>
          e.hourLimit - (elsewhereMin.get(e.id) ?? 0) / 60 < 1 || e.maxShifts - (elsewhereDays.get(e.id)?.size ?? 0) < 1,
      )
      .map((e) => e.id),
  );
  effectiveAvailability = effectiveAvailability.filter((a) => !usedUp.has(a.employeeId));

  const payload = {
    solveSeconds,
    employees: employees.map((e) => ({
      id: e.id,
      name: e.name,
      // the solver reads 0/absent as "no cap", so someone who's used up their
      // week elsewhere is dropped from the pool above rather than sent a 0
      hourLimit: Math.floor(e.hourLimit - (elsewhereMin.get(e.id) ?? 0) / 60),
      maxShifts: e.maxShifts - (elsewhereDays.get(e.id)?.size ?? 0),
      // "schedule me at most one of these days" groups (e.g. Sat OR Sun)
      eitherOr: (e.eitherOrDays as DayOfWeek[][] | null) ?? [],
      // never two back-to-back days in a week
      noConsecutive: e.noConsecutiveDays,
      // never a partial/split day at a store — every requirement window it has
      // that day, or none of them (see Solver/engine.py's reqs_by_store_day)
      fullDayOnly: e.fullDayOnly,
      stores: e.employeeStores.map((es) => ({
        storeId: es.storeId,
        tier: es.proficiency,
        canOpen: openerIds.has(es.employeeId) || anyoneOpens,
        primary: es.primary,
      })),
    })),
    availability: effectiveAvailability,
    requirements: requirements
      .filter((r) => !closedHolidayDays.has(r.day))
      .map((r) => {
      // fixed shifts that fully cover this window pre-fill its headcount
      const covering = fixedShifts.filter(
        (f) => f.day === r.day && minOf(f.start) <= minOf(r.start) && minOf(f.end) >= minOf(r.end),
      );
      const covSenior = covering.filter((f) => {
        const t = f.employee.employeeStores[0]?.proficiency;
        return t === 'SENIOR' || t === 'MANAGER';
      }).length;
      const covOpener = covering.some((f) => anyoneOpens || openerIds.has(f.employeeId));
      return {
        id: r.id,
        storeId: r.storeId,
        day: r.day,
        start: toHHMM(r.start),
        end: toHHMM(r.end),
        head: Math.max(0, r.managerRequired + r.seniorRequired + r.regularRequired + r.newRequired - covering.length),
        seniorMin: Math.max(0, r.managerRequired + r.seniorRequired - covSenior),
        needOpen: r.needOpen && !covOpener,
        graceMinutes: r.graceMinutes,
        allowNew: r.newRequired > 0,
        pairNew: store.pairNewWorkers,
      };
    }),
  };

  const result = await callSolver(payload);
  const base: GenResult = {
    feasible: result.feasible,
    created: 0,
    optimal: result.optimal,
    objective: result.objective,
    unfilled: result.stats.unfilled ?? 0,
    spread: result.stats.spread ?? null,
    shiftsPerEmployee: result.stats.shiftsPerEmployee ?? {},
    gaps: result.gaps,
  };
  if (!result.feasible) return base;

  const reqById = new Map(requirements.map((r) => [r.id, r]));
  const solvedRows = result.assignments.map((a) => {
    const r = reqById.get(a.requirementId)!;
    return { employeeId: a.employeeId, storeId: r.storeId, weekStart: targetWeek, day: r.day, start: r.start, end: r.end };
  });
  // on a full regenerate the fixed shifts are re-materialised; on append (rare) they'd dupe
  const allRows = replace ? [...fixedRows, ...solvedRows] : solvedRows;
  const createOp = prisma.shift.createMany({ data: allRows });
  // Persist the resolved target week onto Schedule.weekStart — it was only
  // ever a local fallback (mondayUTC()) before this if the store had never
  // had an explicit PUT /schedule/week, so every reader of Schedule.weekStart
  // (including this same function, next call) needs it actually written.
  const persistWeekOp = prisma.schedule.upsert({
    where: { storeId },
    create: { storeId, weekStart: targetWeek },
    update: { weekStart: targetWeek },
  });
  await (replace
    ? prisma.$transaction([
        // scoped to this one week only — the posted week's own rows (a
        // different weekStart) are never touched by regenerating a draft
        prisma.shift.deleteMany({ where: { storeId, weekStart: targetWeek } }),
        createOp,
        persistWeekOp,
      ])
    : prisma.$transaction([createOp, persistWeekOp]));

  return { ...base, created: allRows.length };
}
