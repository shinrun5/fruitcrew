import { Router } from 'express';
import type { Ambassador, CommissionStatus, LeadContactStatus, Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { requireSuperAdmin } from '../lib/auth.js';
import { emailShell, escapeHtml, sendEmail } from '../lib/email.js';
import { PUBLIC_URL } from '../lib/appUrl.js';
import { inBackground } from '../lib/notify.js';
import {
  addLead,
  addressKey,
  approvePayout,
  audit,
  budget,
  cancelPayout,
  cityKey,
  cleanLead,
  commissionState,
  completePayout,
  DEFAULT_TERMS,
  expireClaims,
  findLeadMatches,
  FORM_1099_CENTS,
  INVITE_DAYS,
  isPaying,
  leadStatus,
  nameKey,
  newCode,
  newInviteCode,
  phoneKey,
  placeOf,
  PayoutError,
  payableRows,
  program,
  referredStores,
  refreshReferrals,
  totalsOf,
  TRAINING_LESSONS,
  warningsFor,
} from '../lib/ambassadors.js';

// Admin › Ambassadors — platform admins only (isSuperAdmin), never a store's
// owner or manager. Every change to who's credited, what's owed or paid, and
// the program's settings goes in the audit log.
const router = Router();
router.use(...requireSuperAdmin);

const DAY = 86_400_000;
const me = (req: Express.Request) => req.user!.id;
const idOf = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const inviteUrl = (code: string) => `${PUBLIC_URL}/ambassador/join?code=${encodeURIComponent(code)}`;

async function sendInvite(a: Pick<Ambassador, 'name' | 'email'>, code: string) {
  const url = inviteUrl(code);
  const first = escapeHtml(a.name.split(' ')[0] ?? a.name);
  return sendEmail({
    to: a.email,
    subject: 'You’re in — welcome to the FruitCrew Student Ambassador program',
    html: emailShell(
      'Welcome to the ambassador program',
      `<p>Hi ${first},</p><p>Your application was approved. Make your login, read the program terms, and you can start finding businesses right away.</p><p>The link works for ${INVITE_DAYS} days.</p>`,
      { label: 'Make my login', url },
    ),
    text: `Hi ${a.name}, your FruitCrew ambassador application was approved. Make your login (the link works for ${INVITE_DAYS} days): ${url}`,
  });
}

/** A new ambassador with an invite to make their login. */
async function createAmbassador(data: { name: string; email: string; phone?: string | null; school?: string | null; area?: string | null; applicationId?: number }) {
  const invite = newInviteCode();
  const a = await prisma.ambassador.create({
    data: {
      name: data.name,
      email: data.email.toLowerCase(),
      phone: data.phone ?? null,
      school: data.school ?? null,
      area: data.area ?? null,
      code: await newCode(data.name),
      inviteCode: invite,
      inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * DAY),
      ...(data.applicationId ? { applicationId: data.applicationId } : {}),
    },
  });
  inBackground('ambassadorInvite', sendInvite(a, invite));
  return { a, inviteUrl: inviteUrl(invite) };
}

// ---- overview

// GET /admin/ambassadors/overview
router.get('/overview', async (_req, res) => {
  await refreshReferrals();
  const [ambassadors, applications, businesses, rows, payouts, followUps, review, b] = await Promise.all([
    prisma.ambassador.findMany({ select: { status: true, userId: true } }),
    prisma.ambassadorApplication.count({ where: { status: 'PENDING' } }),
    referredStores({ orgId: { not: null }, rejectedAt: null }),
    prisma.commission.findMany({ select: { status: true, kind: true, amountCents: true, grossCents: true } }),
    prisma.payout.findMany({ where: { status: 'PAID' }, select: { amountCents: true } }),
    prisma.lead.count({ where: { followUpAskById: { not: null }, mergedIntoId: null } }),
    prisma.lead.count({ where: { reviewNote: { not: null }, mergedIntoId: null } }),
    budget(),
  ]);
  const stores = businesses.flatMap((x) => x.stores.map((s) => ({ ...s, stage: x.stage })));
  const payingBusinesses = businesses.filter((x) => x.stage === 'paying').length;
  const paid = payouts.reduce((n, p) => n + p.amountCents, 0);
  const spent = paid + b.approvedUnpaidCents;
  res.json({
    ambassadors: ambassadors.length,
    activeAmbassadors: ambassadors.filter((a) => a.status === 'ACTIVE' && a.userId).length,
    pendingApplications: applications,
    businessesReferred: businesses.length,
    storesReferred: stores.length,
    storesActivated: stores.filter((s) => s.activated).length,
    payingStores: stores.filter((s) => s.stage === 'paying').length,
    revenueCents: rows.filter((r) => r.kind === 'RECURRING' && r.status !== 'REVERSED').reduce((n, r) => n + (r.grossCents ?? 0), 0),
    bountiesPaidCents: rows.filter((r) => r.kind === 'BOUNTY' && r.status === 'PAID').reduce((n, r) => n + r.amountCents, 0),
    pendingCents: rows.filter((r) => r.status === 'PENDING').reduce((n, r) => n + r.amountCents, 0),
    pendingCount: rows.filter((r) => r.status === 'PENDING').length,
    // what the program has cost (paid or owed) per business that's paying
    acquisitionCostCents: payingBusinesses ? Math.round(spent / payingBusinesses) : null,
    followUpRequests: followUps,
    leadsToReview: review,
    budget: b,
  });
});

// ---- applications

