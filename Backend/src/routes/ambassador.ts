import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { Ambassador, AmbassadorProgram, ContactMethod, ContactOutcome, Lead, Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { inBackground, notifyAdmins } from '../lib/notify.js';
import {
  addLead,
  claimBlock,
  ClaimError,
  claimLead,
  cleanLead,
  commissionState,
  expireClaims,
  isPaying,
  leadStatus,
  logContact,
  monthlyShareCents,
  program,
  referredStores,
  refreshReferrals,
  releaseClaim,
  totalsOf,
  TRAINING_LESSONS,
} from '../lib/ambassadors.js';

// The student ambassador portal (role AMBASSADOR). A student sees only their
// own businesses and money, and of the shared lead list only what they need
// to pick a business: never another student's name or earnings, nor a
// customer's details beyond "already uses FruitCrew".
const router = Router();

interface Ctx {
  a: Ambassador;
  prog: AmbassadorProgram;
  termsOk: boolean;
}
const ctx = (res: Response) => res.locals.amb as Ctx;

async function loadAmbassador(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'AMBASSADOR') return res.status(403).json({ error: 'Ambassadors only' });
  const a = await prisma.ambassador.findUnique({ where: { userId: req.user.id } });
  if (!a || a.status === 'DEACTIVATED') return res.status(403).json({ error: 'Your ambassador account is no longer active' });
  const prog = await program();
  const accepted = await prisma.ambassadorTermsAcceptance.findUnique({ where: { ambassadorId_version: { ambassadorId: a.id, version: prog.termsVersion } } });
  res.locals.amb = { a, prog, termsOk: !!accepted } satisfies Ctx;
  next();
}
router.use(requireAuth, loadAmbassador);

/** Claiming, adding and logging need an active student who has accepted the current terms. */
function canWork(res: Response): boolean {
  const { a, termsOk } = ctx(res);
  if (!termsOk) {
    res.status(409).json({ error: 'Accept the updated program terms first', code: 'terms' });
    return false;
  }
  if (a.status !== 'ACTIVE') {
    res.status(403).json({ error: 'Your account is paused — contact FruitCrew', code: 'suspended' });
    return false;
  }
  return true;
}

const workLimit = rateLimit({ windowMs: 60 * 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => `amb:${req.user?.id}` });

// GET /ambassador/me — who they are, the program's rules, and their money at a glance
router.get('/me', async (_req, res) => {
  const { a, prog, termsOk } = ctx(res);
  await refreshReferrals({ ambassadorId: a.id });
  const [rows, businesses, openClaims] = await Promise.all([
    prisma.commission.findMany({ where: { ambassadorId: a.id }, select: { status: true, availableAt: true, payoutId: true, kind: true, amountCents: true } }),
    referredStores({ ambassadorId: a.id }),
    prisma.leadClaim.count({ where: { ambassadorId: a.id, endedAt: null, expiresAt: { gte: new Date() } } }),
  ]);
  const stores = businesses.filter((b) => b.stage !== 'notCredited').flatMap((b) => b.stores.map((s) => ({ ...s, stage: b.stage })));
  res.json({
    ambassador: { name: a.name, email: a.email, code: a.code, status: a.status, school: a.school, area: a.area, isAdult: a.isAdult, w9Received: a.w9Received },
    program: {
      bountyCents: prog.bountyCents,
      rateBps: prog.rateBps,
      extraStoreRateBps: prog.extraStoreRateBps,
      maxPaidPeriods: prog.maxPaidPeriods,
      holdDays: prog.holdDays,
      claimDays: prog.claimDays,
      maxActiveClaims: prog.maxActiveClaims,
      referralsOpen: prog.referralsOpen,
      perMonthCents: monthlyShareCents(prog, 1),
      termsVersion: prog.termsVersion,
    },
    termsAccepted: termsOk,
    trainingDone: a.trainingDone,
    totals: totalsOf(rows),
    estimate: {
      // estimates only — what paying stores would earn if they keep paying
      monthlyCents: stores.filter((s) => s.stage === 'paying' && s.monthsLeft > 0).reduce((n, s) => n + s.perMonthCents, 0),
      upcomingCents: stores.reduce((n, s) => n + s.estimateLeftCents, 0),
    },
    counts: {
      openClaims,
      businesses: businesses.filter((b) => b.stage !== 'notCredited').length,
      stores: stores.length,
      activated: stores.filter((s) => s.activated).length,
      paying: stores.filter((s) => s.stage === 'paying').length,
    },
  });
});

