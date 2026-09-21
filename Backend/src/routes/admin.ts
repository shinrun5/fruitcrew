import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { RequestStatus } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { requireSuperAdmin } from '../lib/auth.js';
import { emailShell, escapeHtml, sendEmail } from '../lib/email.js';
import { alertError } from '../lib/errorAlert.js';
import { deleteUserAccount } from '../lib/accountDeletion.js';

const router = Router();
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');

// Every /orgs route here is read-only by design: this is a support/debugging
// console for whoever operates the hosting, not a way to act inside a
// customer's org. See lib/auth.ts's isSuperAdmin flag — platform-level, not
// self-serve. The /signup-requests routes below are the one deliberate
// exception: approving/declining a business's request to join the platform.

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

const STATUSES = new Set(['PENDING', 'APPROVED', 'DENIED', 'CANCELLED']);

// GET /admin/signup-requests?status=PENDING — the approval queue (default: all)
router.get('/signup-requests', ...requireSuperAdmin, async (req, res) => {
  const status =
    typeof req.query.status === 'string' && STATUSES.has(req.query.status)
      ? (req.query.status as RequestStatus)
      : undefined;
  const requests = await prisma.signupRequest.findMany({
    ...(status ? { where: { status } } : {}),
    orderBy: { createdAt: 'desc' },
  });
  res.json(requests);
});

// POST /admin/signup-requests/:id/approve — creates the Org + an OWNER invite
// for it, and emails the requester the invite link. There's no "unapprove".
router.post('/signup-requests/:id/approve', ...requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });

  const sr = await prisma.signupRequest.findUnique({ where: { id } });
  if (!sr) return res.status(404).json({ error: 'Not found' });
  if (sr.status !== 'PENDING') return res.status(409).json({ error: 'Already decided' });

  const org = await prisma.org.create({ data: { name: sr.businessName } });
  const code = randomBytes(9).toString('base64url');
  await prisma.managerInvite.create({
    data: { code, orgId: org.id, role: 'OWNER', createdById: req.user!.id },
  });
  await prisma.signupRequest.update({
    where: { id },
    data: { status: 'APPROVED', resolvedAt: new Date(), resolvedById: req.user!.id, orgId: org.id },
  });

  if (APP_URL) {
    // if this fails, the new business is approved but stuck with no way in —
    // worth knowing about even though the code itself is safely on file
    void sendEmail({
      to: sr.email,
      subject: `You're in — set up ${sr.businessName} on Fruit Crew`,
      html: emailShell(
        `Welcome to Fruit Crew, ${escapeHtml(sr.contactName)}!`,
        `<p>${escapeHtml(sr.businessName)} is ready to go. Use the button below to create your owner login and get started.</p>`,
        { label: 'Set up your account', url: `${APP_URL}/register-manager?code=${code}` },
      ),
    }).then((r) => {
      if (!r.ok && r.error !== 'no api key') {
        alertError('admin.approveSignup', new Error(r.error), { businessName: sr.businessName, email: sr.email, code });
      }
    });
  }

  res.json({ ok: true, orgId: org.id });
});

// POST /admin/signup-requests/:id/decline
router.post('/signup-requests/:id/decline', ...requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });

  const sr = await prisma.signupRequest.findUnique({ where: { id } });
  if (!sr) return res.status(404).json({ error: 'Not found' });
  if (sr.status !== 'PENDING') return res.status(409).json({ error: 'Already decided' });

  await prisma.signupRequest.update({
    where: { id },
    data: { status: 'DENIED', resolvedAt: new Date(), resolvedById: req.user!.id },
  });
  res.json({ ok: true });
});

// GET /admin/deletion-requests?status=PENDING — the web-reachable "delete my
// account" queue (default: all)
router.get('/deletion-requests', ...requireSuperAdmin, async (req, res) => {
  const status =
    typeof req.query.status === 'string' && STATUSES.has(req.query.status)
      ? (req.query.status as RequestStatus)
      : undefined;
  const requests = await prisma.accountDeletionRequest.findMany({
    ...(status ? { where: { status } } : {}),
    orderBy: { createdAt: 'desc' },
  });
  res.json(requests);
});

// POST /admin/deletion-requests/:id/fulfill — finds the account by email and
// runs the same deletion the account holder could've done themselves from
// Profile. Can fail (e.g. sole owner of an org) — the request stays PENDING
// so it can be retried once that's sorted out by hand.
router.post('/deletion-requests/:id/fulfill', ...requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });

  const dr = await prisma.accountDeletionRequest.findUnique({ where: { id } });
  if (!dr) return res.status(404).json({ error: 'Not found' });
  if (dr.status !== 'PENDING') return res.status(409).json({ error: 'Already decided' });

  const account = await prisma.user.findUnique({ where: { email: dr.email } });
  if (!account) return res.status(404).json({ error: 'No account found with that email' });

  const result = await deleteUserAccount(account.id);
  if (!result.ok) return res.status(409).json({ error: result.error });

  await prisma.accountDeletionRequest.update({
    where: { id },
    data: { status: 'APPROVED', resolvedAt: new Date(), resolvedById: req.user!.id },
  });
  res.json({ ok: true });
});

// POST /admin/deletion-requests/:id/decline
router.post('/deletion-requests/:id/decline', ...requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });

  const dr = await prisma.accountDeletionRequest.findUnique({ where: { id } });
  if (!dr) return res.status(404).json({ error: 'Not found' });
  if (dr.status !== 'PENDING') return res.status(409).json({ error: 'Already decided' });

  await prisma.accountDeletionRequest.update({
    where: { id },
    data: { status: 'DENIED', resolvedAt: new Date(), resolvedById: req.user!.id },
  });
  res.json({ ok: true });
});

export default router;
