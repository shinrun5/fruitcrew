import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { RequestStatus } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { TRIAL_DAYS, billingEnabled, billingState, monthlyTotal, newTrialEnd } from '../lib/billing.js';
import { ADDON_PRICE } from '../lib/addons.js';
import { requireSuperAdmin } from '../lib/auth.js';
import { emailShell, escapeHtml, sendEmail } from '../lib/email.js';
import { alertError } from '../lib/errorAlert.js';
import { deleteUserAccount } from '../lib/accountDeletion.js';

const router = Router();
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
// Handed directly to a real customer (a call, a walk-in) rather than sent
// through the slower email-approval flow below, so a shorter TTL is fine —
// and registering with it (or generating a fresh one) already invalidates it
// immediately either way, see ManagerInvite.usedAt in POST /auth/register-manager.
const ONBOARDING_INVITE_TTL_MS = 5 * 24 * 60 * 60_000; // 5 days

// Most routes here are read-only: a support/debugging console for whoever
// operates the hosting, listing orgs and stores platform-wide plus the
// signup/deletion approval queues. Editing a store (its schedule, workers,
// etc.) happens through the normal manager routes — see lib/auth.ts's
// isSuperAdmin flag, which also makes those routes' store-scoping checks
// (storeIds/canManageStore) pass for any store on the platform, not just this
// router. The exceptions are POST /orgs below (onboard a business directly,
// skipping the public request-access queue) and the /signup-requests
// approve/decline actions further down. Not self-serve either way —
// isSuperAdmin is set by hand for support.

// GET /admin/orgs — every org on the platform, with basic counts
router.get('/orgs', ...requireSuperAdmin, async (_req, res) => {
  const orgs = await prisma.org.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      stores: { select: { id: true, parentStoreId: true } },
      users: { where: { role: 'OWNER' }, select: { email: true }, orderBy: { id: 'asc' } },
    },
  });
  // distinct people per org — someone linked to two of its stores is still one worker
  const links = await prisma.employeeStore.findMany({ select: { storeId: true, employeeId: true } });
  const storeToOrg = new Map(orgs.flatMap((o) => o.stores.map((s) => [s.id, o.id])));
  const peopleByOrg = new Map<number, Set<number>>();
  for (const l of links) {
    const orgId = storeToOrg.get(l.storeId);
    if (orgId == null) continue;
    (peopleByOrg.get(orgId) ?? peopleByOrg.set(orgId, new Set()).get(orgId)!).add(l.employeeId);
  }

  res.json(
    orgs.map((o) => ({
      id: o.id,
      name: o.name,
      createdAt: o.createdAt,
      owners: o.users.map((u) => u.email),
      storeCount: o.stores.length,
      // what the plan's store limit counts — sections are part of a store
      locationCount: o.stores.filter((s) => s.parentStoreId == null).length,
      storeLimit: o.storeLimit,
      employeeCount: peopleByOrg.get(o.id)?.size ?? 0,
      pausedAt: o.pausedAt,
      deletedAt: o.deletedAt,
      billing: adminBilling(o),
    })),
  );
});

function adminBilling(o: { trialEndsAt: Date | null; billingExempt: boolean; subscriptionStatus: string | null; storeLimit: number | null; addons: string[] }) {
  const state = billingState(o);
  const paying = state === 'active' || state === 'past_due';
  return {
    state,
    trialEndsAt: o.trialEndsAt,
    exempt: o.billingExempt,
    monthly: paying && o.storeLimit != null ? monthlyTotal(o.storeLimit) + ADDON_PRICE * o.addons.length : null,
    /** add-ons the subscription pays for (only meaningful while paying) */
    addons: paying ? o.addons : [],
  };
}

// GET /admin/billing — whether billing is live, and how many businesses have
// no trial clock yet (the launch-day "start trials" button, below)
router.get('/billing', ...requireSuperAdmin, async (_req, res) => {
  const withoutTrial = await prisma.org.count({
    where: { deletedAt: null, trialEndsAt: null, billingExempt: false, stripeSubscriptionId: null },
  });
  res.json({ enabled: billingEnabled(), withoutTrial });
});

// POST /admin/billing/start-trials — launch day: give every business that has
// no trial yet (they signed up while billing was off) the same 30 days a new
// one gets, starting now. Never touches a comped or already-subscribed one.
router.post('/billing/start-trials', ...requireSuperAdmin, async (_req, res) => {
  if (!billingEnabled()) return res.status(409).json({ error: 'Billing isn’t set up yet.' });
  const r = await prisma.org.updateMany({
    where: { deletedAt: null, trialEndsAt: null, billingExempt: false, stripeSubscriptionId: null },
    data: { trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000) },
  });
  res.json({ started: r.count });
});

