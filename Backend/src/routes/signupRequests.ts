import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { emailShell, escapeHtml, sendEmail } from '../lib/email.js';

const router = Router();

const ALERT_TO = process.env.ERROR_ALERT_EMAIL;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /signup-requests  { businessName, contactName, email, phone?, message? }
// Public, unauthenticated — the landing page's "request access" form. This
// creates nothing but a queue entry: a superadmin reviews it in Admin and
// approving is what actually creates the Org and invites them in.
router.post('/', async (req, res) => {
  const businessName = typeof req.body?.businessName === 'string' ? req.body.businessName.trim() : '';
  const contactName = typeof req.body?.contactName === 'string' ? req.body.contactName.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

  if (!businessName || !contactName || !email) {
    return res.status(400).json({ error: 'businessName, contactName, and email are required' });
  }
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "That email address doesn't look right" });
  if (businessName.length > 200 || contactName.length > 200 || phone.length > 40 || message.length > 2000) {
    return res.status(400).json({ error: 'One of those fields is too long' });
  }

  await prisma.signupRequest.create({
    data: { businessName, contactName, email, phone: phone || null, message: message || null },
  });

  if (ALERT_TO) {
    void sendEmail({
      to: ALERT_TO,
      subject: `[Fruit Crew] New signup request: ${businessName}`,
      html: emailShell(
        'New signup request',
        `<p><b>${escapeHtml(businessName)}</b> — ${escapeHtml(contactName)} (${escapeHtml(email)}${
          phone ? `, ${escapeHtml(phone)}` : ''
        })</p>${message ? `<p>${escapeHtml(message)}</p>` : ''}<p>Review it in Admin → Pending Signups.</p>`,
      ),
    }).catch(() => {});
  }

  res.status(201).json({ ok: true });
});

export default router;