// PUT /ambassador/training { lesson, done } — tick a Learn lesson done (or not).
// Open to anyone with the portal, even before the terms: learning comes first.
router.put('/training', async (req, res) => {
  const { a } = ctx(res);
  const lesson = TRAINING_LESSONS.find((l) => l === req.body?.lesson);
  if (!lesson || typeof req.body?.done !== 'boolean') return res.status(400).json({ error: 'Unknown lesson' });
  const fresh = await prisma.ambassador.findUniqueOrThrow({ where: { id: a.id }, select: { trainingDone: true } });
  const rest = fresh.trainingDone.filter((l) => l !== lesson);
  const trainingDone = TRAINING_LESSONS.filter((l) => (l === lesson ? req.body.done : rest.includes(l)));
  await prisma.ambassador.update({ where: { id: a.id }, data: { trainingDone } });
  res.json({ trainingDone });
});

// GET /ambassador/terms — the current program terms
router.get('/terms', async (_req, res) => {
  const { a, prog } = ctx(res);
  const mine = await prisma.ambassadorTermsAcceptance.findFirst({ where: { ambassadorId: a.id }, orderBy: { version: 'desc' } });
  res.json({ version: prog.termsVersion, text: prog.termsText, updatedAt: prog.termsUpdatedAt, acceptedVersion: mine?.version ?? null, acceptedAt: mine?.acceptedAt ?? null });
});

// POST /ambassador/terms { version } — accept the current terms
router.post('/terms', async (req, res) => {
  const { a, prog } = ctx(res);
  if (req.body?.version !== prog.termsVersion) return res.status(409).json({ error: 'The terms changed — read them again' });
  await prisma.ambassadorTermsAcceptance.upsert({
    where: { ambassadorId_version: { ambassadorId: a.id, version: prog.termsVersion } },
    create: { ambassadorId: a.id, version: prog.termsVersion },
    update: {},
  });
  res.json({ ok: true });
});

// GET /ambassador/stores — the businesses they brought in, store by store
router.get('/stores', async (_req, res) => {
  const { a } = ctx(res);
  await refreshReferrals({ ambassadorId: a.id });
  const businesses = await referredStores({ ambassadorId: a.id });
  res.json(
    businesses.map((b) => ({
      id: b.r.id,
      name: b.name,
      stage: b.stage,
      since: b.r.createdAt,
      stores: b.stores.map((s) => ({
        storeId: s.storeId,
        name: s.name,
        position: s.position,
        hasWorkers: s.workers > 0,
        posted: s.postedWeeks > 0,
        activated: s.activated,
        bounty: s.bounty,
        paidMonths: s.paidMonths,
        monthsLeft: s.monthsLeft,
        maxMonths: b.r.maxPaidPeriods,
        earnedCents: s.earnedCents,
        perMonthCents: s.perMonthCents,
        estimateLeftCents: s.estimateLeftCents,
      })),
    })),
  );
});

