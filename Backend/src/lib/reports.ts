import { emailShell, escapeHtml, sendEmail } from './email.js';
import { alertError } from './errorAlert.js';

// Reports and blocks (App Store guideline 1.2) reach the operator here, by
// email, so they can be acted on within 24 hours as the Terms promise.
export const REPORT_EMAIL = process.env.REPORT_EMAIL ?? 'contact@fruitcrew.app';

/** Email the operator a reported piece of content, with who reported it. */
export async function sendReport(
  kind: string,
  reporter: { id: number; email: string; name: string | null },
  author: string,
  body: string,
  where: string,
): Promise<void> {
  const r = await sendEmail({
    to: REPORT_EMAIL,
    subject: `Reported ${kind} on Fruit Crew`,
    html: emailShell(
      `A ${kind} was reported`,
      `<p><b>Reported by:</b> ${escapeHtml(reporter.name ?? reporter.email)} (${escapeHtml(reporter.email)}, user ${reporter.id})</p>` +
        `<p><b>Written by:</b> ${escapeHtml(author)}</p><p><b>Where:</b> ${escapeHtml(where)}</p>` +
        `<blockquote style="border-left:3px solid #ccc;margin:0;padding-left:10px">${escapeHtml(body)}</blockquote>`,
    ),
  });
  if (!r.ok && r.error !== 'no api key') alertError('report', new Error(r.error), { kind, reporterId: reporter.id });
}
