import type { NotificationKind } from '@prisma/client';
import prisma from './prisma.js';
import { emailShell, sendEmail } from './email.js';
import { alertError } from './errorAlert.js';
import { pushToUser } from './push.js';

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

/** Create an in-app notification for one user — also pushed to any phone
 * they're signed in on — optionally emailing them too. */
export async function notify(userId: number, p: Payload): Promise<void> {
  await prisma.notification.create({
    data: { userId, kind: p.kind, title: p.title, body: p.body ?? null, link: p.link ?? null },
  });
  // not awaited: a slow APNs/FCM round trip shouldn't hold up whatever caused this
  inBackground('push', pushToUser(userId, { title: p.title, body: p.body, link: p.link }));
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
