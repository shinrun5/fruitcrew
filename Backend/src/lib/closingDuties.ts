import type { DayOfWeek } from '@prisma/client';
import prisma from './prisma.js';
import { hhmmToMinutes, minuteOfDay, WEEK_DAYS } from './time.js';

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

/** One week's assigned shifts at a store, as workers see them: the live rows
 * while the week is still on the board, else the copy archived when a later
 * week was posted (see retirePostedWeek) — this week's Saturday and Sunday
 * closers mustn't vanish the moment next week goes up. */
async function weekShifts(storeId: number, weekStart: Date): Promise<{ employeeId: number; day: DayOfWeek; end: number; name: string | null }[]> {
  const live = await prisma.shift.findMany({
    where: { storeId, weekStart },
    select: { employeeId: true, day: true, end: true, employee: { select: { name: true } } },
  });
  if (live.length > 0) {
    return live
      .filter((s) => s.employeeId != null)
      .map((s) => ({ employeeId: s.employeeId!, day: s.day, end: minuteOfDay(s.end), name: s.employee?.name ?? null }));
  }
  const snap = await prisma.scheduleSnapshot.findFirst({ where: { storeId, weekStart }, orderBy: { savedAt: 'desc' } });
  const frozen = (snap?.shifts ?? []) as { employeeId: number | null; employeeName: string | null; day: DayOfWeek; end: string }[];
  return frozen
    .filter((f) => f.employeeId != null)
    .map((f) => ({ employeeId: f.employeeId!, day: f.day, end: hhmmToMinutes(f.end), name: f.employeeName }));
}

/** Each day's closing crew for the week: everyone whose shift ends at that
 * day's latest end time — the crew actually there at close, i.e. who this
 * whole duty roster is about. A day nobody works is an empty list. */
export async function closingCrews(storeId: number, weekStart: Date): Promise<Map<DayOfWeek, CrewMember[]>> {
  const shifts = await weekShifts(storeId, weekStart);
  const crewIds = new Map<DayOfWeek, number[]>();
  for (const day of WEEK_DAYS) {
    const today = shifts.filter((s) => s.day === day);
    if (today.length === 0) continue;
    const maxEnd = Math.max(...today.map((s) => s.end));
    crewIds.set(day, [...new Set(today.filter((s) => s.end === maxEnd).map((s) => s.employeeId))]);
  }
  const ids = [...new Set([...crewIds.values()].flat())];
  if (ids.length === 0) return new Map();

  const [links, grants, people] = await Promise.all([
    prisma.employeeStore.findMany({
      where: { storeId, employeeId: { in: ids } },
      select: { employeeId: true, proficiency: true },
    }),
    prisma.employeeResponsibility.findMany({
      where: { storeId, employeeId: { in: ids }, responsibility: { scope: 'CLOSING', archivedAt: null } },
      select: { employeeId: true, responsibilityId: true },
    }),
    prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, avatarFruit: true } }),
  ]);
  const linkById = new Map(links.map((l) => [l.employeeId, l]));
  const personById = new Map(people.map((p) => [p.id, p]));
  // an archived week can name someone who's since been removed — keep the name it was posted with
  const postedName = new Map(shifts.map((s) => [s.employeeId, s.name]));
  const respByEmp = new Map<number, number[]>();
  for (const g of grants) {
    respByEmp.set(g.employeeId, [...(respByEmp.get(g.employeeId) ?? []), g.responsibilityId]);
  }

  const member = (id: number): CrewMember => ({
    employeeId: id,
    name: personById.get(id)?.name ?? postedName.get(id) ?? '?',
    tier: (linkById.get(id)?.proficiency as CrewMember['tier']) ?? 'REGULAR',
    responsibilityIds: respByEmp.get(id) ?? [],
    avatarFruit: personById.get(id)?.avatarFruit ?? null,
  });
  return new Map(
    [...crewIds.entries()].map(([day, dayIds]) => [day, dayIds.map(member).sort((a, b) => a.name.localeCompare(b.name))]),
  );
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
 * rather than leaving a role unfilled. If literally nobody on the crew is
 * flagged for a given responsibility, it falls back to the crew as a whole —
 * matches the pre-migration behavior, where only "Closing" was ever gated by a
 * capability flag (canClose) and the rest (Bathroom/Sweep/Mop) were open to
 * anyone on the crew with no gating at all. A store only gets pickier than
 * that once a manager actually starts flagging specific people for a specific
 * role on the Workers page — until then, every role still auto-fills. */
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
    const flagged = crew.filter((c) => c.responsibilityIds.includes(resp.id));
    const eligible = flagged.length > 0 ? flagged : crew;
    const chosen = pick(eligible);
    if (chosen) assignedCount.set(chosen.employeeId, (assignedCount.get(chosen.employeeId) ?? 0) + 1);
    return { responsibilityId: resp.id, employeeIds: chosen ? [chosen.employeeId] : [] };
  });
}
