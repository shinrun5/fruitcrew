import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Role } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { requireOwner } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { auditLog } from '../lib/auditLog.js';

const router = Router();
const INVITE_TTL_MS = 7 * 24 * 60 * 60_000; // 7 days

interface PersonRow {
  id: number;
  email: string;
  role: 'OWNER' | 'MANAGER';
  storeIds: number[];
  isEmployee: boolean;
  isSelf: boolean;
}

async function people(orgId: number, selfId: number): Promise<PersonRow[]> {
  const users = await prisma.user.findMany({
    where: { orgId, role: { in: ['OWNER', 'MANAGER'] } },
    orderBy: [{ role: 'asc' }, { email: 'asc' }], // OWNER sorts before MANAGER
    include: { managerStores: { select: { storeId: true } } },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    role: u.role as 'OWNER' | 'MANAGER',
    storeIds: u.managerStores.map((m) => m.storeId),
    isEmployee: u.employeeId != null,
    isSelf: u.id === selfId,
  }));
}

/** Keep only storeIds that belong to this org. */
async function orgStoreIds(orgId: number): Promise<Set<number>> {
  return new Set(
    (await prisma.store.findMany({ where: { orgId }, select: { id: true } })).map((s) => s.id),
  );
}

// GET /managers  (owner) — every owner + manager in the org
router.get('/', ...requireOwner, async (req, res) => {
  res.json({ people: await people(req.user!.orgId!, req.user!.id) });
});

// GET /managers/org  (owner) — the company's own name
router.get('/org', ...requireOwner, async (req, res) => {
  const org = await prisma.org.findUnique({ where: { id: req.user!.orgId! }, select: { id: true, name: true } });
  res.json(org);
});

// PUT /managers/org  { name }  (owner) — rename the company
router.put('/org', ...requireOwner, async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'name is required' });
  const org = await prisma.org.update({ where: { id: req.user!.orgId! }, data: { name } });
  res.json({ id: org.id, name: org.name });
});

// GET /managers/invites  (owner) — pending (unclaimed) invite links for the org
router.get('/invites', ...requireOwner, async (req, res) => {
  const invites = await prisma.managerInvite.findMany({
    where: { orgId: req.user!.orgId!, usedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: { createdAt: 'desc' },
  });
  res.json(
    invites.map((i) => ({
      id: i.id,
      code: i.code,
      role: i.role,
      storeIds: i.storeIds,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
    })),
  );
});

// POST /managers/invites  { role: 'OWNER' | 'MANAGER', storeIds?: number[] }  (owner)
// A shareable sign-up link — they pick their own email and password, instead of
// the owner inventing one and having to relay it.
router.post('/invites', ...requireOwner, async (req, res) => {
  const orgId = req.user!.orgId!;
  const role: Role | undefined = req.body?.role === 'OWNER' || req.body?.role === 'MANAGER' ? req.body.role : undefined;
  if (!role) return res.status(400).json({ error: "role must be 'OWNER' or 'MANAGER'" });

  const valid = await orgStoreIds(orgId);
  const storeIds: number[] =
    role === 'MANAGER' && Array.isArray(req.body?.storeIds)
      ? req.body.storeIds.filter((s: number) => valid.has(s))
      : [];

  const code = randomBytes(9).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const invite = await prisma.managerInvite.create({
    data: { code, orgId, role, storeIds, createdById: req.user!.id, expiresAt },
  });
  res.status(201).json({
    id: invite.id,
    code: invite.code,
    role: invite.role,
    storeIds: invite.storeIds,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
  });
});

// DELETE /managers/invites/:id  (owner) — revoke a link before it's claimed
router.delete('/invites/:id', ...requireOwner, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const invite = await prisma.managerInvite.findFirst({ where: { id, orgId: req.user!.orgId! } });
  if (!invite) return res.status(404).json({ error: 'Not found' });
  await prisma.managerInvite.delete({ where: { id } });
  res.json({ message: 'Invite revoked' });
});

// POST /managers/:id/role  { role: 'OWNER' | 'MANAGER' }  (owner) — promote / hand over
router.post('/:id/role', ...requireOwner, async (req, res) => {
  const orgId = req.user!.orgId!;
  const id = Number(req.params.id);
  const role = req.body?.role;
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  if (role !== 'OWNER' && role !== 'MANAGER') {
    return res.status(400).json({ error: "role must be 'OWNER' or 'MANAGER'" });
  }

  const target = await prisma.user.findFirst({
    where: { id, orgId, role: { in: ['OWNER', 'MANAGER'] } },
  });
  if (!target) return res.status(404).json({ error: 'Not found in your org' });
  if (target.role === role) return res.json({ id, role });

  if (target.role === 'OWNER' && role === 'MANAGER') {
    const owners = await prisma.user.count({ where: { orgId, role: 'OWNER' } });
    if (owners <= 1) return res.status(400).json({ error: 'The company needs at least one owner' });
  }

  await prisma.user.update({ where: { id }, data: { role } });

  // a freshly demoted owner has no store assignments — give them all org stores to start
  if (target.role === 'OWNER' && role === 'MANAGER') {
    const stores = await prisma.store.findMany({ where: { orgId }, select: { id: true } });
    await prisma.$transaction([
      prisma.managerStore.deleteMany({ where: { userId: id } }),
      prisma.managerStore.createMany({ data: stores.map((s) => ({ userId: id, storeId: s.id })) }),
    ]);
  }
  auditLog('Role changed', req.user!, { targetUserId: id, targetEmail: target.email, from: target.role, to: role });
  res.json({ id, role });
});

// PUT /managers/:id/stores  { storeIds: number[] }  (owner)
router.put('/:id/stores', ...requireOwner, async (req, res) => {
  const orgId = req.user!.orgId!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });

  const target = await prisma.user.findFirst({ where: { id, orgId, role: 'MANAGER' } });
  if (!target) return res.status(404).json({ error: 'Manager not found' });

  const valid = await orgStoreIds(orgId);
  const stores: number[] = Array.isArray(req.body?.storeIds)
    ? req.body.storeIds.filter((s: number) => valid.has(s))
    : [];

  await prisma.$transaction([
    prisma.managerStore.deleteMany({ where: { userId: id } }),
    prisma.managerStore.createMany({ data: stores.map((storeId) => ({ userId: id, storeId })) }),
  ]);
  res.json({ id, storeIds: stores });
});

// DELETE /managers/:id  (owner) — removes the login; an Employee record is left intact
router.delete('/:id', ...requireOwner, async (req, res) => {
  const orgId = req.user!.orgId!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  if (id === req.user!.id) return res.status(400).json({ error: "You can't remove yourself" });

  const target = await prisma.user.findFirst({
    where: { id, orgId, role: { in: ['OWNER', 'MANAGER'] } },
  });
  if (!target) return res.status(404).json({ error: 'Not found in your org' });
  if (target.role === 'OWNER') {
    const owners = await prisma.user.count({ where: { orgId, role: 'OWNER' } });
    if (owners <= 1) return res.status(400).json({ error: 'The company needs at least one owner' });
  }

  await prisma.managerStore.deleteMany({ where: { userId: id } });
  await prisma.user.delete({ where: { id } });
  await supabaseAdmin().auth.admin.deleteUser(target.authId).catch(() => {});
  auditLog('Manager/owner removed', req.user!, { targetUserId: id, targetEmail: target.email, targetRole: target.role });
  res.json({ message: 'Manager removed' });
});

export default router;
