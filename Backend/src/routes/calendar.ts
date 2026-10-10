import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { alertError } from '../lib/errorAlert.js';
import { buildCalendarFeed, type FeedLang } from '../lib/calendarFeed.js';
import { PUBLIC_URL } from '../lib/appUrl.js';

// Calendar sync: each login has a private feed link that Apple, Google or
// Outlook Calendar subscribe to. Included in every plan. The link's secret is
// the only thing guarding it (calendar apps can't sign in), so it's long and
// random, and resetting it cuts off the old one.

const router = Router();
const newToken = () => randomBytes(24).toString('base64url');
const feedUrl = (token: string) => `${PUBLIC_URL}/api/calendar/feed/${token}.ics`;

// GET /calendar/link — this login's feed link (made on first ask)
router.get('/link', requireAuth, async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { calendarToken: true } });
  const token = u.calendarToken ?? newToken();
  if (!u.calendarToken) await prisma.user.update({ where: { id: req.user!.id }, data: { calendarToken: token } });
  res.json({ url: feedUrl(token) });
});

// POST /calendar/link/reset — a new link; calendars using the old one stop updating
router.post('/link/reset', requireAuth, async (req, res) => {
  const token = newToken();
  await prisma.user.update({ where: { id: req.user!.id }, data: { calendarToken: token } });
  res.json({ url: feedUrl(token) });
});

// GET /calendar/feed/:token.ics?lang=en|zh|es — the feed itself. No sign-in:
// calendar apps fetch it on their own schedule.
router.get('/feed/:file', async (req, res) => {
  const token = String(req.params.file).replace(/\.ics$/, '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return res.status(404).end();
  const user = await prisma.user.findUnique({ where: { calendarToken: token }, select: { id: true } });
  if (!user) return res.status(404).end();
  const lang: FeedLang = req.query.lang === 'zh' || req.query.lang === 'es' ? req.query.lang : 'en';
  try {
    const ics = await buildCalendarFeed(user.id, lang);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="fruitcrew-shifts.ics"');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(ics);
  } catch (e) {
    alertError('calendar.feed', e, { userId: user.id });
    res.status(500).end();
  }
});

export default router;
