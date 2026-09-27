import type { DayOfWeek } from '@prisma/client';
import prisma from './prisma.js';

export interface CrewMember {
  employeeId: number;
  name: string;
  tier: 'NEW' | 'REGULAR' | 'SENIOR' | 'MANAGER';
  /** ids of this store's CLOSING-scope Responsibility rows this person holds */
  responsibilityIds: number[];
  avatarFruit: string | null;
}

export interface ResponsibilityAssignment {
  responsibilityId: number;
  employeeIds: number[];
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

  const [links, grants] = await Promise.all([
    prisma.employeeStore.findMany({
      where: { storeId, employeeId: { in: ids } },
      select: { employeeId: true, proficiency: true },
    }),
    prisma.employeeResponsibility.findMany({
      where: { storeId, employeeId: { in: ids }, responsibility: { scope: 'CLOSING', archivedAt: null } },
      select: { employeeId: true, responsibilityId: true },
    }),
  ]);
  const linkById = new Map(links.map((l) => [l.employeeId, l]));
  const shiftById = new Map(shifts.map((s) => [s.employeeId!, s]));
  const respByEmp = new Map<number, number[]>();
  for (const g of grants) {
    respByEmp.set(g.employeeId, [...(respByEmp.get(g.employeeId) ?? []), g.responsibilityId]);
  }

  return ids
    .map((id) => ({
      employeeId: id,
      name: shiftById.get(id)?.employee?.name ?? '?',
      tier: (linkById.get(id)?.proficiency as CrewMember['tier']) ?? 'REGULAR',
      responsibilityIds: respByEmp.get(id) ?? [],
      avatarFruit: shiftById.get(id)?.employee?.avatarFruit ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** This store's CLOSING-scope responsibilities (the migrated "Closing" role
 * plus whatever custom roles the store has defined), in display/assignment order. */
export async function closingResponsibilities(storeId: number): Promise<{ id: number; name: string }[]> {
  return prisma.responsibility.findMany({
    where: { storeId, scope: 'CLOSING', archivedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true },
  });
}

/** Assigns each of the store's closing-scope responsibilities to the day's crew:
 * for each responsibility in order, the best-ranked (senior-first) person who
 * actually holds that specific responsibility and has the fewest roles so far
 * today gets it — so duties spread across the crew instead of piling onto one
 * person, and once everyone eligible already has one, doubling up is allowed
 * rather than leaving a role unfilled. "Closing" (the role migrated from the
 * old closingEmployeeId column, and canClose along with it) additionally falls
 * back to the crew as a whole if literally nobody there is flagged for it —
 * matches the pre-migration behavior exactly. Today's other roles have no such
 * fallback: an unfilled custom role just means nobody's flagged for it yet at
 * this store, editable by hand either way. */
export function autoAssign(
  crew: CrewMember[],
  responsibilities: { id: number; name: string }[],
): ResponsibilityAssignment[] {
  if (crew.length === 0 || responsibilities.length === 0) return [];

  const assignedCount = new Map<number, number>();
  const pick = (pool: CrewMember[]): CrewMember | undefined => {
    if (pool.length === 0) return undefined;
    const min = Math.min(...pool.map((c) => assignedCount.get(c.employeeId) ?? 0));
    const leastLoaded = pool.filter((c) => (assignedCount.get(c.employeeId) ?? 0) === min);
    return [...leastLoaded].sort(byRank)[0];
  };

  return responsibilities.map((resp) => {
    let eligible = crew.filter((c) => c.responsibilityIds.includes(resp.id));
    if (eligible.length === 0 && resp.name === 'Closing') eligible = crew;
    const chosen = pick(eligible);
    if (chosen) assignedCount.set(chosen.employeeId, (assignedCount.get(chosen.employeeId) ?? 0) + 1);
    return { responsibilityId: resp.id, employeeIds: chosen ? [chosen.employeeId] : [] };
  });
}
