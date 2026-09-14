import { emailShell, sendEmail } from './email.js';

// A solo operator's only real "error visibility" today is however often they
// happen to check Railway's log stream. This gets the same information pushed
// to them instead — set ERROR_ALERT_EMAIL and unhandled errors show up in an
// inbox within a minute of happening, whether they came from this store's own
// use or a stranger's trial account.

const ALERT_TO = process.env.ERROR_ALERT_EMAIL;
// don't re-email the same failure every time it repeats — one every 15m per
// distinct error is enough to know something's wrong without flooding the inbox
const COOLDOWN_MS = 15 * 60 * 1000;
const lastSentAt = new Map<string, number>();

function fingerprint(source: string, message: string): string {
  return `${source}:${message.slice(0, 200)}`;
}

/** Log an unexpected error, and — if configured and not on cooldown — email it.
 * Always fire-and-forget: alerting must never itself throw or block a response. */
export function alertError(source: string, err: unknown, context?: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`[${source}]`, message, context ?? '', stack ?? '');

  if (!ALERT_TO) return;
  const key = fingerprint(source, message);
  const now = Date.now();
  const last = lastSentAt.get(key);
  if (last && now - last < COOLDOWN_MS) return;
  lastSentAt.set(key, now);

  const contextHtml = context
    ? `<pre style="background:#F4F0F8;padding:10px;border-radius:8px;font-size:12px;overflow:auto">${escapeHtml(
        JSON.stringify(context, null, 2),
      )}</pre>`
    : '';
  void sendEmail({
    to: ALERT_TO,
    subject: `[Fruit Crew] ${source} error: ${message.slice(0, 100)}`,
    html: emailShell(
      `Error in ${source}`,
      `<p><b>${escapeHtml(message)}</b></p>${contextHtml}${
        stack ? `<pre style="background:#F4F0F8;padding:10px;border-radius:8px;font-size:11px;overflow:auto">${escapeHtml(stack)}</pre>` : ''
      }`,
    ),
  }).catch(() => {});
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