// GET /admin/ambassadors/applications?status=PENDING|APPROVED|REJECTED|all
router.get('/applications', async (req, res) => {
  const status = ['PENDING', 'APPROVED', 'REJECTED'].find((s) => s === req.query.status) as 'PENDING' | 'APPROVED' | 'REJECTED' | undefined;
  const apps = await prisma.ambassadorApplication.findMany({
    where: status ? { status } : req.query.status === 'all' ? {} : { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { ambassador: { select: { id: true } } },
  });
  res.json(apps.map(({ ambassador, ...a }) => ({ ...a, ambassadorId: ambassador?.id ?? null })));
});

// POST /admin/ambassadors/applications/:id/approve
router.post('/applications/:id/approve', async (req, res) => {
  const id = idOf(req.params.id);
  const app = id ? await prisma.ambassadorApplication.findUnique({ where: { id } }) : null;
  if (!app) return res.status(404).json({ error: 'Not found' });
  if (await prisma.ambassador.findUnique({ where: { email: app.email.toLowerCase() } })) {
    return res.status(409).json({ error: 'There’s already an ambassador with that email' });
  }
  // decide it once, even if two admins click at the same moment
  const claimed = await prisma.ambassadorApplication.updateMany({ where: { id: app.id, status: 'PENDING' }, data: { status: 'APPROVED', decidedAt: new Date(), decidedById: me(req) } });
  if (claimed.count === 0) return res.status(409).json({ error: 'That application was already decided' });
  const made = await createAmbassador({ name: app.name, email: app.email, school: app.school, area: app.area, applicationId: app.id });
  await audit(me(req), 'application.approve', { ambassadorId: made.a.id }, { applicationId: app.id });
  res.status(201).json({ ambassadorId: made.a.id, inviteUrl: made.inviteUrl });
});

// POST /admin/ambassadors/applications/:id/reject { note? }
router.post('/applications/:id/reject', async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  const note = text(req.body?.note, 500);
  const done = await prisma.ambassadorApplication.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REJECTED', decidedAt: new Date(), decidedById: me(req), decisionNote: note } });
  if (done.count === 0) return res.status(409).json({ error: 'That application was already decided' });
  await audit(me(req), 'application.reject', {}, { applicationId: id, note });
  res.json({ ok: true });
});

// ---- ambassadors

// GET /admin/ambassadors — everyone, with how they're doing
router.get('/', async (_req, res) => {
  const [list, rows, claims, contacts, lastContacts, businesses] = await Promise.all([
    prisma.ambassador.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.commission.findMany({ select: { ambassadorId: true, status: true, availableAt: true, payoutId: true, kind: true, amountCents: true, grossCents: true } }),
    prisma.leadClaim.groupBy({ by: ['ambassadorId'], where: { endedAt: null, expiresAt: { gte: new Date() } }, _count: true }),
    prisma.leadContact.groupBy({ by: ['ambassadorId'], where: { contactedAt: { gte: new Date(Date.now() - 30 * DAY) } }, _count: true }),
    prisma.leadContact.groupBy({ by: ['ambassadorId'], _max: { contactedAt: true } }),
    referredStores({}),
  ]);
  const now = new Date();
  res.json(
    list.map((a) => {
      const mine = businesses.filter((b) => b.r.ambassadorId === a.id && b.stage !== 'notCredited');
      const stores = mine.flatMap((b) => b.stores.map((s) => ({ ...s, business: b.name, stage: b.stage })));
      const own = rows.filter((r) => r.ambassadorId === a.id);
      const t = totalsOf(own, now);
      return {
        id: a.id,
        name: a.name,
        email: a.email,
        school: a.school,
        code: a.code,
        status: a.status,
        hasLogin: !!a.userId,
        businesses: mine.length,
        stores: stores.length,
        activated: stores.filter((s) => s.activated).length,
        paying: stores.filter((s) => s.stage === 'paying').length,
        storeList: stores.map((s) => ({ storeId: s.storeId, name: s.name, business: s.business, stage: s.stage, activated: s.activated })),
        // what their stores have paid FruitCrew (the payments their share came from)
        revenueCents: own.filter((r) => r.kind === 'RECURRING' && r.status !== 'REVERSED').reduce((n, r) => n + (r.grossCents ?? 0), 0),
        openClaims: claims.find((c) => c.ambassadorId === a.id)?._count ?? 0,
        contacts30d: contacts.find((c) => c.ambassadorId === a.id)?._count ?? 0,
        lastContactAt: lastContacts.find((c) => c.ambassadorId === a.id)?._max.contactedAt ?? null,
        trainingDone: a.trainingDone.length,
        trainingTotal: TRAINING_LESSONS.length,
        earnedCents: t.lifetime,
        pendingCents: t.pendingBounties + t.pendingCommissions,
        paidCents: t.paid,
        payableCents: rows.filter((r) => r.ambassadorId === a.id && commissionState(r, now) === 'payable').reduce((n, r) => n + r.amountCents, 0),
      };
    }),
  );
});

// POST /admin/ambassadors { name, email, phone?, school?, area? } — add someone directly
router.post('/', async (req, res) => {
  const name = text(req.body?.name, 100);
  const email = text(req.body?.email, 200)?.toLowerCase() ?? null;
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Name and a valid email are required' });
  if (await prisma.ambassador.findUnique({ where: { email } })) return res.status(409).json({ error: 'There’s already an ambassador with that email' });
  const made = await createAmbassador({ name, email, phone: text(req.body?.phone, 40), school: text(req.body?.school, 120), area: text(req.body?.area, 120) });
  await audit(me(req), 'ambassador.create', { ambassadorId: made.a.id });
  res.status(201).json({ id: made.a.id, inviteUrl: made.inviteUrl });
});

