import { DayOfWeek } from '@prisma/client';
import prisma from './prisma.js';
import { callSolver } from './solverClient.js';

/** The DateTime columns hold a wall-clock time (e.g. 11:30); read the clock face in UTC. */
export function toHHMM(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Midnight UTC of the Monday on or before `d`. */
export function mondayUTC(d = new Date()): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay();
  x.setUTCDate(x.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return x;
}

/** One store's shift rows with denormalised names — the frozen form for a snapshot. */
export async function freezeShifts(storeId: number) {
  const shifts = await prisma.shift.findMany({
    where: { storeId },
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

const WEEK_DAYS: DayOfWeek[] = [
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

  if (opts.snapshotLabel) {
    const existing = await freezeShifts(storeId);
    if (existing.length > 0) {
      const schedule = await prisma.schedule.findUnique({ where: { storeId } });
      await prisma.scheduleSnapshot.create({
        data: {
          storeId,
          weekStart: schedule?.weekStart ?? mondayUTC(),
          label: opts.snapshotLabel,
          shifts: existing,
        },
      });
    }
  }

  const scheduleRow = await prisma.schedule.findUnique({ where: { storeId } });
  const weekStart = scheduleRow?.weekStart ?? null;

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

  // A one-week override, if present, fully replaces an employee's standing availability.
  const empIdsInPlay = new Set(employees.map((e) => e.id));
  const availability = await prisma.recurringAvailability.findMany({
    where: { employeeId: { in: [...empIdsInPlay] } },
  });
  const overrides = weekStart
    ? await prisma.weekAvailability.findMany({
        where: { weekStart, employeeId: { in: [...empIdsInPlay] } },
      })
    : [];
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
  if (weekStart) {
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const vacations = await prisma.timeOffRequest.findMany({
      where: {
        cancelledAt: null,
        employeeId: { in: [...empIdsInPlay] },
        startDate: { lte: weekEnd },
        endDate: { gte: weekStart },
      },
    });
    const offDays = new Map<number, Set<DayOfWeek>>();
    for (const v of vacations) {
      const set = offDays.get(v.employeeId) ?? new Set<DayOfWeek>();
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
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
  if (weekStart) {
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const holidays = await prisma.storeHoliday.findMany({
      where: { storeId, closed: true, date: { gte: weekStart, lte: weekEnd } },
      select: { date: true },
    });
    for (const h of holidays) {
      const i = Math.round((h.date.getTime() - weekStart.getTime()) / 86_400_000);
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
  const otherShifts = await prisma.shift.findMany({
    where: { storeId: { not: storeId }, employeeId: { in: [...empIdsInPlay] } },
    select: { employeeId: true, day: true, start: true, end: true },
  });
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

  const payload = {
    solveSeconds,
    employees: employees.map((e) => ({
      id: e.id,
      name: e.name,
      hourLimit: e.hourLimit,
      maxShifts: e.maxShifts,
      // "schedule me at most one of these days" groups (e.g. Sat OR Sun)
      eitherOr: (e.eitherOrDays as DayOfWeek[][] | null) ?? [],
      // never two back-to-back days in a week
      noConsecutive: e.noConsecutiveDays,
      stores: e.employeeStores.map((es) => ({
        storeId: es.storeId,
        tier: es.proficiency,
        canOpen: es.canOpen || anyoneOpens,
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
      const covOpener = covering.some(
        (f) => anyoneOpens || f.employee.employeeStores[0]?.canOpen,
      );
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
    return { employeeId: a.employeeId, storeId: r.storeId, day: r.day, start: r.start, end: r.end };
  });
  // on a full regenerate the fixed shifts are re-materialised; on append (rare) they'd dupe
  const allRows = replace ? [...fixedRows, ...solvedRows] : solvedRows;
  const createOp = prisma.shift.createMany({ data: allRows });
  await (replace
    ? prisma.$transaction([
        prisma.shift.deleteMany({ where: { storeId } }),
        createOp,
        // a fresh draft is never live — employees only see it once a manager posts it
        prisma.schedule.updateMany({ where: { storeId }, data: { publishedAt: null } }),
      ])
    : prisma.$transaction([createOp]));

  return { ...base, created: allRows.length };
}