// POST /admin/orgs/:id/trial { days } — push the trial end out by that many
// days (from today if it already ended), e.g. for a business that needs longer
router.post('/orgs/:id/trial', ...requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const days = req.body?.days;
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  if (!Number.isInteger(days) || days < 1 || days > 365) return res.status(400).json({ error: 'days must be 1–365' });
  const org = await prisma.org.findUnique({ where: { id } });
  if (!org) return res.status(404).json({ error: 'Not found' });
  const from = org.trialEndsAt && org.trialEndsAt > new Date() ? org.trialEndsAt : new Date();
  const updated = await prisma.org.update({
    where: { id },
    data: { trialEndsAt: new Date(from.getTime() + days * 86_400_000), trialReminderSentDays: null },
  });
  res.json({ trialEndsAt: updated.trialEndsAt });
});

// POST /admin/orgs/:id/exempt { exempt } — comp a business: never billed,
// never locked out for billing. Its store limit is then set by hand.
router.post('/orgs/:id/exempt', ...requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  if (typeof req.body?.exempt !== 'boolean') return res.status(400).json({ error: 'exempt must be true or false' });
  const org = await prisma.org.update({ where: { id }, data: { billingExempt: req.body.exempt } }).catch(() => null);
  if (!org) return res.status(404).json({ error: 'Not found' });
  res.json({ exempt: org.billingExempt });
});

// POST /admin/orgs/:id/pause — locks out every login in the org (e.g. for
// non-payment) until unpaused. Doesn't touch any data; cron.ts also skips a
// paused org's stores. See Org.pausedAt's schema comment.
router.post('/orgs/:id/pause', ...requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const org = await prisma.org.update({ where: { id }, data: { pausedAt: new Date() } }).catch(() => null);
  if (!org) return res.status(404).json({ error: 'Not found' });
  res.json({ pausedAt: org.pausedAt });
});

// POST /admin/orgs/:id/store-limit  { storeLimit: number | null } — how many
// stores (sections don't count) the business may have; null = no limit.
// Lowering it below what they already have keeps those stores, it just
// stops them adding more.
router.post('/orgs/:id/store-limit', ...requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const raw = req.body?.storeLimit;
  if (raw !== null && !(Number.isInteger(raw) && raw >= 1 && raw <= 1000)) {
    return res.status(400).json({ error: 'storeLimit must be a whole number from 1 to 1000, or null for no limit' });
  }
  const current = await prisma.org.findUnique({ where: { id } });
  if (!current) return res.status(404).json({ error: 'Not found' });
  // a paying business's store count is what its subscription pays for
  const state = billingState(current);
  if (state === 'active' || state === 'past_due') {
    return res.status(409).json({ error: 'This business pays per store in Stripe — its store count follows its plan.' });
  }
  const org = await prisma.org.update({ where: { id }, data: { storeLimit: raw } });
  res.json({ storeLimit: org.storeLimit });
});

// POST /admin/orgs/:id/unpause
router.post('/orgs/:id/unpause', ...requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const org = await prisma.org.update({ where: { id }, data: { pausedAt: null } }).catch(() => null);
  if (!org) return res.status(404).json({ error: 'Not found' });
  res.json({ pausedAt: org.pausedAt });
});

// POST /admin/orgs/:id/delete — same lockout as pause, plus the org drops out
// of the default admin list. Nothing is actually erased — restore below
// undoes it completely, for whenever a business comes back and settles up.
router.post('/orgs/:id/delete', ...requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const org = await prisma.org.update({ where: { id }, data: { deletedAt: new Date() } }).catch(() => null);
  if (!org) return res.status(404).json({ error: 'Not found' });
  res.json({ deletedAt: org.deletedAt });
});

// POST /admin/orgs/:id/restore
router.post('/orgs/:id/restore', ...requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const org = await prisma.org.update({ where: { id }, data: { deletedAt: null } }).catch(() => null);
  if (!org) return res.status(404).json({ error: 'Not found' });
  res.json({ deletedAt: org.deletedAt });
});