// GET /admin/ambassadors/people/:id — everything about one ambassador
router.get('/people/:id', async (req, res) => {
  const id = idOf(req.params.id);
  const a = id ? await prisma.ambassador.findUnique({ where: { id }, include: { application: true, termsAcceptances: { orderBy: { version: 'desc' } } } }) : null;
  if (!a) return res.status(404).json({ error: 'Not found' });
  await refreshReferrals({ ambassadorId: a.id });
  const now = new Date();
  const [businesses, rows, payouts, claims, contacts, log, payable] = await Promise.all([
    referredStores({ ambassadorId: a.id }),
    prisma.commission.findMany({ where: { ambassadorId: a.id }, orderBy: { createdAt: 'desc' }, include: { referral: { select: { org: { select: { name: true } }, signupRequest: { select: { businessName: true } } } } } }),
    prisma.payout.findMany({ where: { ambassadorId: a.id }, orderBy: { approvedAt: 'desc' } }),
    prisma.leadClaim.findMany({ where: { ambassadorId: a.id }, include: { lead: { select: { id: true, name: true, city: true } } }, orderBy: { claimedAt: 'desc' }, take: 50 }),
    prisma.leadContact.findMany({ where: { ambassadorId: a.id }, include: { lead: { select: { id: true, name: true } } }, orderBy: { contactedAt: 'desc' }, take: 50 }),
    prisma.ambassadorAudit.findMany({ where: { ambassadorId: a.id }, orderBy: { at: 'desc' }, take: 50 }),
    payableRows(a.id, now),
  ]);
  const prog = await program();
  res.json({
    ambassador: {
      ...a,
      hasLogin: !!a.userId,
      inviteUrl: a.inviteCode && !a.userId ? inviteUrl(a.inviteCode) : null,
      termsCurrent: a.termsAcceptances.some((t) => t.version === prog.termsVersion),
    },
    totals: totalsOf(rows, now),
    payableCents: payable.reduce((n, r) => n + r.amountCents, 0),
    // what went out to them this calendar year — a 1099-NEC is due past FORM_1099_CENTS
    paidThisYearCents: payouts
      .filter((p) => p.status === 'PAID' && p.paidAt && p.paidAt.getUTCFullYear() === now.getUTCFullYear())
      .reduce((n, p) => n + p.amountCents, 0),
    form1099Cents: FORM_1099_CENTS,
    businesses: businesses.map((b) => ({ id: b.r.id, name: b.name, stage: b.stage, verified: !!b.r.verifiedAt, rejected: !!b.r.rejectedAt, since: b.r.createdAt, stores: b.stores })),
    commissions: rows.map((c) => ({
      id: c.id,
      kind: c.kind,
      status: c.status,
      state: commissionState(c, now),
      amountCents: c.amountCents,
      business: c.referral?.org?.name ?? c.referral?.signupRequest?.businessName ?? null,
      store: c.storeName,
      memo: c.memo,
      flags: c.flags,
      periods: c.periods,
      createdAt: c.createdAt,
      availableAt: c.availableAt,
      payoutId: c.payoutId,
    })),
    payouts,
    claims: claims.map((c) => ({ id: c.id, lead: c.lead, claimedAt: c.claimedAt, expiresAt: c.expiresAt, endedAt: c.endedAt, endReason: c.endReason, open: !c.endedAt && c.expiresAt >= now })),
    contacts: contacts.map((c) => ({ id: c.id, lead: c.lead, contactedAt: c.contactedAt, method: c.method, outcome: c.outcome, notes: c.notes })),
    audit: log,
  });
});

// PUT /admin/ambassadors/people/:id { status?, isAdult?, w9Received?, notes?, phone?, school?, area? }
router.put('/people/:id', async (req, res) => {
  const id = idOf(req.params.id);
  const a = id ? await prisma.ambassador.findUnique({ where: { id } }) : null;
  if (!a) return res.status(404).json({ error: 'Not found' });
  const b = req.body ?? {};
  const data: Prisma.AmbassadorUpdateInput = {};
  if (b.status !== undefined) {
    if (!['ACTIVE', 'SUSPENDED', 'DEACTIVATED'].includes(b.status)) return res.status(400).json({ error: 'Bad status' });
    data.status = b.status;
  }
  for (const k of ['isAdult', 'w9Received'] as const) if (typeof b[k] === 'boolean') data[k] = b[k];
  for (const [k, max] of [['notes', 2000], ['phone', 40], ['school', 120], ['area', 120]] as const) if (b[k] !== undefined) data[k] = text(b[k], max);
  const updated = await prisma.ambassador.update({ where: { id: a.id }, data });
  // off the program: whatever they were holding is free for others
  if (data.status && data.status !== 'ACTIVE') {
    await prisma.leadClaim.updateMany({ where: { ambassadorId: a.id, endedAt: null }, data: { endedAt: new Date(), endReason: 'admin' } });
  }
  const changed = Object.fromEntries(Object.keys(data).map((k) => [k, { from: a[k as keyof Ambassador], to: updated[k as keyof Ambassador] }]));
  await audit(me(req), 'ambassador.update', { ambassadorId: a.id }, JSON.parse(JSON.stringify(changed)));
  res.json(updated);
});

// POST /admin/ambassadors/people/:id/invite — a fresh link to make their login
router.post('/people/:id/invite', async (req, res) => {
  const id = idOf(req.params.id);
  const a = id ? await prisma.ambassador.findUnique({ where: { id } }) : null;
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (a.userId) return res.status(409).json({ error: 'They already have a login' });
  const invite = newInviteCode();
  await prisma.ambassador.update({ where: { id: a.id }, data: { inviteCode: invite, inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * DAY) } });
  inBackground('ambassadorInvite', sendInvite(a, invite));
  await audit(me(req), 'ambassador.invite', { ambassadorId: a.id });
  res.json({ inviteUrl: inviteUrl(invite) });
});

// ---- the lead list

const CONTACT_STATUSES: LeadContactStatus[] = ['NEW', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP', 'DECLINED'];

// GET /admin/ambassadors/leads?q=&filter=review|followUp|claimed|doNotContact|customer&page=
router.get('/leads', async (req, res) => {
  await expireClaims();
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const page = Math.max(0, Number(req.query.page) || 0);
  const words = q.split(/\s+/).filter(Boolean).slice(0, 5);
  const filter = String(req.query.filter ?? '');
  const where: Prisma.LeadWhereInput = {
    mergedIntoId: null,
    ...(filter === 'review' ? { reviewNote: { not: null } } : {}),
    ...(filter === 'followUp' ? { followUpAskById: { not: null } } : {}),
    ...(filter === 'claimed' ? { claims: { some: { endedAt: null } } } : {}),
    ...(filter === 'doNotContact' ? { doNotContact: true } : {}),
    ...(filter === 'customer' ? { orgId: { not: null } } : {}),
    AND: words.map((w) => ({
      OR: [
        { name: { contains: w, mode: 'insensitive' as const } },
        { address: { contains: w, mode: 'insensitive' as const } },
        { city: { contains: w, mode: 'insensitive' as const } },
        { zip: { startsWith: w } },
        { category: { contains: w, mode: 'insensitive' as const } },
        ...(w.replace(/\D/g, '').length >= 3 ? [{ phone: { contains: w.replace(/\D/g, '') } }] : []),
      ],
    })),
  };
  const [total, leads] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: page * 50,
      take: 50,
      include: { claims: { where: { endedAt: null }, include: { ambassador: { select: { id: true, name: true } } } }, _count: { select: { contacts: true } } },
    }),
  ]);
  const orgs = await prisma.org.findMany({ where: { id: { in: leads.map((l) => l.orgId).filter((x): x is number => x != null) } }, select: { id: true, name: true, trialEndsAt: true, billingExempt: true, subscriptionStatus: true } });
  const askers = await prisma.ambassador.findMany({ where: { id: { in: leads.flatMap((l) => [l.followUpAskById, l.reopenedForId]).filter((x): x is number => x != null) } }, select: { id: true, name: true } });
  res.json({
    total,
    page,
    pageSize: 50,
    leads: leads.map(({ claims, _count, ...l }) => {
      const org = orgs.find((o) => o.id === l.orgId);
      return {
        ...l,
        status: leadStatus(l, claims[0]?.ambassadorId ?? null, null, org ? isPaying(org) : null),
        heldBy: claims[0] ? { id: claims[0].ambassador.id, name: claims[0].ambassador.name, expiresAt: claims[0].expiresAt } : null,
        customer: org?.name ?? null,
        contacts: _count.contacts,
        followUpAskBy: askers.find((x) => x.id === l.followUpAskById)?.name ?? null,
        reopenedFor: askers.find((x) => x.id === l.reopenedForId)?.name ?? null,
      };
    }),
  });
});

