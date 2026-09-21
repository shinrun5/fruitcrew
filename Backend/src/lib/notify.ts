import type { NotificationKind } from '@prisma/client';
import prisma from './prisma.js';
import { emailShell, sendEmail } from './email.js';
import { alertError } from './errorAlert.js';

const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');

interface Payload {
  kind: NotificationKind;
  title: string;
  body?: string;
  /** client-side path, e.g. "/availability" */
  link?: string;
  /** also send an email (uses the user's account email) */
  email?: boolean;
}

/** Create an in-app notification for one user, optionally emailing them too. */
export async function notify(userId: number, p: Payload): Promise<void> {
  await prisma.notification.create({
    data: { userId, kind: p.kind, title: p.title, body: p.body ?? null, link: p.link ?? null },
  });
  if (!p.email) return;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  if (!user?.email) return;
  const cta = p.link && APP_URL ? { label: 'Open Fruit Crew', url: `${APP_URL}${p.link}` } : undefined;
  const result = await sendEmail({
    to: user.email,
    subject: p.title,
    html: emailShell(p.title, `<p>${p.body ?? ''}</p>`, cta),
    text: `${p.title}\n\n${p.body ?? ''}${cta ? `\n\n${cta.url}` : ''}`,
  });
  // "no api key" is the deliberate local-dev skip (see email.ts), not a failure
  if (!result.ok && result.error !== 'no api key') {
    alertError('notify.email', new Error(result.error ?? 'send failed'), { userId, kind: p.kind });
  }
}

export async function notifyMany(userIds: number[], p: Payload): Promise<void> {
  for (const id of new Set(userIds)) await notify(id, p);
}