// POST /admin/orgs  { businessName, contactName?, email? } — onboard a
// business directly: same Org + OWNER ManagerInvite the signup-request
// approval flow below creates, minus needing a pending SignupRequest first
// (for a customer you're onboarding by hand — a call, a walk-in — rather
// than one who filled out the public form). Emails the welcome link only if
// a contact email is given; otherwise the code/link is just handed back to
// copy and share yourself.
router.post('/orgs', ...requireSuperAdmin, async (req, res) => {
  const businessName = typeof req.body?.businessName === 'string' ? req.body.businessName.trim() : '';
  if (!businessName) return res.status(400).json({ error: 'businessName is required' });
  const contactName = typeof req.body?.contactName === 'string' ? req.body.contactName.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';

  const org = await prisma.org.create({ data: { name: businessName, trialEndsAt: newTrialEnd() } });
  const code = randomBytes(9).toString('base64url');
  const expiresAt = new Date(Date.now() + ONBOARDING_INVITE_TTL_MS);
  const invite = await prisma.managerInvite.create({
    data: { code, orgId: org.id, role: 'OWNER', createdById: req.user!.id, expiresAt },
  });

  let emailed = false;
  if (email && APP_URL) {
    const sent = await sendEmail({
      to: email,
      subject: `You're in — set up ${businessName} on Fruit Crew`,
      html: emailShell(
        `Welcome to Fruit Crew${contactName ? `, ${escapeHtml(contactName)}` : ''}!`,
        `<p>${escapeHtml(businessName)} is ready to go. Use the button below to create your owner login and get started.</p>`,
        { label: 'Set up your account', url: `${APP_URL}/register-manager?code=${code}` },
      ),
    });
    if (sent.ok) emailed = true;
    else if (sent.error !== 'no api key') {
      alertError('admin.createOrg', new Error(sent.error), { businessName, email, code });
    }
  }

  res.status(201).json({ orgId: org.id, orgName: org.name, code: invite.code, expiresAt: invite.expiresAt, emailed });
});

// GET /admin/orgs/:id — one org's stores + who runs them. Jumping into a store
// to manage it goes through the normal /stores, /schedule, /employees routes —
// isSuperAdmin already makes those pass for any store, see the note up top.
router.get('/orgs/:id', ...requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });

  const org = await prisma.org.findUnique({ where: { id } });
  if (!org) return res.status(404).json({ error: 'Not found' });

  const [stores, people, pendingOwnerInvite] = await Promise.all([
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
    // the one unclaimed OWNER onboarding code for this org, if any — see
    // POST /orgs/:id/invite, which keeps this to at most one at a time.
    // Expired ones are included so they can be renewed (POST /orgs/:id/invite/renew)
    prisma.managerInvite.findFirst({
      where: { orgId: id, role: 'OWNER', usedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { code: true, expiresAt: true },
    }),
  ]);

  res.json({
    id: org.id,
    name: org.name,
    createdAt: org.createdAt,
    pausedAt: org.pausedAt,
    deletedAt: org.deletedAt,
    stores: stores.map((s) => ({
      id: s.id,
      name: s.name,
      parentStoreId: s.parentStoreId,
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
    pendingOwnerInvite,
  });
});

// POST /admin/orgs/:id/invite — a fresh OWNER sign-up code for an existing
// org, e.g. one created here that never got claimed because the original
// code/link wasn't saved. Same invite the POST /orgs onboarding flow above
// creates, just for an org that already exists rather than a brand new one.
// Only one OWNER invite is ever live for an org at a time — generating a new
// one retires whatever was still outstanding, so there's never more than one
// valid link floating around for someone to find their way into.
router.post('/orgs/:id/invite', ...requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const org = await prisma.org.findUnique({ where: { id }, select: { id: true } });
  if (!org) return res.status(404).json({ error: 'Not found' });

  const code = randomBytes(9).toString('base64url');
  const expiresAt = new Date(Date.now() + ONBOARDING_INVITE_TTL_MS);
  const invite = await prisma.$transaction(async (tx) => {
    await tx.managerInvite.deleteMany({ where: { orgId: id, role: 'OWNER', usedAt: null } });
    return tx.managerInvite.create({
      data: { code, orgId: org.id, role: 'OWNER', createdById: req.user!.id, expiresAt },
    });
  });
  res.status(201).json({ code: invite.code, expiresAt: invite.expiresAt });
});

// POST /admin/orgs/:id/invite/renew — pushes the org's unclaimed OWNER code
// out another ONBOARDING_INVITE_TTL_MS from now, keeping the same code, so a
// link already emailed out starts working again instead of being replaced.
router.post('/orgs/:id/invite/renew', ...requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const invite = await prisma.managerInvite.findFirst({
    where: { orgId: id, role: 'OWNER', usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!invite) return res.status(404).json({ error: 'No unclaimed owner code to renew — make a new one' });

  const updated = await prisma.managerInvite.update({
    where: { id: invite.id },
    data: { expiresAt: new Date(Date.now() + ONBOARDING_INVITE_TTL_MS) },
  });
  res.json({ code: updated.code, expiresAt: updated.expiresAt });
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

  const org = await prisma.org.create({ data: { name: sr.businessName, trialEndsAt: newTrialEnd() } });
  const code = randomBytes(9).toString('base64url');
  // longer TTL than a routine manager invite — this one's emailed to a business
  // contact who may take a while to get around to setting things up
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  await prisma.managerInvite.create({
    data: { code, orgId: org.id, role: 'OWNER', createdById: req.user!.id, expiresAt },
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
