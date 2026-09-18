// Transactional email via Resend (https://resend.com). No SDK — the REST API is
// one POST. If RESEND_API_KEY isn't set, sends are logged and skipped so dev and
// tests don't need a key.

const FROM = process.env.EMAIL_FROM || 'Fruit Crew <onboarding@resend.dev>';
// optional: where replies should land, if it's different from FROM's address
const REPLY_TO = process.env.EMAIL_REPLY_TO || undefined;
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email] (no RESEND_API_KEY) would send "${opts.subject}" -> ${opts.to}`);
    return { ok: false, error: 'no api key' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
        // a visible, working way to turn alerts off is one of the things Gmail
        // et al. reward with better inbox placement, on top of SPF/DKIM/DMARC
        ...(APP_URL ? { headers: { 'List-Unsubscribe': `<${APP_URL}/profile>` } } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[email] Resend ${res.status} sending to ${opts.to}: ${body}`);
      return { ok: false, error: `${res.status} ${body}` };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[email] send failed:', (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Minimal branded wrapper so the emails aren't a naked paragraph. */
export function emailShell(heading: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const button = cta
    ? `<p style="margin:24px 0"><a href="${cta.url}" style="background:#5FBE6B;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:999px;display:inline-block">${cta.label}</a></p>`
    : '';
  // a visible, working preferences link — not just the hidden List-Unsubscribe
  // header — is one of the plain best-practice signals mailbox providers use
  // when deciding whether new-domain mail lands in the inbox or in spam
  const prefsLink = APP_URL
    ? ` · <a href="${APP_URL}/profile" style="color:#7A6E8C">Manage email alerts</a>`
    : '';
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#3A2B4D">
    <h2 style="font-size:18px;margin:0 0 12px">🍎 ${heading}</h2>
    <div style="font-size:14px;line-height:1.55">${bodyHtml}</div>
    ${button}
    <p style="font-size:12px;color:#7A6E8C;margin-top:28px">Fruit Crew scheduler${prefsLink}</p>
  </div>`;
}
