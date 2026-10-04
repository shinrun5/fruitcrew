import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { canManageStore, requireAuth, requireManagerFor, requireRole } from '../lib/auth.js';
import { alertError } from '../lib/errorAlert.js';

const router = Router();
const anyManager = [requireAuth, requireRole('MANAGER', 'OWNER')] as const;

/** Decorates raw EmployeeStore rows with the computed canOpen boolean (sourced
 * from the built-in Opener responsibility — see lib/responsibilities.ts) plus
 * the full responsibilityIds list, so every consumer of this endpoint (the
 * schedule board, gap warnings, the candidate picker) keeps working exactly as
 * it did when canOpen was a plain column. */
async function withResponsibilities<T extends { employeeId: number; storeId: number }>(
  links: T[],
): Promise<(T & { canOpen: boolean; responsibilityIds: number[] })[]> {
  if (links.length === 0) return [];
  const grants = await prisma.employeeResponsibility.findMany({
    where: { OR: links.map((l) => ({ employeeId: l.employeeId, storeId: l.storeId })) },
    select: { employeeId: true, storeId: true, responsibilityId: true, responsibility: { select: { name: true } } },
  });
  const byLink = new Map<string, { ids: number[]; names: Set<string> }>();
  for (const g of grants) {
    const key = `${g.employeeId}:${g.storeId}`;
    const entry = byLink.get(key) ?? { ids: [], names: new Set<string>() };
    entry.ids.push(g.responsibilityId);
    entry.names.add(g.responsibility.name);
    byLink.set(key, entry);
  }
  return links.map((l) => {
    const entry = byLink.get(`${l.employeeId}:${l.storeId}`);
    return {
      ...l,
      canOpen: entry?.names.has('Opener') ?? false,
      responsibilityIds: entry?.ids ?? [],
    };
  });
}

// GET /employeeStores — links at stores the caller manages
router.get('/', ...anyManager, async (req, res) => {
  const links = await prisma.employeeStore.findMany({
    where: { storeId: { in: req.user!.storeIds } },
  });
  res.json(await withResponsibilities(links));
});

router.get('/:employeeId/:storeId', ...anyManager, async (req, res) => {
  const employeeId = Number(req.params.employeeId);
  const storeId = Number(req.params.storeId);
  if (!Number.isInteger(employeeId) || !Number.isInteger(storeId)) {
    return res.status(400).json({ error: 'Valid numeric employeeId and storeId are required' });
  }
  if (!canManageStore(req.user, storeId)) return res.status(404).json({ error: 'Not found' });

  const link = await prisma.employeeStore.findUnique({
    where: { employeeId_storeId: { employeeId, storeId } },
  });
  res.json(link ? (await withResponsibilities([link]))[0] : null);
});

// POST /employeeStores  { employeeId, storeId, proficiency, responsibilityIds?, primary? }
router.post('/', ...requireManagerFor((req) => Number(req.body?.storeId)), async (req, res) => {
  const { employeeId, storeId, proficiency, responsibilityIds, primary } = req.body ?? {};
  if (!employeeId || !storeId || !proficiency) {
    return res.status(400).json({ error: 'employeeId, storeId, and proficiency are required' });
  }

  // employeeId is client-supplied — confirm it's already one of this org's own
  // workers (linked at some other store in the same org) before linking them
  // in here too, so a manager can't pull in a stranger from another company
  // by guessing/enumerating ids. New workers always get their first link via
  // POST /employees instead, which creates both together.
  //
  // The org comes from the TARGET STORE, not req.user.orgId: requireManagerFor
  // above already proved the caller manages that store, and User.orgId can be
  // null (e.g. a MANAGER made by create-manager, or a super admin) — passing
  // null into a required Int filter makes Prisma throw before the try/catch
  // below, which Express 5 turns into the generic "Internal server error".
  try {
    const targetStore = await prisma.store.findUnique({ where: { id: Number(storeId) }, select: { orgId: true } });
    if (!targetStore) return res.status(404).json({ error: 'Store not found' });

    const ownWorker = await prisma.employeeStore.findFirst({
      where: { employeeId: Number(employeeId), store: { orgId: targetStore.orgId } },
    });
    if (!ownWorker) return res.status(403).json({ error: 'That worker is not part of your company' });

    const ids: number[] = Array.isArray(responsibilityIds) ? responsibilityIds.filter(Number.isInteger) : [];
    const link = await prisma.$transaction(async (tx) => {
      const created = await tx.employeeStore.create({
        data: {
          employeeId,
          storeId,
          proficiency,
          ...(primary !== undefined ? { primary } : {}),
        },
      });
      if (ids.length > 0) {
        await tx.employeeResponsibility.createMany({
          data: ids.map((responsibilityId) => ({ employeeId, storeId, responsibilityId })),
          skipDuplicates: true,
        });
      }
      return created;
    });
    res.json(link);
  } catch (e) {
    const isDupe = e instanceof Error && e.message.includes('Unique');
    if (!isDupe) alertError('employeeStores.create', e, { employeeId, storeId });
    res.status(isDupe ? 409 : 500).json({ error: isDupe ? 'Already linked to that store' : 'Failed to link' });
  }
});

router.delete('/:employeeId/:storeId', ...anyManager, async (req, res) => {
  const employeeId = Number(req.params.employeeId);
  const storeId = Number(req.params.storeId);
  if (!Number.isInteger(employeeId) || !Number.isInteger(storeId)) {
    return res.status(400).json({ error: 'Valid numeric employeeId and storeId are required' });
  }
  if (!canManageStore(req.user, storeId)) return res.status(403).json({ error: 'You do not manage that store' });

  try {
    await prisma.$transaction([
      prisma.employeeResponsibility.deleteMany({ where: { employeeId, storeId } }),
      prisma.employeeStore.delete({ where: { employeeId_storeId: { employeeId, storeId } } }),
    ]);
    res.json({ message: 'Employee-store link deleted successfully' });
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// PUT /employeeStores/:employeeId/:storeId  { proficiency?, responsibilityIds?, primary? }
// responsibilityIds, when present, REPLACES the full set granted at this store.
router.put('/:employeeId/:storeId', ...anyManager, async (req, res) => {
  const employeeId = Number(req.params.employeeId);
  const storeId = Number(req.params.storeId);
  const { proficiency, responsibilityIds, primary } = req.body ?? {};
  if (!Number.isInteger(employeeId) || !Number.isInteger(storeId)) {
    return res.status(400).json({ error: 'Valid numeric employeeId and storeId are required' });
  }
  if (!canManageStore(req.user, storeId)) return res.status(403).json({ error: 'You do not manage that store' });

  try {
    const link = await prisma.$transaction(async (tx) => {
      const updated = await tx.employeeStore.update({
        where: { employeeId_storeId: { employeeId, storeId } },
        data: {
          ...(proficiency !== undefined ? { proficiency } : {}),
          ...(primary !== undefined ? { primary } : {}),
        },
      });
      if (Array.isArray(responsibilityIds)) {
        const ids = responsibilityIds.filter(Number.isInteger);
        await tx.employeeResponsibility.deleteMany({ where: { employeeId, storeId } });
        if (ids.length > 0) {
          await tx.employeeResponsibility.createMany({
            data: ids.map((responsibilityId: number) => ({ employeeId, storeId, responsibilityId })),
            skipDuplicates: true,
          });
        }
      }
      return updated;
    });
    res.json(link);
  } catch {
    res.status(500).json({ error: 'Failed to update employee-store link' });
  }
});

export default router;
