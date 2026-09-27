import { Router, type NextFunction, type Request, type Response } from 'express';
import { ResponsibilityScope } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { canManageStore, requireAuth, requireManagerFor } from '../lib/auth.js';

const router = Router();

const SCOPES = new Set<string>(Object.values(ResponsibilityScope));

/** guard for PUT/DELETE /:id — look up the responsibility's store first */
async function requireManagerOfResp(req: Request, res: Response, next: NextFunction) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const row = await prisma.responsibility.findUnique({ where: { id }, select: { storeId: true } });
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!canManageStore(req.user, row.storeId)) {
    return res.status(403).json({ error: 'You do not manage that store' });
  }
  next();
}

// GET /responsibilities?storeId=  (scoped to stores the caller can manage; archived excluded by default)
router.get('/', requireAuth, async (req, res) => {
  const storeId = Number(req.query.storeId);
  if (!Number.isInteger(storeId) || !req.user!.storeIds.includes(storeId)) {
    return res.status(403).json({ error: 'No access to that store' });
  }
  const includeArchived = req.query.includeArchived === 'true';
  const rows = await prisma.responsibility.findMany({
    where: { storeId, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ scope: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
  });
  res.json(rows);
});

// POST /responsibilities  { storeId, name, scope, sortOrder? }  (manager of that store)
router.post('/', ...requireManagerFor((req) => Number(req.body?.storeId)), async (req, res) => {
  const b = req.body ?? {};
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!SCOPES.has(b.scope)) return res.status(400).json({ error: 'scope must be OPENING, CLOSING, or ANY' });

  try {
    const created = await prisma.responsibility.create({
      data: {
        storeId: b.storeId,
        name,
        scope: b.scope as ResponsibilityScope,
        sortOrder: Math.max(0, Math.floor(Number(b.sortOrder) || 0)),
      },
    });
    res.json(created);
  } catch (err) {
    const message =
      err && typeof err === 'object' && 'code' in err && err.code === 'P2002'
        ? 'This store already has a responsibility with that name'
        : 'Failed to create responsibility';
    res.status(400).json({ error: message });
  }
});

// PUT /responsibilities/:id  { name?, scope?, sortOrder? }  (manager) — builtin rows keep their name/scope
router.put('/:id', requireAuth, requireManagerOfResp, async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body ?? {};
  const existing = await prisma.responsibility.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const data: { name?: string; scope?: ResponsibilityScope; sortOrder?: number } = {};
  if (b.name !== undefined) {
    if (existing.builtin) return res.status(400).json({ error: 'This responsibility cannot be renamed' });
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'name cannot be blank' });
    data.name = name;
  }
  if (b.scope !== undefined) {
    if (existing.builtin) return res.status(400).json({ error: "This responsibility's scope cannot be changed" });
    if (!SCOPES.has(b.scope)) return res.status(400).json({ error: 'scope must be OPENING, CLOSING, or ANY' });
    data.scope = b.scope as ResponsibilityScope;
  }
  if (b.sortOrder !== undefined) data.sortOrder = Math.max(0, Math.floor(Number(b.sortOrder) || 0));

  try {
    const updated = await prisma.responsibility.update({ where: { id }, data });
    res.json(updated);
  } catch (err) {
    const message =
      err && typeof err === 'object' && 'code' in err && err.code === 'P2002'
        ? 'This store already has a responsibility with that name'
        : 'Failed to update responsibility';
    res.status(400).json({ error: message });
  }
});

// DELETE /responsibilities/:id  (manager) — soft delete; builtin rows can't be archived
router.delete('/:id', requireAuth, requireManagerOfResp, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.responsibility.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.builtin) return res.status(400).json({ error: 'This responsibility cannot be removed' });

  const row = await prisma.responsibility.update({ where: { id }, data: { archivedAt: new Date() } });
  res.json(row);
});

// POST /responsibilities/grant  { employeeId, storeId, responsibilityId }  (manager)
router.post('/grant', ...requireManagerFor((req) => Number(req.body?.storeId)), async (req, res) => {
  const { employeeId, storeId, responsibilityId } = req.body ?? {};
  if (!Number.isInteger(employeeId) || !Number.isInteger(responsibilityId)) {
    return res.status(400).json({ error: 'employeeId and responsibilityId are required' });
  }
  const resp = await prisma.responsibility.findUnique({ where: { id: responsibilityId } });
  if (!resp || resp.storeId !== storeId) return res.status(404).json({ error: 'Not found at that store' });

  await prisma.employeeResponsibility.upsert({
    where: { employeeId_storeId_responsibilityId: { employeeId, storeId, responsibilityId } },
    create: { employeeId, storeId, responsibilityId },
    update: {},
  });
  res.json({ employeeId, storeId, responsibilityId, granted: true });
});

// POST /responsibilities/revoke  { employeeId, storeId, responsibilityId }  (manager)
router.post('/revoke', ...requireManagerFor((req) => Number(req.body?.storeId)), async (req, res) => {
  const { employeeId, storeId, responsibilityId } = req.body ?? {};
  if (!Number.isInteger(employeeId) || !Number.isInteger(responsibilityId)) {
    return res.status(400).json({ error: 'employeeId and responsibilityId are required' });
  }
  await prisma.employeeResponsibility
    .delete({ where: { employeeId_storeId_responsibilityId: { employeeId, storeId, responsibilityId } } })
    .catch(() => {}); // already not granted — fine
  res.json({ employeeId, storeId, responsibilityId, granted: false });
});

export default router;
