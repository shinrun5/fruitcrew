import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { formatPhone, normalizePhone } from '../lib/phone.js';
import { emailShell, escapeHtml, sendEmail } from '../lib/email.js';
import { alertError } from '../lib/errorAlert.js';
import { inBackground, notifyAdmins } from '../lib/notify.js';

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
  const phone = typeof req.body?.phone === 'string' ? normalizePhone(req.body.phone) : '';
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

  // the platform admins' bell + phone, so a request doesn't sit for hours
  // waiting on someone to check their email (which is sent just below)
  inBackground(
    'signupRequest',
    notifyAdmins({ title: `New business wants in: ${businessName}`, body: `${contactName}${phone ? ` · ${formatPhone(phone)}` : ''}` }, { email: false }),
  );

  if (ALERT_TO) {
    // best-effort: a failure here means the signup itself was still saved and
    // is visible in Admin → Pending Signups, just without the heads-up email
    void sendEmail({
      to: ALERT_TO,
      subject: `[Fruit Crew] New signup request: ${businessName}`,
      html: emailShell(
        'New signup request',
        `<p><b>${escapeHtml(businessName)}</b> — ${escapeHtml(contactName)} (${escapeHtml(email)}${
          phone ? `, ${escapeHtml(formatPhone(phone))}` : ''
        })</p>${message ? `<p>${escapeHtml(message)}</p>` : ''}<p>Review it in Admin → Pending Signups.</p>`,
      ),
    }).then((r) => {
      if (!r.ok && r.error !== 'no api key') alertError('signupRequests.notify', new Error(r.error), { businessName });
    });
  }

  res.status(201).json({ ok: true });
});

export default router;
