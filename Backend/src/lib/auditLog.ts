import { emailShell, escapeHtml, sendEmail } from './email.js';

// No AuditLog table yet — that's a schema migration worth doing deliberately,
// not as a drive-by fix. Until then, this is the same "push it to an inbox"
// approach as errorAlert.ts: every owner-level action (role changes, removing
// a manager/owner, deleting a store) always logs to stdout (durable in
// Railway's log stream) and, if configured, emails ALERT_TO — unlike
// errorAlert, with no cooldown, since these are infrequent, human-triggered
// actions where every single one matters, not a failure mode that repeats.

const ALERT_TO = process.env.ERROR_ALERT_EMAIL;

export function auditLog(action: string, actor: { id: number; email: string }, detail: Record<string, unknown>): void {
  console.log(`[audit] ${action} by user#${actor.id} (${actor.email})`, detail);

  if (!ALERT_TO) return;
  const rows = Object.entries(detail)
    .map(([k, v]) => `<tr><td style="padding:2px 8px 2px 0;color:#7A6E8C">${escapeHtml(k)}</td><td>${escapeHtml(String(v))}</td></tr>`)
    .join('');
  void sendEmail({
    to: ALERT_TO,
    subject: `[Fruit Crew] Audit: ${action}`,
    html: emailShell(
      action,
      `<p>By <b>${escapeHtml(actor.email)}</b> (user #${actor.id})</p><table style="border-collapse:collapse">${rows}</table>`,
    ),
  });
}