// GET /admin/ambassadors/leads/:id — one lead's whole story
router.get('/leads/:id', async (req, res) => {
  const id = idOf(req.params.id);
  const lead = id
    ? await prisma.lead.findUnique({
        where: { id },
        include: {
          claims: { include: { ambassador: { select: { id: true, name: true } } }, orderBy: { claimedAt: 'desc' } },
          contacts: { include: { ambassador: { select: { id: true, name: true } } }, orderBy: { contactedAt: 'desc' } },
        },
      })
    : null;
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const [matches, log, org] = await Promise.all([
    findLeadMatches(placeOf(lead), lead.id),
    prisma.ambassadorAudit.findMany({ where: { leadId: lead.id }, orderBy: { at: 'desc' }, take: 50 }),
    lead.orgId ? prisma.org.findUnique({ where: { id: lead.orgId }, select: { name: true } }) : null,
  ]);
  res.json({ lead, customer: org?.name ?? null, matches: matches.map((m) => ({ id: m.lead.id, name: m.lead.name, address: m.lead.address, city: m.lead.city, how: m.how })), audit: log });
});

// POST /admin/ambassadors/leads { name, address?, city?, state?, zip?, phone?, category?, placeId? }
router.post('/leads', async (req, res) => {
  const input = cleanLead(req.body ?? {});
  if (!input) return res.status(400).json({ error: 'Give the business’s name' });
  const r = await addLead(input, 'IMPORT', { allowPossible: true });
  if (r.status === 'customer') return res.status(409).json({ error: `That’s an existing FruitCrew business (${r.name})` });
  if (r.status === 'duplicate') return res.status(409).json({ error: 'Already on the list', leadId: r.lead.id });
  if (r.status !== 'created') return res.status(409).json({ error: 'Possible duplicate' });
  await audit(me(req), 'lead.create', { leadId: r.lead.id });
  res.status(201).json(r.lead);
});

const HISTORY_STATUS: Record<string, { status?: LeadContactStatus; dnc?: boolean }> = {
  contacted: { status: 'CONTACTED' },
  pitched: { status: 'CONTACTED' },
  interested: { status: 'INTERESTED' },
  'follow up': { status: 'FOLLOW_UP' },
  followup: { status: 'FOLLOW_UP' },
  'follow-up': { status: 'FOLLOW_UP' },
  declined: { status: 'DECLINED' },
  'not interested': { status: 'DECLINED' },
  'do not contact': { status: 'DECLINED', dnc: true },
  dnc: { status: 'DECLINED', dnc: true },
};
const RANK: Record<LeadContactStatus, number> = { NEW: 0, CONTACTED: 1, INTERESTED: 2, FOLLOW_UP: 2, DECLINED: 3 };

// POST /admin/ambassadors/leads/import { rows: [{ name, address, city, state, zip, phone, category, placeId, status?, lastContacted?, notes? }] }
// Businesses to approach, and outreach FruitCrew already did — a row that's
// already on the list adds its history there instead of a second entry.
router.post('/leads/import', async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? (req.body.rows as Record<string, unknown>[]).slice(0, 2000) : null;
  if (!rows) return res.status(400).json({ error: 'rows must be an array' });
  const out = { created: 0, updated: 0, customers: 0, invalid: 0, toReview: 0 };
  for (const row of rows) {
    const input = cleanLead(row);
    if (!input) {
      out.invalid++;
      continue;
    }
    const hist = HISTORY_STATUS[String(row.status ?? '').trim().toLowerCase()];
    const r = await addLead(input, hist ? 'HISTORY' : 'IMPORT', { allowPossible: true });
    if (r.status === 'customer') {
      out.customers++;
      continue;
    }
    if (r.status !== 'created' && r.status !== 'duplicate') continue;
    if (r.status === 'created') {
      out.created++;
      if (r.lead.reviewNote) out.toReview++;
    } else out.updated++;
    if (!hist) continue;
    const lead = r.lead;
    const when = typeof row.lastContacted === 'string' && !Number.isNaN(Date.parse(row.lastContacted)) ? new Date(row.lastContacted) : new Date();
    const notes = text(row.notes, 1000);
    await prisma.leadContact.create({
      data: {
        leadId: lead.id,
        contactedAt: when,
        method: 'OTHER',
        outcome: hist.dnc ? 'DO_NOT_CONTACT' : hist.status === 'INTERESTED' ? 'INTERESTED' : hist.status === 'FOLLOW_UP' ? 'FOLLOW_UP' : hist.status === 'DECLINED' ? 'DECLINED' : 'SPOKE',
        notes: notes ? `Imported: ${notes}` : 'Imported from earlier outreach',
      },
    });
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        ...(hist.status && RANK[hist.status] >= RANK[lead.contactStatus] ? { contactStatus: hist.status } : {}),
        ...(hist.dnc ? { doNotContact: true, dncReason: lead.dncReason ?? 'From earlier outreach' } : {}),
        lastContactAt: !lead.lastContactAt || lead.lastContactAt < when ? when : lead.lastContactAt,
      },
    });
  }
  await audit(me(req), 'lead.import', {}, out);
  res.json(out);
});

