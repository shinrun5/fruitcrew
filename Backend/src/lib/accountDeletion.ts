import prisma from './prisma.js';
import { supabaseAdmin } from './supabase.js';
import { alertError } from './errorAlert.js';

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
 * Refuses to run on the sole OWNER of an org that still has anything in it —
 * that's a "close the business" decision, not a personal-account deletion,
 * and needs a human (support) to sort out who takes over first. */
export async function deleteUserAccount(userId: number): Promise<DeleteAccountResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: 'No such account' };

  if (user.role === 'OWNER' && user.orgId != null) {
    const otherOwner = await prisma.user.findFirst({
      where: { orgId: user.orgId, role: 'OWNER', id: { not: userId } },
    });
    if (!otherOwner) {
      return {
        ok: false,
        error:
          "You're the only owner on your organization's account. Email support to transfer ownership or close the business account first.",
      };
    }
    await prisma.org.update({ where: { id: user.orgId }, data: { ownerId: otherOwner.id } });
  }

  await prisma.$transaction([
    prisma.notification.deleteMany({ where: { userId } }),
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
