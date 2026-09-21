import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { emailShell, escapeHtml, sendEmail } from '../lib/email.js';
import { alertError } from '../lib/errorAlert.js';

const router = Router();

const ALERT_TO = process.env.ERROR_ALERT_EMAIL;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /account-deletion-requests  { email, reason? }
// Public, unauthenticated — the web-reachable "delete my account" path Google
// Play requires in addition to the in-app one (DELETE /auth/account). Doesn't
// delete anything itself: a superadmin verifies and fulfills it from Admin.
router.post('/', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

  if (!email) return res.status(400).json({ error: 'email is required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "That email address doesn't look right" });
  if (reason.length > 2000) return res.status(400).json({ error: 'reason is too long' });

  await prisma.accountDeletionRequest.create({ data: { email, reason: reason || null } });

  if (ALERT_TO) {
    void sendEmail({
      to: ALERT_TO,
      subject: `[Fruit Crew] Account deletion request: ${email}`,
      html: emailShell(
        'Account deletion request',
        `<p><b>${escapeHtml(email)}</b> asked to have their account deleted.</p>${
          reason ? `<p>${escapeHtml(reason)}</p>` : ''
        }<p>Review it in Admin → Pending Deletions.</p>`,
      ),
    }).then((r) => {
      if (!r.ok && r.error !== 'no api key') alertError('accountDeletionRequests.notify', new Error(r.error), { email });
    });
  }

  res.status(201).json({ ok: true });
});

export default router;