// PUT /admin/ambassadors/leads/:id { name?, address?, city?, state?, zip?, phone?, category?, doNotContact?, dncReason?, contactStatus?, clearReview? }
router.put('/leads/:id', async (req, res) => {
  const id = idOf(req.params.id);
  const lead = id ? await prisma.lead.findUnique({ where: { id } }) : null;
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const b = req.body ?? {};
  const pick = (k: 'address' | 'city' | 'state' | 'zip' | 'phone' | 'category') => (b[k] !== undefined ? b[k] : lead[k]);
  const merged = cleanLead({ name: b.name ?? lead.name, address: pick('address'), city: pick('city'), state: pick('state'), zip: pick('zip'), phone: pick('phone'), category: pick('category'), placeId: lead.placeId });
  if (!merged) return res.status(400).json({ error: 'Give the business’s name' });
  const data: Prisma.LeadUpdateInput = {
    name: merged.name,
    nameKey: nameKey(merged.name),
    address: merged.address ?? null,
    addressKey: addressKey(merged.address),
    city: merged.city ?? null,
    cityKey: cityKey(merged.city),
    state: merged.state ?? null,
    zip: merged.zip ?? null,
    phone: merged.phone ? phoneKey(merged.phone) : null,
    category: merged.category ?? null,
  };
  if (typeof b.doNotContact === 'boolean') {
    data.doNotContact = b.doNotContact;
    data.dncReason = b.doNotContact ? (text(b.dncReason, 200) ?? 'Marked by FruitCrew') : null;
  }
  if (b.contactStatus !== undefined) {
    if (!CONTACT_STATUSES.includes(b.contactStatus)) return res.status(400).json({ error: 'Bad status' });
    data.contactStatus = b.contactStatus;
  }
  if (b.clearReview === true) data.reviewNote = null;
  const updated = await prisma.lead.update({ where: { id: lead.id }, data });
  if (data.doNotContact === true) await prisma.leadClaim.updateMany({ where: { leadId: lead.id, endedAt: null }, data: { endedAt: new Date(), endReason: 'doNotContact' } });
  await audit(me(req), 'lead.update', { leadId: lead.id }, JSON.parse(JSON.stringify({ changes: b })));
  res.json(updated);
});

// POST /admin/ambassadors/leads/:id/assign { ambassadorId: number | null, note? } — hand it to someone, or free it
router.post('/leads/:id/assign', async (req, res) => {
  const id = idOf(req.params.id);
  const lead = id ? await prisma.lead.findUnique({ where: { id } }) : null;
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const to = req.body?.ambassadorId == null ? null : idOf(req.body.ambassadorId);
  if (req.body?.ambassadorId != null && !to) return res.status(400).json({ error: 'Bad ambassador' });
  const target = to ? await prisma.ambassador.findUnique({ where: { id: to } }) : null;
  if (to && (!target || target.status !== 'ACTIVE')) return res.status(400).json({ error: 'Pick an active ambassador' });
  const prog = await program();
  const before = await prisma.leadClaim.findFirst({ where: { leadId: lead.id, endedAt: null } });
  await prisma.$transaction(async (tx) => {
    await tx.leadClaim.updateMany({ where: { leadId: lead.id, endedAt: null }, data: { endedAt: new Date(), endReason: to ? 'reassigned' : 'admin' } });
    if (to) await tx.leadClaim.create({ data: { leadId: lead.id, ambassadorId: to, expiresAt: new Date(Date.now() + prog.claimDays * DAY) } });
  });
  await audit(me(req), to ? 'lead.reassign' : 'lead.release', { leadId: lead.id, ambassadorId: to ?? before?.ambassadorId ?? null }, { from: before?.ambassadorId ?? null, to, note: text(req.body?.note, 300) });
  res.json({ ok: true });
});

// POST /admin/ambassadors/leads/:id/follow-up { approve: boolean, ambassadorId? } — answer a student's "can I try again?"
router.post('/leads/:id/follow-up', async (req, res) => {
  const id = idOf(req.params.id);
  const lead = id ? await prisma.lead.findUnique({ where: { id } }) : null;
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const forId = req.body?.ambassadorId != null ? idOf(req.body.ambassadorId) : lead.followUpAskById;
  if (req.body?.approve && !forId) return res.status(400).json({ error: 'Nobody asked — pick an ambassador' });
  await prisma.lead.update({
    where: { id: lead.id },
    data: { ...(req.body?.approve ? { reopenedForId: forId } : {}), followUpAskById: null, followUpAskAt: null, followUpAskNote: null },
  });
  await audit(me(req), req.body?.approve ? 'lead.followUpApprove' : 'lead.followUpDeny', { leadId: lead.id, ambassadorId: forId ?? null });
  res.json({ ok: true });
});

