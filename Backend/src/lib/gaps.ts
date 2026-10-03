import type { DayOfWeek, Shift, ShiftRequirement } from '@prisma/client';

// Server-side twin of Frontend/src/lib/gaps.ts — the schedule board's "N short"
// chip is the sum of these same shortBy values, so Home/Overview and the board
// always agree. Keep the two in step if either changes.

const minOf = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

export interface StaffLink {
  employeeId: number;
  proficiency: string;
  canOpen: boolean;
}

/** Uncovered stretches of one store/day, each sized by its worst point;
 * overlapping requirements add up. */
function headGaps(reqs: ShiftRequirement[], dayShifts: Shift[]): { from: number; to: number; shortBy: number }[] {
  const bounds = reqs.map((r) => ({
    r0: minOf(r.start),
    r1: minOf(r.end),
    head: r.managerRequired + r.seniorRequired + r.regularRequired + r.newRequired,
    grace: r.graceMinutes,
  }));
  const ticks = new Set<number>();
  for (const b of bounds) {
    ticks.add(b.r0);
    ticks.add(b.r1);
  }
  for (const s of dayShifts) {
    ticks.add(minOf(s.start));
    ticks.add(minOf(s.end));
  }
  const sorted = [...ticks].sort((a, b) => a - b);

  const gaps: { from: number; to: number; shortBy: number }[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i]!;
    const t1 = sorted[i + 1]!;
    const covering = bounds.filter((b) => b.r0 <= t0 && b.r1 >= t1);
    const required = covering.reduce((n, b) => n + b.head, 0);
    if (required === 0) continue;

    const present = new Set<number>();
    for (const s of dayShifts) {
      const sStart = minOf(s.start);
      if (minOf(s.end) < t1) continue;
      const graced = covering.some((b) => sStart > b.r0 && sStart <= b.r0 + b.grace);
      if ((graced ? Math.min(sStart, t0) : sStart) <= t0) present.add(s.employeeId as number);
    }
    if (present.size >= required) continue;
    const shortBy = required - present.size;
    // a stretch continuing from the previous slice is one gap, sized by its worst point
    const last = gaps[gaps.length - 1];
    if (last && last.to === t0) {
      last.shortBy = Math.max(last.shortBy, shortBy);
      last.to = t1;
    } else {
      gaps.push({ from: t0, to: t1, shortBy });
    }
  }
  return gaps;
}

/** Missing seniors / opener for one requirement — "at least one such person".
 * Not on top of a headcount gap in the same window (whoever fills it can be
 * the senior/opener), and one senior who can open covers both — matches the
 * board's cards, see computeGapCards in the frontend twin. */
function qualitativeShort(
  req: ShiftRequirement,
  dayShifts: Shift[],
  links: StaffLink[],
  requiresOpenerSkill: boolean,
  heads: { from: number; to: number; shortBy: number }[],
): number {
  const seniorMin = req.managerRequired + req.seniorRequired;
  if (seniorMin === 0 && !req.needOpen) return 0;
  const r0 = minOf(req.start);
  const r1 = minOf(req.end);
  const people = [
    ...new Set(dayShifts.filter((s) => minOf(s.start) < r1 && minOf(s.end) > r0).map((s) => s.employeeId as number)),
  ];
  const linkOf = (id: number) => links.find((l) => l.employeeId === id);
  const seniors = people.filter((id) => ['SENIOR', 'MANAGER'].includes(linkOf(id)?.proficiency ?? '')).length;
  const seniorShort = seniorMin > 0 ? Math.max(0, seniorMin - seniors) : 0;
  const canOpen = (id: number) => !requiresOpenerSkill || !!linkOf(id)?.canOpen;
  const openerShort = req.needOpen && !people.some(canOpen) ? 1 : 0;
  const headInWindow = Math.max(0, ...heads.filter((h) => h.from < r1 && h.to > r0).map((h) => h.shortBy));
  return Math.max(0, Math.max(seniorShort, openerShort) - headInWindow);
}

/** Total people-short across one store's week — the board's "N short" number.
 * `skipDays` leaves out days that have already passed: nobody can staff those. */
export function storeShortBy(
  requirements: ShiftRequirement[],
  weekShifts: Shift[],
  links: StaffLink[],
  requiresOpenerSkill: boolean,
  skipDays: ReadonlySet<DayOfWeek> = new Set(),
): number {
  const assigned = weekShifts.filter((s) => s.employeeId !== null);
  const byDay = new Map<DayOfWeek, ShiftRequirement[]>();
  for (const r of requirements) if (!skipDays.has(r.day)) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);

  let total = 0;
  for (const [day, reqs] of byDay) {
    const dayShifts = assigned.filter((s) => s.day === day);
    const heads = headGaps(reqs, dayShifts);
    total += heads.reduce((n, h) => n + h.shortBy, 0);
    for (const r of reqs) total += qualitativeShort(r, dayShifts, links, requiresOpenerSkill, heads);
  }
  return total;
}
