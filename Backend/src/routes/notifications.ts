import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { emailShell, sendEmail } from '../lib/email.js';

const router = Router();

// GET /notifications — the caller's notifications (newest first) + unread count
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  res.json({
    unread,
    items: items.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      link: n.link,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt ? n.readAt.toISOString() : null,
    })),
  });
});

// POST /notifications/devices  { token, platform: 'ios' | 'android' } — the
// phone app registering for push. A token already on file moves to the caller
// (a shared phone someone else signed out of).
router.post('/devices', requireAuth, async (req, res) => {
  const { token, platform } = req.body ?? {};
  if (typeof token !== 'string' || !token || token.length > 4096) {
    return res.status(400).json({ error: 'token is required' });
  }
  if (platform !== 'ios' && platform !== 'android') {
    return res.status(400).json({ error: "platform must be 'ios' or 'android'" });
  }
  await prisma.deviceToken.upsert({
    where: { token },
    create: { token, platform, userId: req.user!.id },
    update: { platform, userId: req.user!.id },
  });
  res.json({ ok: true });
});

// POST /notifications/:id/read
router.post('/:id/read', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid numeric id is required' });
  const { count } = await prisma.notification.updateMany({
    where: { id, userId: req.user!.id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ ok: true, updated: count });
});

// POST /notifications/read-all
router.post('/read-all', requireAuth, async (req, res) => {
  const { count } = await prisma.notification.updateMany({
    where: { userId: req.user!.id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ ok: true, updated: count });
});

// POST /notifications/test-email — sends a real email to the caller's own
// address so they can confirm Resend is wired up. Returns whatever Resend said.
router.post('/test-email', requireAuth, async (req, res) => {
  const email = req.user!.email;
  if (!email) return res.status(400).json({ ok: false, error: 'Your account has no email address' });
  const r = await sendEmail({
    to: email,
    subject: 'Fruit Crew test email',
    html: emailShell(
      'Test email',
      '<p>If you can read this, Resend is set up correctly and Fruit Crew can email your crew.</p>',
    ),
    text: 'If you can read this, Resend is set up correctly.',
  });
  res.json({ ok: r.ok, sentTo: email, ...(r.error ? { error: r.error } : {}) });
});

export default router;