// GET /ambassador/earnings — every reward and payout
router.get('/earnings', async (_req, res) => {
  const { a } = ctx(res);
  const now = new Date();
  const [rows, payouts] = await Promise.all([
    prisma.commission.findMany({
      where: { ambassadorId: a.id },
      include: { referral: { select: { org: { select: { name: true } }, signupRequest: { select: { businessName: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.payout.findMany({ where: { ambassadorId: a.id, status: { not: 'CANCELED' } }, orderBy: { approvedAt: 'desc' } }),
  ]);
  res.json({
    totals: totalsOf(rows, now),
    items: rows.map((c) => ({
      id: c.id,
      kind: c.kind,
      state: commissionState(c, now),
      amountCents: c.amountCents,
      business: c.referral?.org?.name ?? c.referral?.signupRequest?.businessName ?? null,
      store: c.storeName,
      memo: c.memo,
      periods: c.periods,
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
      createdAt: c.createdAt,
      availableAt: c.availableAt,
    })),
    payouts: payouts.map((p) => ({ id: p.id, amountCents: p.amountCents, status: p.status, approvedAt: p.approvedAt, paidAt: p.paidAt, method: p.method })),
  });
});

// ---- the shared lead list

/** Leads as a student sees them: the business, one combined status, and
 * whether they can claim it — nothing about who else holds it. */
async function present(leads: Lead[], me: number) {
  const ids = leads.map((l) => l.id);
  const orgIds = [...new Set(leads.map((l) => l.orgId).filter((x): x is number => x != null))];
  const [claims, orgs] = await Promise.all([
    // a claim past its time is over, even before the daily job closes it
    ids.length ? prisma.leadClaim.findMany({ where: { leadId: { in: ids }, endedAt: null, expiresAt: { gte: new Date() } } }) : [],
    orgIds.length ? prisma.org.findMany({ where: { id: { in: orgIds } }, select: { id: true, trialEndsAt: true, billingExempt: true, subscriptionStatus: true } }) : [],
  ]);
  return leads.map((l) => {
    const claim = claims.find((c) => c.leadId === l.id) ?? null;
    const org = orgs.find((o) => o.id === l.orgId);
    const status = leadStatus(l, claim?.ambassadorId ?? null, me, org ? isPaying(org) : null);
    const block = claim ? null : claimBlock(l, me);
    return {
      id: l.id,
      name: l.name,
      address: l.address,
      city: l.city,
      state: l.state,
      zip: l.zip,
      category: l.category,
      status,
      canClaim: !claim && !block,
      blockedBy: claim ? (claim.ambassadorId === me ? null : 'taken') : (block?.code ?? null),
      claimExpiresAt: claim?.ambassadorId === me ? claim.expiresAt : null,
      lastContactAt: l.lastContactAt,
      followUpAt: claim?.ambassadorId === me ? l.followUpAt : null,
      followUpAsked: l.followUpAskById === me,
      reopenedForYou: l.reopenedForId === me,
    };
  });
}

const PAGE = 30;
const STATUS_FILTERS = ['available', 'claimedByYou', 'claimed', 'contacted', 'interested', 'followUp', 'trial', 'customer', 'declined', 'doNotContact'] as const;

// GET /ambassador/leads?q=&status=&page= — search the list
router.get('/leads', async (req, res) => {
  const { a } = ctx(res);
  await expireClaims();
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const status = STATUS_FILTERS.find((s) => s === req.query.status) ?? null;
  const page = Math.max(0, Number(req.query.page) || 0);
  const words = q.split(/\s+/).filter(Boolean).slice(0, 5);
  const where: Prisma.LeadWhereInput = {
    mergedIntoId: null,
    AND: words.map((w) => ({
      OR: [
        { name: { contains: w, mode: 'insensitive' } },
        { address: { contains: w, mode: 'insensitive' } },
        { city: { contains: w, mode: 'insensitive' } },
        { zip: { startsWith: w } },
        { category: { contains: w, mode: 'insensitive' } },
      ],
    })),
  };
  // the status filter runs in the database (the same rules as leadStatus), so
  // the count and the pages cover the whole list, however long it gets
  if (status) where.AND = [...(where.AND as Prisma.LeadWhereInput[]), await statusWhere(status, a.id)];
  const [total, rows] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: page * PAGE, take: PAGE }),
  ]);
  res.json({ total, page, pageSize: PAGE, leads: await present(rows, a.id) });
});

/** The leads leadStatus() would give this status. */
async function statusWhere(status: (typeof STATUS_FILTERS)[number], me: number): Promise<Prisma.LeadWhereInput> {
  const open = { endedAt: null, expiresAt: { gte: new Date() } };
  const listed = { doNotContact: false, orgId: null };
  const unheld = { ...listed, claims: { none: open } };
  const paying = async () =>
    (await prisma.org.findMany({ where: { billingExempt: false, subscriptionStatus: { in: ['active', 'past_due'] } }, select: { id: true } })).map((o) => o.id);
  switch (status) {
    case 'doNotContact':
      return { doNotContact: true };
    case 'customer':
      return { doNotContact: false, orgId: { in: await paying() } };
    case 'trial':
      return { doNotContact: false, orgId: { not: null, notIn: await paying() } };
    case 'claimedByYou':
      return { ...listed, claims: { some: { ...open, ambassadorId: me } } };
    case 'claimed':
      return { ...listed, claims: { some: { ...open, ambassadorId: { not: me } } } };
    case 'available':
      return { ...unheld, contactStatus: 'NEW' };
    case 'contacted':
      return { ...unheld, contactStatus: 'CONTACTED' };
    case 'interested':
      return { ...unheld, contactStatus: 'INTERESTED' };
    case 'followUp':
      return { ...unheld, contactStatus: 'FOLLOW_UP' };
    case 'declined':
      return { ...unheld, contactStatus: 'DECLINED' };
  }
}

// GET /ambassador/leads/mine — what they hold now, and what they've worked on
router.get('/leads/mine', async (_req, res) => {
  const { a } = ctx(res);
  await expireClaims();
  const [open, touched] = await Promise.all([
    prisma.leadClaim.findMany({ where: { ambassadorId: a.id, endedAt: null }, include: { lead: true }, orderBy: { expiresAt: 'asc' } }),
    prisma.leadContact.findMany({ where: { ambassadorId: a.id }, select: { leadId: true }, distinct: ['leadId'], orderBy: { contactedAt: 'desc' }, take: 100 }),
  ]);
  const openIds = new Set(open.map((c) => c.leadId));
  const past = await prisma.lead.findMany({ where: { id: { in: touched.map((t) => t.leadId).filter((id) => !openIds.has(id)) } } });
  const lastOutcome = await prisma.leadContact.findMany({
    where: { ambassadorId: a.id, leadId: { in: [...openIds, ...past.map((l) => l.id)] } },
    orderBy: { contactedAt: 'desc' },
    select: { leadId: true, outcome: true, contactedAt: true },
  });
  const withLast = async (leads: Lead[]) =>
    (await present(leads, a.id)).map((l) => ({ ...l, lastOutcome: lastOutcome.find((c) => c.leadId === l.id)?.outcome ?? null }));
  res.json({ claimed: await withLast(open.map((c) => c.lead)), worked: await withLast(past) });
});

// GET /ambassador/leads/:id — one business with its outreach history
router.get('/leads/:id', async (req, res) => {
  const { a } = ctx(res);
  const id = Number(req.params.id);
  const lead = Number.isInteger(id) ? await prisma.lead.findUnique({ where: { id } }) : null;
  if (!lead || lead.mergedIntoId) return res.status(404).json({ error: 'Not found' });
  const contacts = await prisma.leadContact.findMany({ where: { leadId: id }, orderBy: { contactedAt: 'desc' } });
  const [shown] = await present([lead], a.id);
  res.json({
    ...shown,
    phone: shown!.status === 'claimedByYou' ? lead.phone : null,
    // the history, without other students' names or notes
    history: contacts.map((c) => ({
      id: c.id,
      who: c.ambassadorId === a.id ? 'you' : c.ambassadorId ? 'ambassador' : 'fruitcrew',
      contactedAt: c.contactedAt,
      method: c.method,
      outcome: c.outcome,
      followUpAt: c.ambassadorId === a.id ? c.followUpAt : null,
      notes: c.ambassadorId === a.id ? c.notes : null,
    })),
  });
});

// POST /ambassador/leads { name, address, city, state, zip, phone?, category?, differentLocation? }
// Add a business that isn't on the list yet — checked for duplicates and
// customers first — and claim it.
router.post('/leads', workLimit, async (req, res) => {
  if (!canWork(res)) return;
  const { a, prog } = ctx(res);
  if (!prog.referralsOpen) return res.status(409).json({ error: 'New claims are paused for now.' });
  const input = cleanLead(req.body ?? {});
  if (!input) return res.status(400).json({ error: 'Give the business’s name' });
  if (!input.address && !input.city && !input.zip) return res.status(400).json({ error: 'Add where it is — an address, or at least the town' });
  const r = await addLead(input, 'AMBASSADOR', { submittedById: a.id, allowPossible: req.body?.differentLocation === true });
  if (r.status === 'customer') return res.status(409).json({ error: 'That business already uses FruitCrew.', code: 'customer' });
  if (r.status === 'duplicate') {
    const [shown] = await present([r.lead], a.id);
    return res.status(409).json({ error: 'That business is already on the list.', code: 'duplicate', lead: shown });
  }
  if (r.status === 'possible') return res.status(409).json({ error: 'This might already be on the list.', code: 'possible', matches: r.matches, customer: r.customer });
  let claimError: string | null = null;
  try {
    await claimLead(a.id, r.lead.id);
  } catch (e) {
    if (!(e instanceof ClaimError)) throw e;
    claimError = e.message;
  }
  const [shown] = await present([r.lead], a.id);
  res.status(201).json({ lead: shown, claimError });
});

// POST /ambassador/leads/:id/claim
router.post('/leads/:id/claim', workLimit, async (req, res) => {
  if (!canWork(res)) return;
  const { a } = ctx(res);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id' });
  try {
    const claim = await claimLead(a.id, id);
    res.status(201).json({ expiresAt: claim.expiresAt });
  } catch (e) {
    if (e instanceof ClaimError) return res.status(e.code === 'notFound' ? 404 : 409).json({ error: e.message, code: e.code });
    throw e;
  }
});

// POST /ambassador/leads/:id/release — let someone else have it
router.post('/leads/:id/release', async (req, res) => {
  const { a } = ctx(res);
  const ok = await releaseClaim(a.id, Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'You don’t hold that business' });
  res.json({ ok: true });
});

const METHODS: ContactMethod[] = ['IN_PERSON', 'PHONE', 'EMAIL', 'SOCIAL', 'OTHER'];
const OUTCOMES: ContactOutcome[] = ['NO_ANSWER', 'LEFT_INFO', 'SPOKE', 'INTERESTED', 'FOLLOW_UP', 'DECLINED', 'DO_NOT_CONTACT'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// POST /ambassador/leads/:id/contacts { date, method, outcome, notes?, followUp?, followUpDate? }
router.post('/leads/:id/contacts', workLimit, async (req, res) => {
  if (!canWork(res)) return;
  const { a } = ctx(res);
  const id = Number(req.params.id);
  const b = req.body ?? {};
  if (!Number.isInteger(id) || !METHODS.includes(b.method) || !OUTCOMES.includes(b.outcome) || typeof b.date !== 'string' || !YMD.test(b.date)) {
    return res.status(400).json({ error: 'Give the date, how you reached them, and how it went' });
  }
  const contactedAt = new Date(`${b.date}T12:00:00.000Z`);
  if (Number.isNaN(contactedAt.getTime()) || contactedAt.getTime() > Date.now() + 86_400_000 || contactedAt.getTime() < Date.now() - 60 * 86_400_000) {
    return res.status(400).json({ error: 'Pick a date in the last two months' });
  }
  const followUp = b.outcome === 'FOLLOW_UP' || b.followUp === true;
  const followUpAt = followUp && typeof b.followUpDate === 'string' && YMD.test(b.followUpDate) ? new Date(`${b.followUpDate}T12:00:00.000Z`) : null;
  if (followUp && !followUpAt) return res.status(400).json({ error: 'When should you follow up?' });
  if (followUpAt && (followUpAt.getTime() < contactedAt.getTime() || followUpAt.getTime() > Date.now() + 120 * 86_400_000)) {
    return res.status(400).json({ error: 'Pick a follow-up date in the next four months' });
  }
  const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 1000) : null;
  try {
    const c = await logContact(a.id, id, { contactedAt, method: b.method, outcome: b.outcome, notes, followUp, followUpAt });
    res.status(201).json({ id: c.id });
  } catch (e) {
    if (e instanceof ClaimError) return res.status(409).json({ error: e.message, code: e.code });
    throw e;
  }
});

// POST /ambassador/leads/:id/follow-up { note } — ask to try again with a business someone already talked to
router.post('/leads/:id/follow-up', workLimit, async (req, res) => {
  if (!canWork(res)) return;
  const { a } = ctx(res);
  const id = Number(req.params.id);
  const lead = Number.isInteger(id) ? await prisma.lead.findUnique({ where: { id } }) : null;
  if (!lead || lead.mergedIntoId) return res.status(404).json({ error: 'Not found' });
  if (lead.doNotContact || lead.orgId) return res.status(409).json({ error: 'This business can’t be contacted again.' });
  if (lead.contactStatus === 'NEW') return res.status(409).json({ error: 'Nobody has contacted this one yet — just claim it.' });
  const open = await prisma.leadClaim.findFirst({ where: { leadId: id, endedAt: null, expiresAt: { gte: new Date() } } });
  if (open) return res.status(409).json({ error: 'Someone is working with this business right now.' });
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
  if (!note) return res.status(400).json({ error: 'Say why it’s worth another try' });
  await prisma.lead.update({ where: { id }, data: { followUpAskById: a.id, followUpAskAt: new Date(), followUpAskNote: note } });
  inBackground('ambassadorFollowUp', notifyAdmins({ title: 'Follow-up request', body: `${a.name} would like another try with ${lead.name}.`, link: '/admin/ambassadors/leads' }));
  res.json({ ok: true });
});

export default router;
