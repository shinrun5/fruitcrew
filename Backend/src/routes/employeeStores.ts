import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { canManageStore, requireAuth, requireManagerFor, requireRole } from '../lib/auth.js';

const router = Router();
const anyManager = [requireAuth, requireRole('MANAGER', 'OWNER')] as const;

// GET /employeeStores — links at stores the caller manages
router.get('/', ...anyManager, async (req, res) => {
  const links = await prisma.employeeStore.findMany({
    where: { storeId: { in: req.user!.storeIds } },
  });
  res.json(links);
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
  res.json(link);
});

// POST /employeeStores  { employeeId, storeId, proficiency, canOpen?, primary? }
router.post('/', ...requireManagerFor((req) => Number(req.body?.storeId)), async (req, res) => {
  const { employeeId, storeId, proficiency, canOpen, canClose, primary } = req.body ?? {};
  if (!employeeId || !storeId || !proficiency) {
    return res.status(400).json({ error: 'employeeId, storeId, and proficiency are required' });
  }

  // employeeId is client-supplied — confirm it's already one of this org's own
  // workers (linked at some other store in the same org) before linking them
  // in here too, so a manager can't pull in a stranger from another company
  // by guessing/enumerating ids. New workers always get their first link via
  // POST /employees instead, which creates both together.
  const ownWorker = await prisma.employeeStore.findFirst({
    where: { employeeId, store: { orgId: req.user!.orgId! } },
  });
  if (!ownWorker) return res.status(403).json({ error: 'That worker is not part of your company' });

  try {
    const link = await prisma.employeeStore.create({
      data: {
        employeeId,
        storeId,
        proficiency,
        ...(canOpen !== undefined ? { canOpen } : {}),
        ...(canClose !== undefined ? { canClose } : {}),
        ...(primary !== undefined ? { primary } : {}),
      },
    });
    res.json(link);
  } catch (e) {
    const msg = e instanceof Error && e.message.includes('Unique') ? 'Already linked to that store' : 'Failed to link';
    res.status(500).json({ error: msg });
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
    await prisma.employeeStore.delete({ where: { employeeId_storeId: { employeeId, storeId } } });
    res.json({ message: 'Employee-store link deleted successfully' });
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

router.put('/:employeeId/:storeId', ...anyManager, async (req, res) => {
  const employeeId = Number(req.params.employeeId);
  const storeId = Number(req.params.storeId);
  const { proficiency, canOpen, canClose, primary } = req.body ?? {};
  if (!Number.isInteger(employeeId) || !Number.isInteger(storeId)) {
    return res.status(400).json({ error: 'Valid numeric employeeId and storeId are required' });
  }
  if (!canManageStore(req.user, storeId)) return res.status(403).json({ error: 'You do not manage that store' });

  try {
    const link = await prisma.employeeStore.update({
      where: { employeeId_storeId: { employeeId, storeId } },
      data: {
        ...(proficiency !== undefined ? { proficiency } : {}),
        ...(canOpen !== undefined ? { canOpen } : {}),
        ...(canClose !== undefined ? { canClose } : {}),
        ...(primary !== undefined ? { primary } : {}),
      },
    });
    res.json(link);
  } catch {
    res.status(500).json({ error: 'Failed to update employee-store link' });
  }
});

export default router;
