import type { DayOfWeek } from '@prisma/client';
import prisma from './prisma.js';

export interface CrewMember {
  employeeId: number;
  name: string;
  tier: 'NEW' | 'REGULAR' | 'SENIOR' | 'MANAGER';
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
export async function closingCrew(storeId: number, day: DayOfWeek): Promise<CrewMember[]> {
  const shifts = await prisma.shift.findMany({
    where: { storeId, day, employeeId: { not: null } },
    select: { employeeId: true, end: true, employee: { select: { name: true } } },
  });
  if (shifts.length === 0) return [];
  const maxEnd = Math.max(...shifts.map((s) => s.end.getTime()));
  const ids = [...new Set(shifts.filter((s) => s.end.getTime() === maxEnd).map((s) => s.employeeId!))];

  const tiers = await prisma.employeeStore.findMany({
    where: { storeId, employeeId: { in: ids } },
    select: { employeeId: true, proficiency: true },
  });
  const tierById = new Map(tiers.map((t) => [t.employeeId, t.proficiency as CrewMember['tier']]));
  const nameById = new Map(shifts.map((s) => [s.employeeId!, s.employee?.name ?? '?']));

  return ids
    .map((id) => ({ employeeId: id, name: nameById.get(id) ?? '?', tier: tierById.get(id) ?? 'REGULAR' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Senior closes — never the manager, who's running the store rather than doing
 * the closing checklist. With 3 in the crew, bathroom is split between the closer
 * and the sweeper; with 4, everyone gets their own job. Daniel gets mop whenever
 * he's in the crew (he asked to be prioritized on it, so long as he's there). */
export function autoAssign(crew: CrewMember[]): DutyAssignment {
  if (crew.length === 0) {
    return { closingEmployeeId: null, bathroomEmployeeIds: [], sweepEmployeeId: null, mopEmployeeId: null };
  }

  const ranked = [...crew].sort(byRank);
  const nonManager = ranked.filter((c) => c.tier !== 'MANAGER');
  const closer = (nonManager[0] ?? ranked[0]!).employeeId;
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
