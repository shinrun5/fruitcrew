import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import prisma from '../lib/prisma.js';
import { priceOfStore } from '../lib/billing.js';
import { monthlyShareCents, program } from '../lib/ambassadors.js';
import { inBackground, notifyAdmins } from '../lib/notify.js';

// Public: the student ambassador recruitment page — the program's numbers,
// and the application form. Applying gives no access; a platform admin
// approves each student (Admin › Ambassadors › Applications).
const router = Router();

// GET /ambassador-program — the current rewards, for the /ambassadors page
router.get('/', async (_req, res) => {
  const p = await program();
  const perMonth = monthlyShareCents(p, 1);
  res.json({
    enrollmentOpen: p.enrollmentOpen,
    bountyCents: p.bountyCents,
    rateBps: p.rateBps,
    extraStoreRateBps: p.extraStoreRateBps,
    maxPaidPeriods: p.maxPaidPeriods,
    storePriceCents: priceOfStore(1) * 100,
    perMonthCents: perMonth,
    // a store's most at today's price: the bounty, then every paid month
    maxPerStoreCents: p.bountyCents + perMonth * p.maxPaidPeriods,
  });
});

const applyLimit = rateLimit({ windowMs: 60 * 60_000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// POST /ambassador-program/apply  { name, email, school?, area, experience?, why, adult: true }
router.post('/apply', applyLimit, async (req, res) => {
  // a field people never see — only bots fill it in
  if (text(req.body?.website, 10)) return res.status(201).json({ ok: true });
  const name = text(req.body?.name, 100);
  const email = text(req.body?.email, 200).toLowerCase();
  const school = text(req.body?.school, 120);
  const area = text(req.body?.area, 120);
  const experience = text(req.body?.experience, 1000);
  const why = text(req.body?.why, 1500);
  if (!name || !EMAIL.test(email) || !area || !why) {
    return res.status(400).json({ error: 'Name, email, where you’d like to work, and why you’re interested are required' });
  }
  // the program is for adults only (contracts, and being paid)
  if (req.body?.adult !== true) return res.status(400).json({ error: 'You must be 18 or older to join' });
  const p = await program();
  if (!p.enrollmentOpen) return res.status(409).json({ error: 'Applications are closed right now — check back soon.' });
  if (await prisma.ambassador.findUnique({ where: { email } })) {
    return res.status(409).json({ error: 'You’re already an ambassador — sign in, or ask FruitCrew for a new invite link.' });
  }
  if (await prisma.ambassadorApplication.findFirst({ where: { email, status: 'PENDING' } })) {
    return res.status(409).json({ error: 'We already have your application — we’ll be in touch.' });
  }
  await prisma.ambassadorApplication.create({
    data: { name, email, school: school || null, area, experience: experience || null, why },
  });
  inBackground(
    'ambassadorApplication',
    notifyAdmins({ title: 'New ambassador application', body: `${name}${school ? ` (${school})` : ''} — ${area}`, link: '/admin/ambassadors/applications' }),
  );
  res.status(201).json({ ok: true });
});

export default router;
