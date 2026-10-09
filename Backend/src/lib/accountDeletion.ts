import prisma from './prisma.js';
import { supabaseAdmin } from './supabase.js';
import { revokeAppleToken } from './appleSignIn.js';
import { alertError } from './errorAlert.js';
import { billingEnabled, stripe } from './billing.js';

export type DeleteAccountResult = { ok: true } | { ok: false; error: string };

/** Deletes a login (User row + its Supabase auth user) and everything
 * personal-only tied to it. Two things are deliberately left alone:
 *  - the linked Employee record (if any) — that's the business's own staffing
 *    /schedule history, not this person's data, and Message/ShiftNote already
 *    null out userId and keep a denormalised authorName so old posts still
 *    render after this runs.
 *  - DirectMessages this person sent or received are deleted outright (there's
 *    no denormalised-name fallback for those the way there is for Message/
 *    ShiftNote, and a 1:1 conversation with a party who no longer exists isn't
 *    something worth half-preserving).
 * The sole OWNER deleting their account closes the business with it (App
 * Store 5.1.1(v): deletion can't be sent to support): its subscription is
 * cancelled and it's marked deleted, which locks everyone else out the same
 * way an admin delete does. Nothing of the business's is erased here — an
 * admin restore still brings it back if this was a mistake. */
export async function deleteUserAccount(userId: number): Promise<DeleteAccountResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: 'No such account' };

  if (user.role === 'OWNER' && user.orgId != null) {
    const otherOwner = await prisma.user.findFirst({
      where: { orgId: user.orgId, role: 'OWNER', id: { not: userId } },
    });
    if (otherOwner) {
      await prisma.org.update({ where: { id: user.orgId }, data: { ownerId: otherOwner.id } });
    } else {
      const org = await prisma.org.findUnique({
        where: { id: user.orgId },
        select: { stripeSubscriptionId: true, subscriptionStatus: true },
      });
      const subId = org?.stripeSubscriptionId;
      const ended = ['canceled', 'incomplete_expired'].includes(org?.subscriptionStatus ?? '');
      if (subId && !ended && billingEnabled()) {
        // a closed business must stop being charged; if Stripe can't be
        // reached, stop here rather than delete with a live subscription
        try {
          await stripe().subscriptions.cancel(subId);
        } catch (e) {
          alertError('accountDeletion.cancelSubscription', e, { userId, orgId: user.orgId });
          return { ok: false, error: 'Could not cancel the business’s subscription — please try again in a minute.' };
        }
      }
      await prisma.org.update({ where: { id: user.orgId }, data: { ownerId: null, deletedAt: new Date() } });
    }
  }

  // Apple requires apps offering Sign in with Apple to revoke it on deletion.
  // Best effort: a failure is logged, but never keeps someone from deleting.
  if (user.appleRefreshToken && user.appleClientId) {
    await revokeAppleToken(user.appleRefreshToken, user.appleClientId).catch((e) =>
      alertError('accountDeletion.appleRevoke', e, { userId }),
    );
  }

  await prisma.$transaction([
    prisma.notification.deleteMany({ where: { userId } }),
    prisma.deviceToken.deleteMany({ where: { userId } }),
    prisma.messageRead.deleteMany({ where: { userId } }),
    prisma.directMessage.deleteMany({ where: { OR: [{ senderId: userId }, { recipientId: userId }] } }),
    prisma.managerStore.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  const { error } = await supabaseAdmin().auth.admin.deleteUser(user.authId);
  // The login row is already gone on our side either way; a leftover Supabase
  // auth user with no linked User row can never pass requireAuth again, so
  // this failing isn't a security hole — just worth knowing about.
  if (error) {
    alertError('accountDeletion.supabaseDeleteUser', error, { userId, authId: user.authId });
  }

  return { ok: true };
}
