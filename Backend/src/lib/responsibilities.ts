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