// POST /admin/ambassadors/leads/:id/merge { intoId } — fold a duplicate into the real entry, history and all
router.post('/leads/:id/merge', async (req, res) => {
  const id = idOf(req.params.id);
  const intoId = idOf(req.body?.intoId);
  if (!id || !intoId || id === intoId) return res.status(400).json({ error: 'Pick the entry to keep' });
  const [from, into] = await Promise.all([prisma.lead.findUnique({ where: { id } }), prisma.lead.findUnique({ where: { id: intoId } })]);
  if (!from || !into || from.mergedIntoId || into.mergedIntoId) return res.status(404).json({ error: 'Not found' });
  await prisma.$transaction(async (tx) => {
    // the duplicate's open claim goes; its history moves over
    await tx.leadClaim.updateMany({ where: { leadId: from.id, endedAt: null }, data: { endedAt: new Date(), endReason: 'admin' } });
    await tx.leadClaim.updateMany({ where: { leadId: from.id }, data: { leadId: into.id } });
    await tx.leadContact.updateMany({ where: { leadId: from.id }, data: { leadId: into.id } });
    await tx.lead.update({
      where: { id: into.id },
      data: {
        contactStatus: RANK[from.contactStatus] > RANK[into.contactStatus] ? from.contactStatus : into.contactStatus,
        doNotContact: into.doNotContact || from.doNotContact,
        dncReason: into.dncReason ?? from.dncReason,
        orgId: into.orgId ?? from.orgId,
        lastContactAt: [into.lastContactAt, from.lastContactAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
        phone: into.phone ?? from.phone,
        address: into.address ?? from.address,
        addressKey: into.addressKey ?? from.addressKey,
      },
    });
    await tx.lead.update({ where: { id: from.id }, data: { mergedIntoId: into.id, reviewNote: null, placeId: null } });
  });
  await audit(me(req), 'lead.merge', { leadId: into.id }, { mergedFrom: from.id });
  res.json({ ok: true });
});

// ---- referrals

// GET /admin/ambassadors/referrals?filter=review|suspicious|all
router.get('/referrals', async (req, res) => {
  await refreshReferrals();
  const businesses = await referredStores({});
  const withChecks = await Promise.all(
    businesses.map(async (b) => {
      const full = await prisma.referral.findUniqueOrThrow({ where: { id: b.r.id }, include: { ambassador: true, signupRequest: true, org: true } });
      const warnings = b.r.rejectedAt ? [] : await warningsFor(full);
      const lead = b.r.leadId ? await prisma.lead.findUnique({ where: { id: b.r.leadId }, select: { id: true, name: true, city: true } }) : null;
      return {
        id: b.r.id,
        name: b.name,
        stage: b.stage,
        ambassador: { id: full.ambassador.id, name: full.ambassador.name, code: full.ambassador.code },
        source: b.r.source,
        since: b.r.createdAt,
        orgId: b.r.orgId,
        checks: { foundOnline: b.r.foundOnline, phoneChecked: b.r.phoneChecked, ownerConfirmed: b.r.ownerConfirmed },
        verifiedAt: b.r.verifiedAt,
        rejectedAt: b.r.rejectedAt,
        rejectNote: b.r.rejectNote,
        terms: { bountyCents: b.r.bountyCents, rateBps: b.r.rateBps, extraStoreRateBps: b.r.extraStoreRateBps, maxPaidPeriods: b.r.maxPaidPeriods },
        signup: full.signupRequest ? { contactName: full.signupRequest.contactName, email: full.signupRequest.email, phone: full.signupRequest.phone, address: full.signupRequest.address, website: full.signupRequest.website } : null,
        lead,
        warnings,
        stores: b.stores,
      };
    }),
  );
  const filter = String(req.query.filter ?? 'all');
  res.json(
    withChecks.filter((r) =>
      filter === 'review' ? !r.verifiedAt && !r.rejectedAt && r.orgId != null : filter === 'suspicious' ? r.warnings.length > 0 && !r.rejectedAt : true,
    ),
  );
});

/** Unpaid rows leave a payout that hasn't gone out yet (its total shrinks, or it's canceled when empty). */
async function unpay(tx: Prisma.TransactionClient, where: Prisma.CommissionWhereInput) {
  const rows = await tx.commission.findMany({ where: { ...where, payout: { status: 'APPROVED' } }, select: { payoutId: true } });
  await tx.commission.updateMany({ where: { ...where, payout: { status: 'APPROVED' } }, data: { payoutId: null } });
  for (const pid of new Set(rows.map((r) => r.payoutId!))) {
    const sum = await tx.commission.aggregate({ where: { payoutId: pid }, _sum: { amountCents: true } });
    const amount = sum._sum.amountCents ?? 0;
    await tx.payout.update({ where: { id: pid }, data: amount > 0 ? { amountCents: amount } : { amountCents: 0, status: 'CANCELED', canceledAt: new Date() } });
    if (amount <= 0) await tx.commission.updateMany({ where: { payoutId: pid }, data: { payoutId: null } });
  }
}

// PUT /admin/ambassadors/referrals/:id { foundOnline?, phoneChecked?, ownerConfirmed?, verify?, reject?: { note } | false, ambassadorId?, reason? }
router.put('/referrals/:id', async (req, res) => {
  const id = idOf(req.params.id);
  const r = id ? await prisma.referral.findUnique({ where: { id } }) : null;
  if (!r) return res.status(404).json({ error: 'Not found' });
  const b = req.body ?? {};
  const data: Prisma.ReferralUncheckedUpdateInput = {};
  for (const k of ['foundOnline', 'phoneChecked', 'ownerConfirmed'] as const) if (typeof b[k] === 'boolean') data[k] = b[k];
  if (b.verify === true) {
    if (!r.orgId) return res.status(409).json({ error: 'Approve the business’s sign-up first' });
    data.verifiedAt = new Date();
    data.verifiedById = me(req);
    data.rejectedAt = null;
    data.rejectNote = null;
  }
  if (b.verify === false) data.verifiedAt = null;
  if (b.reject && typeof b.reject === 'object') {
    data.rejectedAt = new Date();
    data.rejectNote = text(b.reject.note, 500) ?? 'Not credited';
    data.verifiedAt = null;
  }
  if (b.reject === false) {
    data.rejectedAt = null;
    data.rejectNote = null;
  }
  if (b.ambassadorId != null) {
    const target = idOf(b.ambassadorId) ? await prisma.ambassador.findUnique({ where: { id: idOf(b.ambassadorId)! } }) : null;
    if (!target) return res.status(400).json({ error: 'Pick an ambassador' });
    if (!text(b.reason, 500)) return res.status(400).json({ error: 'Say why the credit is moving' });
    data.ambassadorId = target.id;
  }
  await prisma.$transaction(async (tx) => {
    await tx.referral.update({ where: { id: r.id }, data });
    const unpaid: Prisma.CommissionWhereInput = { referralId: r.id, status: { in: ['PENDING', 'APPROVED'] } };
    if (data.rejectedAt) {
      await unpay(tx, unpaid);
      await tx.commission.updateMany({ where: unpaid, data: { status: 'REJECTED', decidedAt: new Date(), decidedById: me(req), decisionNote: data.rejectNote as string } });
    }
    if (data.verifiedAt instanceof Date) {
      // payments waiting only for this check can go ahead
      await tx.commission.updateMany({
        where: { referralId: r.id, kind: 'RECURRING', status: 'PENDING', flags: 'business not verified yet' },
        data: { status: 'APPROVED', flags: null, decidedAt: new Date(), decidedById: me(req) },
      });
    }
    if (data.ambassadorId) {
      // what hasn't been paid follows the credit; what was paid stays with who got it
      await unpay(tx, unpaid);
      await tx.commission.updateMany({ where: unpaid, data: { ambassadorId: data.ambassadorId as number } });
    }
  });
  await audit(me(req), 'referral.update', { referralId: r.id, ambassadorId: r.ambassadorId }, JSON.parse(JSON.stringify({ changes: b })));
  res.json({ ok: true });
});

// POST /admin/ambassadors/referrals { orgId, ambassadorId, reason } — credit a business by hand (a disputed or missed code)
router.post('/referrals', async (req, res) => {
  const orgId = idOf(req.body?.orgId);
  const ambassadorId = idOf(req.body?.ambassadorId);
  const reason = text(req.body?.reason, 500);
  if (!orgId || !ambassadorId || !reason) return res.status(400).json({ error: 'Pick the business and the ambassador, and say why' });
  const [org, a, existing] = await Promise.all([
    prisma.org.findUnique({ where: { id: orgId } }),
    prisma.ambassador.findUnique({ where: { id: ambassadorId } }),
    prisma.referral.findUnique({ where: { orgId } }),
  ]);
  if (!org || !a) return res.status(404).json({ error: 'Not found' });
  if (existing) return res.status(409).json({ error: 'That business is already credited — change who it’s credited to instead' });
  const prog = await program();
  const r = await prisma.referral.create({
    data: { ambassadorId, orgId, source: 'admin', bountyCents: prog.bountyCents, rateBps: prog.rateBps, extraStoreRateBps: prog.extraStoreRateBps, maxPaidPeriods: prog.maxPaidPeriods },
  });
  await audit(me(req), 'referral.create', { referralId: r.id, ambassadorId }, { orgId, reason });
  res.status(201).json(r);
});

// ---- commissions

// GET /admin/ambassadors/commissions?status=&kind=
router.get('/commissions', async (req, res) => {
  await refreshReferrals();
  const status = ['PENDING', 'APPROVED', 'PAID', 'REJECTED', 'REVERSED'].find((s) => s === req.query.status) as CommissionStatus | undefined;
  const kind = ['BOUNTY', 'RECURRING', 'ADJUSTMENT'].find((k) => k === req.query.kind) as 'BOUNTY' | 'RECURRING' | 'ADJUSTMENT' | undefined;
  const rows = await prisma.commission.findMany({
    where: { ...(status ? { status } : {}), ...(kind ? { kind } : {}) },
    include: { ambassador: { select: { id: true, name: true } }, referral: { select: { verifiedAt: true, org: { select: { name: true } }, signupRequest: { select: { businessName: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const now = new Date();
  res.json(
    rows.map((c) => ({
      id: c.id,
      kind: c.kind,
      status: c.status,
      state: commissionState(c, now),
      amountCents: c.amountCents,
      grossCents: c.grossCents,
      ambassador: c.ambassador,
      business: c.referral?.org?.name ?? c.referral?.signupRequest?.businessName ?? null,
      verified: !!c.referral?.verifiedAt,
      store: c.storeName,
      memo: c.memo,
      flags: c.flags,
      periods: c.periods,
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
      createdAt: c.createdAt,
      availableAt: c.availableAt,
      decisionNote: c.decisionNote,
      payoutId: c.payoutId,
    })),
  );
});

// POST /admin/ambassadors/commissions/approve { ids } — approve pending rewards (their business must be verified)
router.post('/commissions/approve', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(idOf).filter((x): x is number => x != null).slice(0, 500) : [];
  if (!ids.length) return res.status(400).json({ error: 'Pick what to approve' });
  const rows = await prisma.commission.findMany({ where: { id: { in: ids } }, include: { referral: { select: { verifiedAt: true, rejectedAt: true } } } });
  const approved: number[] = [];
  const skipped: { id: number; reason: string }[] = [];
  for (const c of rows) {
    if (c.status !== 'PENDING') skipped.push({ id: c.id, reason: 'not pending' });
    else if (c.referral && (!c.referral.verifiedAt || c.referral.rejectedAt)) skipped.push({ id: c.id, reason: 'verify the business first' });
    else {
      const done = await prisma.commission.updateMany({ where: { id: c.id, status: 'PENDING' }, data: { status: 'APPROVED', decidedAt: new Date(), decidedById: me(req) } });
      if (done.count) {
        approved.push(c.id);
        await audit(me(req), 'commission.approve', { commissionId: c.id, ambassadorId: c.ambassadorId, referralId: c.referralId }, { amountCents: c.amountCents, kind: c.kind });
      }
    }
  }
  res.json({ approved, skipped });
});

// POST /admin/ambassadors/commissions/:id/reject { note }
router.post('/commissions/:id/reject', async (req, res) => {
  const id = idOf(req.params.id);
  const note = text(req.body?.note, 500);
  if (!id || !note) return res.status(400).json({ error: 'Say why' });
  const c = await prisma.commission.findUnique({ where: { id }, include: { payout: true } });
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.status !== 'PENDING' && c.status !== 'APPROVED') return res.status(409).json({ error: 'Only pending or unpaid rewards can be rejected' });
  if (c.payout?.status === 'PAID') return res.status(409).json({ error: 'That was already paid out' });
  await prisma.$transaction(async (tx) => {
    await unpay(tx, { id: c.id });
    await tx.commission.update({ where: { id: c.id }, data: { status: 'REJECTED', decidedAt: new Date(), decidedById: me(req), decisionNote: note } });
  });
  await audit(me(req), 'commission.reject', { commissionId: c.id, ambassadorId: c.ambassadorId, referralId: c.referralId }, { note, amountCents: c.amountCents });
  res.json({ ok: true });
});

// ---- payouts

// GET /admin/ambassadors/payouts — sent, waiting to be sent, and who has money ready
router.get('/payouts', async (_req, res) => {
  const now = new Date();
  const [payouts, ready, people] = await Promise.all([
    prisma.payout.findMany({ include: { ambassador: { select: { id: true, name: true, email: true } }, _count: { select: { commissions: true } } }, orderBy: { approvedAt: 'desc' }, take: 300 }),
    prisma.commission.groupBy({ by: ['ambassadorId'], where: { status: 'APPROVED', payoutId: null, availableAt: { lte: now } }, _sum: { amountCents: true } }),
    prisma.ambassador.findMany({ select: { id: true, name: true, isAdult: true, w9Received: true } }),
  ]);
  res.json({
    payouts: payouts.map(({ _count, ...p }) => ({ ...p, rows: _count.commissions })),
    ready: ready
      .filter((r) => (r._sum.amountCents ?? 0) > 0)
      .map((r) => {
        const a = people.find((x) => x.id === r.ambassadorId)!;
        return { ambassadorId: a.id, name: a.name, amountCents: r._sum.amountCents ?? 0, canPay: a.isAdult && a.w9Received };
      }),
  });
});

// POST /admin/ambassadors/payouts { ambassadorId } — approve paying everything payable
router.post('/payouts', async (req, res) => {
  const ambassadorId = idOf(req.body?.ambassadorId);
  if (!ambassadorId) return res.status(400).json({ error: 'Pick an ambassador' });
  try {
    const p = await approvePayout(ambassadorId, me(req));
    await audit(me(req), 'payout.approve', { payoutId: p.id, ambassadorId }, { amountCents: p.amountCents });
    res.status(201).json(p);
  } catch (e) {
    if (e instanceof PayoutError) return res.status(409).json({ error: e.message });
    throw e;
  }
});

// POST /admin/ambassadors/payouts/:id/complete { method?, reference? } — the money went out
router.post('/payouts/:id/complete', async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    const p = await completePayout(id, me(req), { method: text(req.body?.method, 60), reference: text(req.body?.reference, 120) });
    await audit(me(req), 'payout.complete', { payoutId: p.id, ambassadorId: p.ambassadorId }, { amountCents: p.amountCents, method: p.method, reference: p.reference });
    res.json(p);
  } catch (e) {
    if (e instanceof PayoutError) return res.status(409).json({ error: e.message });
    throw e;
  }
});

// POST /admin/ambassadors/payouts/:id/cancel
router.post('/payouts/:id/cancel', async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    await cancelPayout(id);
    await audit(me(req), 'payout.cancel', { payoutId: id });
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof PayoutError) return res.status(409).json({ error: e.message });
    throw e;
  }
});

const csvCell = (v: unknown) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// GET /admin/ambassadors/payouts.csv — for the books
router.get('/payouts.csv', async (_req, res) => {
  const payouts = await prisma.payout.findMany({ include: { ambassador: { select: { name: true, email: true, code: true } }, _count: { select: { commissions: true } } }, orderBy: { approvedAt: 'asc' } });
  const lines = [
    ['payout_id', 'ambassador', 'email', 'code', 'amount_usd', 'status', 'approved_at', 'paid_at', 'method', 'reference', 'rewards'].join(','),
    ...payouts.map((p) =>
      [p.id, p.ambassador.name, p.ambassador.email, p.ambassador.code, (p.amountCents / 100).toFixed(2), p.status, p.approvedAt, p.paidAt, p.method, p.reference, p._count.commissions].map(csvCell).join(','),
    ),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="ambassador-payouts.csv"');
  res.send(lines.join('\n'));
});

// ---- settings and the audit log

// GET /admin/ambassadors/settings
router.get('/settings', async (_req, res) => {
  const p = await program();
  res.json({ ...p, starterTerms: p.termsText === DEFAULT_TERMS });
});

const INT_SETTINGS = [
  ['bountyCents', 0, 100_00],
  ['rateBps', 0, 10_000],
  ['extraStoreRateBps', 0, 10_000],
  ['maxPaidPeriods', 0, 60],
  ['holdDays', 0, 90],
  ['claimDays', 1, 60],
  ['maxActiveClaims', 1, 100],
  ['budgetCents', 0, 100_000_00],
] as const;

// PUT /admin/ambassadors/settings — new terms get a new version (everyone accepts again)
router.put('/settings', async (req, res) => {
  const before = await program();
  const b = req.body ?? {};
  const data: Prisma.AmbassadorProgramUpdateInput = {};
  for (const [k, min, max] of INT_SETTINGS) {
    if (b[k] === undefined) continue;
    if (!Number.isInteger(b[k]) || b[k] < min || b[k] > max) return res.status(400).json({ error: `${k} must be a whole number from ${min} to ${max}` });
    data[k] = b[k];
  }
  for (const k of ['enrollmentOpen', 'referralsOpen'] as const) if (typeof b[k] === 'boolean') data[k] = b[k];
  if (typeof b.termsText === 'string' && b.termsText.trim() && b.termsText.trim() !== before.termsText) {
    data.termsText = b.termsText.trim().slice(0, 20_000);
    data.termsVersion = before.termsVersion + 1;
    data.termsUpdatedAt = new Date();
  }
  const after = await prisma.ambassadorProgram.update({ where: { id: 1 }, data });
  const changed = Object.fromEntries(
    Object.keys(data)
      .filter((k) => k !== 'termsText')
      .map((k) => [k, { from: before[k as keyof typeof before], to: after[k as keyof typeof after] }]),
  );
  await audit(me(req), 'settings.update', {}, JSON.parse(JSON.stringify(changed)));
  res.json({ ...after, starterTerms: after.termsText === DEFAULT_TERMS });
});

// GET /admin/ambassadors/audit?limit=
router.get('/audit', async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const rows = await prisma.ambassadorAudit.findMany({ orderBy: { at: 'desc' }, take: limit });
  const actors = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorUserId).filter((x): x is number => x != null))] } }, select: { id: true, email: true, name: true } });
  res.json(rows.map((r) => ({ ...r, actor: actors.find((a) => a.id === r.actorUserId)?.name ?? actors.find((a) => a.id === r.actorUserId)?.email ?? null })));
});

export default router;
