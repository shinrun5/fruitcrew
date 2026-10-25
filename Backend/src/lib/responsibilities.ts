import prisma from './prisma.js';

/** Every store must always have this one built-in responsibility — created
 * alongside the store (see routes/stores.ts) and backfilled for stores that
 * predate this feature in the "responsibilities" migration. lib/scheduleGen.ts
 * (the auto-scheduler) looks it up by name, so it must exist for every store
 * and can't be renamed/archived (see routes/responsibilities.ts). There's no
 * equivalent "Closer" builtin — the old canClose flag gated exactly one thing
 * (who could hold the "Closing" role on a store's Closing Duties board), so it
 * became that role's own grant instead of a second universal flag; every
 * closing-time role gets its own independently-grantable flag, which is the
 * whole point of this feature. upsert makes this safe to call unconditionally,
 * including for legacy stores. */
export async function ensureOpenerResponsibility(storeId: number): Promise<number> {
  const opener = await prisma.responsibility.upsert({
    where: { storeId_name: { storeId, name: 'Opener' } },
    create: { storeId, name: 'Opener', scope: 'OPENING', sortOrder: 0, builtin: true },
    update: {},
  });
  return opener.id;
}

/** A store's live sections (SECTION-scope, not archived), by id → name. */
export async function storeSections(storeId: number): Promise<Map<number, string>> {
  const rows = await prisma.responsibility.findMany({
    where: { storeId, scope: 'SECTION', archivedAt: null },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** employeeId → the one section they usually work at this store, for filling
 * in new shifts. Someone with several (or none) is left for the manager to
 * pick per shift. */
export async function usualSections(storeId: number): Promise<Map<number, number>> {
  const grants = await prisma.employeeResponsibility.findMany({
    where: { storeId, responsibility: { scope: 'SECTION', archivedAt: null } },
    select: { employeeId: true, responsibilityId: true },
  });
  const count = new Map<number, number>();
  for (const g of grants) count.set(g.employeeId, (count.get(g.employeeId) ?? 0) + 1);
  return new Map(grants.filter((g) => count.get(g.employeeId) === 1).map((g) => [g.employeeId, g.responsibilityId]));
}

/** A shift's section name as the crew should see it — hidden once the section
 * is deleted (archived) or turned into some other kind of role. */
export function sectionLabel(section: { name: string; scope: string; archivedAt: Date | null } | null): string | null {
  return section && section.scope === 'SECTION' && !section.archivedAt ? section.name : null;
}
