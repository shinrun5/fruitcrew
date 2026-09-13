import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireSuperAdmin } from '../lib/auth.js';

const router = Router();

// Every route here is read-only by design: this is a support/debugging console
// for whoever operates the hosting, not a way to act inside a customer's org.
// See lib/auth.ts's isSuperAdmin flag — platform-level, not self-serve.

// GET /admin/orgs — every org on the platform, with basic counts
router.get('/orgs', ...requireSuperAdmin, async (_req, res) => {
  const orgs = await prisma.org.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      stores: { select: { id: true } },
      users: { where: { role: 'OWNER' }, select: { email: true }, orderBy: { id: 'asc' } },
    },
  });
  const employeeCounts = await prisma.employeeStore.groupBy({
    by: ['storeId'],
    _count: { employeeId: true },
  });
  const storeToOrg = new Map(orgs.flatMap((o) => o.stores.map((s) => [s.id, o.id])));
  const employeesByOrg = new Map<number, number>();
  for (const row of employeeCounts) {
    const orgId = storeToOrg.get(row.storeId);
    if (orgId == null) continue;
    employeesByOrg.set(orgId, (employeesByOrg.get(orgId) ?? 0) + row._count.employeeId);
  }

  res.json(
    orgs.map((o) => ({
      id: o.id,
      name: o.name,
      createdAt: o.createdAt,
      owners: o.users.map((u) => u.email),
      storeCount: o.stores.length,
      employeeCount: employeesByOrg.get(o.id) ?? 0,
    })),
  );
});

// GET /admin/orgs/:id — one org's stores + who runs them
router.get('/orgs/:id', ...requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });

  const org = await prisma.org.findUnique({ where: { id } });
  if (!org) return res.status(404).json({ error: 'Not found' });

  const [stores, people] = await Promise.all([
    prisma.store.findMany({
      where: { orgId: id },
      include: {
        schedule: { select: { publishedAt: true, weekStart: true } },
        _count: { select: { employeeStores: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      where: { orgId: id, role: { in: ['OWNER', 'MANAGER'] } },
      select: { id: true, email: true, role: true, createdAt: true, managerStores: { select: { storeId: true } } },
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
    }),
  ]);

  res.json({
    id: org.id,
    name: org.name,
    createdAt: org.createdAt,
    stores: stores.map((s) => ({
      id: s.id,
      name: s.name,
      employeeCount: s._count.employeeStores,
      publishedAt: s.schedule?.publishedAt ?? null,
      weekStart: s.schedule?.weekStart ?? null,
    })),
    people: people.map((p) => ({
      id: p.id,
      email: p.email,
      role: p.role,
      createdAt: p.createdAt,
      storeIds: p.managerStores.map((m) => m.storeId),
    })),
  });
});

export default router;
