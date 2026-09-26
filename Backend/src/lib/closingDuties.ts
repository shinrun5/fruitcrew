import type { DayOfWeek } from '@prisma/client';
import prisma from './prisma.js';

export interface CrewMember {
  employeeId: number;
  name: string;
  tier: 'NEW' | 'REGULAR' | 'SENIOR' | 'MANAGER';
  /** trusted to hold the "Closing" role — a manager-set flag (EmployeeStore.canClose),
   * not derived from tier: not every senior closes, and not everyone who can close is senior */
  canClose: boolean;
  avatarFruit: string | null;
}

export interface DutyAssignment {
  closingEmployeeId: number | null;
  bathroomEmployeeIds: number[];
  sweepEmployeeId: number | null;
  mopEmployeeId: number | null;
}

const TIER_RANK: Record<CrewMember['tier'], number> = { NEW: 0, REGULAR: 1, SENIOR: 2, MANAGER: 3 };
const byRank = (a: CrewMember, b: CrewMember) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || a.name.localeCompare(b.name);

/** Everyone whose shift ends at that day's latest end time — the crew actually
 * there at close, i.e. who this whole duty roster is about. */
export async function closingCrew(storeId: number, day: DayOfWeek, weekStart: Date): Promise<CrewMember[]> {
  const shifts = await prisma.shift.findMany({
    where: { storeId, day, weekStart, employeeId: { not: null } },
    select: { employeeId: true, end: true, employee: { select: { name: true, avatarFruit: true } } },
  });
  if (shifts.length === 0) return [];
  const maxEnd = Math.max(...shifts.map((s) => s.end.getTime()));
  const ids = [...new Set(shifts.filter((s) => s.end.getTime() === maxEnd).map((s) => s.employeeId!))];

  const links = await prisma.employeeStore.findMany({
    where: { storeId, employeeId: { in: ids } },
    select: { employeeId: true, proficiency: true, canClose: true },
  });
  const linkById = new Map(links.map((l) => [l.employeeId, l]));
  const shiftById = new Map(shifts.map((s) => [s.employeeId!, s]));

  return ids
    .map((id) => ({
      employeeId: id,
      name: shiftById.get(id)?.employee?.name ?? '?',
      tier: (linkById.get(id)?.proficiency as CrewMember['tier']) ?? 'REGULAR',
      canClose: linkById.get(id)?.canClose ?? false,
      avatarFruit: shiftById.get(id)?.employee?.avatarFruit ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Only people flagged canClose ever hold the "Closing" role — Daniel is one of
 * them, but he defaults to mop whenever someone else eligible is also there to
 * close (he asked to be prioritized on mop "unless he couldn't" — i.e. unless
 * he's the only one who can close that day). With 3 in the crew, bathroom is
 * split between the closer and the sweeper; with 4, everyone gets their own job. */
export function autoAssign(crew: CrewMember[]): DutyAssignment {
  if (crew.length === 0) {
    return { closingEmployeeId: null, bathroomEmployeeIds: [], sweepEmployeeId: null, mopEmployeeId: null };
  }

  const eligible = crew.filter((c) => c.canClose);
  const eligibleNonDaniel = eligible.filter((c) => c.name !== 'Daniel He');
  // nobody eligible at all is scheduled to close — fall back to the crew as a
  // whole so the day still has a best-effort default (editable by hand)
  const closerPool = eligibleNonDaniel.length > 0 ? eligibleNonDaniel : eligible.length > 0 ? eligible : crew;
  const closer = [...closerPool].sort(byRank)[0]!.employeeId;
  const rest = crew.filter((c) => c.employeeId !== closer);

  if (rest.length === 0) {
    return { closingEmployeeId: closer, bathroomEmployeeIds: [closer], sweepEmployeeId: closer, mopEmployeeId: closer };
  }

  const daniel = rest.find((c) => c.name === 'Daniel He');
  const mopper = daniel ?? [...rest].sort(byRank)[0]!;
  const others = rest.filter((c) => c.employeeId !== mopper.employeeId);

  if (others.length === 0) {
    // just the closer + the mopper — the mopper covers sweep too, bathroom shared
    return {
      closingEmployeeId: closer,
      bathroomEmployeeIds: [closer, mopper.employeeId],
      sweepEmployeeId: mopper.employeeId,
      mopEmployeeId: mopper.employeeId,
    };
  }
  if (others.length === 1) {
    // the classic 3-person close: closer + sweeper share bathroom, third mops
    const sweeper = others[0]!;
    return {
      closingEmployeeId: closer,
      bathroomEmployeeIds: [closer, sweeper.employeeId],
      sweepEmployeeId: sweeper.employeeId,
      mopEmployeeId: mopper.employeeId,
    };
  }
  // 4+ in the crew — bathroom, sweep and mop each go to their own person; anyone
  // past the fourth is on the crew but not assigned a specific job here (editable by hand)
  const sorted = [...others].sort(byRank);
  const sweeper = sorted[0]!;
  const bathroomPerson = sorted[1]!;
  return {
    closingEmployeeId: closer,
    bathroomEmployeeIds: [bathroomPerson.employeeId],
    sweepEmployeeId: sweeper.employeeId,
    mopEmployeeId: mopper.employeeId,
  };
}
