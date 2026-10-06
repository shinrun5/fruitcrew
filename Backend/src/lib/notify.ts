import type { NotificationKind } from '@prisma/client';
import prisma from './prisma.js';
import { emailShell, escapeHtml, sendEmail } from './email.js';
import { alertError } from './errorAlert.js';
import { pushToUser, type PushMessage } from './push.js';

const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');

/** What each person can switch off for phone pushes (Profile → Phone
 * notifications). A notification with no topic — billing — always pushes. */
export const PUSH_TOPICS = ['schedule', 'reminders', 'openShifts', 'chat', 'approvals'] as const;
export type PushTopic = (typeof PUSH_TOPICS)[number];

interface Payload {
  kind: NotificationKind;
  /** which phone-push setting covers this one; omit to always push */
  topic?: PushTopic;
  title: string;
  body?: string;
  /** client-side path, e.g. "/availability" */
  link?: string;
  /** also send an email (uses the user's account email) */
  email?: boolean;
  /** false = bell (and email) only, no phone push — for a caller that pushes itself */
  push?: boolean;
}

/** Push to someone's phone(s) unless they've switched that kind off. In the
 * background: a slow APNs/FCM round trip shouldn't hold up whatever caused it. */
export function pushUnlessMuted(userId: number, topic: PushTopic | undefined, m: PushMessage): void {
  inBackground(
    'push',
    (async () => {
      if (topic) {
        const prefs = await prisma.user.findUnique({ where: { id: userId }, select: { pushMuted: true } });
        if (prefs?.pushMuted.includes(topic)) return;
      }
      await pushToUser(userId, m);
    })(),
  );
}

/** Create an in-app notification for one user — also pushed to any phone
 * they're signed in on — optionally emailing them too. */
export async function notify(userId: number, p: Payload): Promise<void> {
  await prisma.notification.create({
    data: { userId, kind: p.kind, title: p.title, body: p.body ?? null, link: p.link ?? null },
  });
  if (p.push !== false) pushUnlessMuted(userId, p.topic, { title: p.title, body: p.body, link: p.link });
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

/** Tell the platform admins: their bell (Admin has one) + phone, and — unless
 * the caller already emailed — the ERROR_ALERT_EMAIL inbox, since a new
 * business is worth hearing about even when nobody's looking at the app. */
export async function notifyAdmins(p: { title: string; body?: string; link?: string }, opts: { email?: boolean } = {}): Promise<void> {
  const admins = await prisma.user.findMany({ where: { isSuperAdmin: true }, select: { id: true } });
  await notifyMany(
    admins.map((a) => a.id),
    { kind: 'GENERIC', topic: 'approvals', title: p.title, ...(p.body ? { body: p.body } : {}), link: p.link ?? '/admin' },
  );
  const to = process.env.ERROR_ALERT_EMAIL;
  if (opts.email === false || !to) return;
  const r = await sendEmail({
    to,
    subject: `[Fruit Crew] ${p.title}`,
    html: emailShell(
      p.title,
      `<p>${escapeHtml(p.body ?? '')}</p>`,
      APP_URL ? { label: 'Open admin', url: `${APP_URL}${p.link ?? '/admin'}` } : undefined,
    ),
  });
  if (!r.ok && r.error !== 'no api key') alertError('notify.admins', new Error(r.error ?? 'send failed'), { title: p.title });
}

/** Login ids of everyone who runs any of `storeIds`: the org's owners, plus
 * managers assigned to one of those stores. */
export async function managerUserIds(storeIds: number[]): Promise<number[]> {
  if (storeIds.length === 0) return [];
  const orgIds = (
    await prisma.store.findMany({ where: { id: { in: storeIds } }, select: { orgId: true } })
  ).map((s) => s.orgId);
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { role: 'OWNER', orgId: { in: orgIds } },
        { role: 'MANAGER', managerStores: { some: { storeId: { in: storeIds } } } },
      ],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** The login id linked to each employee that has one (many never sign up). */
export async function userIdsForEmployees(employeeIds: (number | null)[]): Promise<number[]> {
  const ids = employeeIds.filter((id): id is number => id != null);
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({ where: { employeeId: { in: ids } }, select: { id: true } });
  return users.map((u) => u.id);
}

/** Run a notification without letting its failure fail the request that caused it. */
export function inBackground(label: string, work: Promise<unknown>): void {
  void work.catch((e) => alertError(`notify.${label}`, e));
}
