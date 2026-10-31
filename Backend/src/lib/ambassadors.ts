import { randomBytes } from 'node:crypto';
import { Prisma, type AmbassadorProgram, type Commission, type CommissionStatus, type ContactOutcome, type Lead } from '@prisma/client';
import prisma from './prisma.js';
import { sendStoreSetUp } from './ambassadorMail.js';
import { inBackground } from './notify.js';
import { monthlyTotal, priceOfStore, yearlyPriceOfStore, yearlyTotal } from './billing.js';

/**
 * The student ambassador program's rules, in one place.
 *
 * Students apply, a platform admin approves them, and they sign in with their
 * own login. Before pitching a business they claim it from the shared lead
 * list — one student per business at a time, a claim lapses after a week with
 * no outreach, and a business that's been contacted, said no, asked not to be
 * contacted, or is already a customer isn't offered again.
 *
 * Money, per referred store (a business's stores are tracked one by one):
 *  - a bounty once the store gets going (an owner, a worker, a posted
 *    schedule with real shifts), after an admin approves it;
 *  - a share of each regular payment for that store (25% for a business's
 *    first store, 15% for each after) until it has paid for 12 months — a
 *    yearly payment counts as 12 months, its share figured on twelve months
 *    at the monthly price. Each share waits out the 2-week refund window;
 *    a refund or dispute takes it back.
 * The amounts are settings (AmbassadorProgram). A business keeps the terms it
 * came in under, copied onto its Referral.
 */

const DAY = 86_400_000;
export type Interval = 'month' | 'year';

// ---- settings

/** Starter terms, used until an admin edits them in Settings. They need a
 * proper review before the program launches (the Settings page says so). */
export const DEFAULT_TERMS = `FruitCrew Student Ambassador Program — Terms

These terms are between you and Vortyx LLC, the company that makes FruitCrew ("FruitCrew", "we").

1. What this is. As a FruitCrew Student Ambassador you introduce local businesses to FruitCrew and are rewarded when they sign up. You take part as an independent contractor, not as an employee, agent or partner of Vortyx LLC, and you can't sign contracts or make promises on our behalf. You decide whether, when, where and how much to take part: there are no hours, schedules or quotas, and you use your own phone and transportation at your own cost.

2. Who can take part. You must be 18 or older.

3. No guaranteed earnings. You earn rewards only for businesses that sign up through your code or link, are confirmed by FruitCrew as real, new businesses you brought in, and meet the conditions below. Many businesses won't sign up or won't keep paying. Any example amounts are illustrations, not promises.

4. Rewards. The reward amounts and rules are the ones shown in the program rules when a business signs up through you; a business keeps those terms even if the program's defaults change later. In short: a one-time bounty when a referred store is set up (an owner account, at least one worker, and a posted schedule), approved by FruitCrew, then a share of that store's successful subscription payments for a limited number of paid months. Free trial months, failed payments and refunded or disputed payments earn nothing, and rewards on refunded or disputed payments are taken back, including from future payouts.

5. Claiming businesses. Claiming a business in the app is how you get credit for it and keep other ambassadors from approaching the same place. A claim stays yours while you keep logging your outreach; otherwise it lapses and someone else may claim it. Please don't approach a business another ambassador has claimed, an existing FruitCrew customer, or a business marked "do not contact".

6. How to behave. Be honest and polite. Don't pressure anyone, don't make claims about FruitCrew that aren't true, don't offer discounts or payments that FruitCrew hasn't authorized, and don't send spam. If a business asks not to be contacted, record it and stop. Follow your school's rules and local laws.

7. Saying you're paid. Whenever you recommend FruitCrew in public — social media, reviews, posts, videos or group chats — say clearly that you earn a referral reward (for example "#ad" or "I get a reward if you sign up").

8. Not allowed. Referring a business you own, work for or are closely related to; fake or duplicate sign-ups; signing a business up without the owner's real consent; sharing your login. Any of these can mean losing rewards and being removed from the program.

9. Payouts and taxes. Payouts are approved and sent by FruitCrew by hand, to the payment method you give us. Before you can be paid you must give us a completed IRS Form W-9. Nothing is withheld from your rewards for taxes; you're responsible for your own taxes, and we'll send you a Form 1099 where the law requires it.

10. Business information. Information about businesses and outreach in the app is confidential and only for this program.

11. Changes and ending. We may change these terms or the program; you'll be asked to accept a new version before continuing. We may suspend or end your participation, and you may leave at any time. Rewards you've already earned under these terms are still paid unless they were earned against these terms.`;

/** The one settings row, created with the defaults the first time it's needed. */
export async function program(): Promise<AmbassadorProgram> {
  const row = await prisma.ambassadorProgram.findUnique({ where: { id: 1 } });
  if (row) return row;
  try {
    return await prisma.ambassadorProgram.create({ data: { id: 1, termsText: DEFAULT_TERMS } });
  } catch (e) {
    if (isUniqueError(e)) return prisma.ambassadorProgram.findUniqueOrThrow({ where: { id: 1 } });
    throw e;
  }
}

export const isUniqueError = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** What a store earns per paid month on these terms — `position` 1 is a business's first store. */
export const monthlyShareCents = (t: { rateBps: number; extraStoreRateBps: number }, position: number) =>
  Math.round((priceOfStore(position) * 100 * (position === 1 ? t.rateBps : t.extraStoreRateBps)) / 10_000);

// ---- codes

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

/** "MAYA7K"-style: a bit of their name, then something random. */
export async function newCode(name: string): Promise<string> {
  const stem = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'FC';
  for (;;) {
    const tail = Array.from(randomBytes(3), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    const code = `${stem}${tail}`;
    if (!(await prisma.ambassador.findUnique({ where: { code } }))) return code;
  }
}

export const newInviteCode = () => randomBytes(18).toString('base64url');
export const INVITE_DAYS = 14;
/** The lessons in the portal's Learn tab, in order (their text lives in the
 * app). A student marks each one done; admins see how far everyone got. */
export const TRAINING_LESSONS = ['pitch', 'start', 'weekly', 'pricing', 'questions', 'dosDonts', 'pay'] as const;
/** A contractor paid this much or more in a calendar year gets a 1099-NEC
 * (the IRS threshold for payments from 2026 on; it was $600 before). */
export const FORM_1099_CENTS = 2000_00;

/** Codes are typed by hand — case and spaces don't matter. */
export const cleanCode = (s: unknown) => (typeof s === 'string' ? s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) : '');

// ---- telling businesses apart

const NOISE = new Set(['llc', 'inc', 'co', 'corp', 'corporation', 'company', 'ltd', 'the', 'and']);

/** "The Mango's Café, LLC" → "mangos cafe" — so the same business typed two ways matches. */
export function nameKey(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !NOISE.has(w))
    .join(' ');
}

export const phoneKey = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').slice(-10);

/** Same name? Same words in any order, or one name inside the other ("mango" in "mango edison"). */
export function sameName(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = a.split(' ').sort().join(' ');
  const tb = b.split(' ').sort().join(' ');
  if (ta === tb) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && ` ${long} `.includes(` ${short} `);
}

const STREET: Record<string, string> = {
  street: 'st', avenue: 'ave', av: 'ave', road: 'rd', boulevard: 'blvd', drive: 'dr', lane: 'ln', court: 'ct',
  place: 'pl', parkway: 'pkwy', highway: 'hwy', route: 'rt', north: 'n', south: 's', east: 'e', west: 'w',
};

/** "123 Main Street, Suite 4, Edison NJ" → "123 main st" — the street part only. */
export function addressKey(a: string | null | undefined): string | null {
  if (!a) return null;
  const street = a.toLowerCase().split(',')[0]!.replace(/#.*$/, '').replace(/\b(suite|ste|unit|apt)\b.*$/, '');
  const words = street
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET[w] ?? w)
    .map((w) => w.replace(/^(\d+)(st|nd|rd|th)$/, '$1'));
  return words.length ? words.join(' ') : null;
}
export const cityKey = (c: string | null | undefined) => (c ? c.toLowerCase().replace(/[^a-z]+/g, ' ').trim() || null : null);
export const zip5 = (z: string | null | undefined) => /\b(\d{5})/.exec(z ?? '')?.[1] ?? null;

export interface Place {
  nameKey: string;
  addressKey: string | null;
  cityKey: string | null;
  zip: string | null;
  phone: string | null;
  placeId: string | null;
}

/** Whether two places are the same location, judged on what both sides know. */
export function sameLocation(a: Place, b: Place): 'same' | 'different' | 'unknown' {
  if (a.placeId && b.placeId) return a.placeId === b.placeId ? 'same' : 'different';
  if (a.phone && b.phone && a.phone.length >= 10 && a.phone === b.phone) return 'same';
  if (a.addressKey && b.addressKey) return a.addressKey === b.addressKey ? 'same' : 'different';
  if (a.zip && b.zip && a.zip !== b.zip) return 'different';
  if (a.cityKey && b.cityKey && a.cityKey !== b.cityKey) return 'different';
  return 'unknown';
}

export interface LeadInput {
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  category?: string | null;
  placeId?: string | null;
}

const clip = (s: unknown, n: number) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, n) : null);

/** Tidy what was typed or imported; null when there's no usable name. */
export function cleanLead(i: Record<string, unknown>): LeadInput | null {
  const name = clip(i.name, 120);
  if (!name || nameKey(name).length < 2) return null;
  const phone = phoneKey(clip(i.phone, 40));
  return {
    name,
    address: clip(i.address, 200),
    city: clip(i.city, 80),
    state: clip(i.state, 40),
    zip: zip5(clip(i.zip, 20)) ?? clip(i.zip, 20),
    phone: phone.length >= 7 ? phone : null,
    category: clip(i.category, 60),
    placeId: clip(i.placeId, 200),
  };
}

export const placeOf = (i: LeadInput | Lead): Place => ({
  nameKey: nameKey(i.name),
  addressKey: addressKey(i.address),
  cityKey: cityKey(i.city),
  zip: zip5(i.zip),
  phone: i.phone ? phoneKey(i.phone) || null : null,
  placeId: i.placeId ?? null,
});

export type Match = 'same' | 'possible';

/** Leads that are (or might be) this business. Same name in another town is
 * another location, not a duplicate; same name with no location to compare
 * is only "possible". */
export async function findLeadMatches(p: Place, excludeId?: number): Promise<{ lead: Lead; how: Match }[]> {
  const firstWord = p.nameKey.split(' ').find((w) => w.length >= 3) ?? p.nameKey;
  const candidates = await prisma.lead.findMany({
    where: {
      mergedIntoId: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [
        ...(p.placeId ? [{ placeId: p.placeId }] : []),
        ...(p.phone && p.phone.length >= 10 ? [{ phone: p.phone }] : []),
        ...(p.addressKey ? [{ addressKey: p.addressKey }] : []),
        { nameKey: { contains: firstWord } },
      ],
    },
    take: 200,
  });
  const out: { lead: Lead; how: Match }[] = [];
  for (const lead of candidates) {
    const q = placeOf(lead);
    const where = sameLocation(p, q);
    if (sameName(p.nameKey, q.nameKey)) {
      if (where === 'same') out.push({ lead, how: 'same' });
      else if (where === 'unknown') out.push({ lead, how: 'possible' });
    } else if (where === 'same' && (p.placeId || (p.phone && p.phone === q.phone))) {
      out.push({ lead, how: 'same' }); // same listing or phone line, renamed
    } else if (p.addressKey && p.addressKey === q.addressKey && p.zip === q.zip) {
      out.push({ lead, how: 'possible' }); // same address, different name
    }
  }
  return out.sort((a, b) => (a.how === b.how ? 0 : a.how === 'same' ? -1 : 1));
}

/** A FruitCrew business this place is (or might be) — compared on name, and
 * on the address and phone from its sign-up when there is one. */
export async function findCustomerMatch(p: Place): Promise<{ orgId: number; name: string; how: Match } | null> {
  const orgs = await prisma.org.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, stores: { select: { name: true } }, users: { where: { role: 'OWNER' }, select: { phone: true } } },
  });
  const signups = await signupsOf(orgs.map((o) => o.id));
  let possible: { orgId: number; name: string; how: Match } | null = null;
  for (const o of orgs) {
    const sr = signups.get(o.id);
    const phones = [sr?.phone, ...o.users.map((u) => u.phone)].map(phoneKey).filter((x) => x.length >= 10);
    if (p.phone && phones.includes(p.phone)) return { orgId: o.id, name: o.name, how: 'same' };
    const names = [o.name, ...o.stores.map((s) => s.name), ...o.stores.map((s) => `${o.name} ${s.name}`)].map(nameKey);
    if (!names.some((n) => sameName(n, p.nameKey))) continue;
    const theirs: Place = { nameKey: nameKey(o.name), addressKey: addressKey(sr?.address), cityKey: null, zip: zip5(sr?.address), phone: phones[0] ?? null, placeId: null };
    const where = sameLocation(p, theirs);
    if (where === 'same') return { orgId: o.id, name: o.name, how: 'same' };
    if (where === 'unknown') possible ??= { orgId: o.id, name: o.name, how: 'possible' };
  }
  return possible;
}

/** Each business's sign-up request (where its address and phone are), by business. */
async function signupsOf(orgIds: number[]) {
  const rows = orgIds.length
    ? await prisma.signupRequest.findMany({ where: { orgId: { in: orgIds } }, select: { orgId: true, address: true, phone: true } })
    : [];
  return new Map(rows.map((r) => [r.orgId!, r]));
}

const leadLabel = (l: Pick<Lead, 'name' | 'city' | 'address'>) => [l.name, l.city ?? l.address].filter(Boolean).join(', ');

export type AddLeadResult =
  | { status: 'created'; lead: Lead }
  | { status: 'duplicate'; lead: Lead }
  | { status: 'customer'; name: string }
  | { status: 'possible'; matches: { id: number; label: string }[]; customer: string | null };

/** Add one business to the list, after the duplicate and customer checks.
 * `allowPossible` creates it anyway when the only matches are "possible",
 * leaving a note for an admin (imports, or a student saying it's another location). */
export async function addLead(
  input: LeadInput,
  source: 'IMPORT' | 'AMBASSADOR' | 'HISTORY',
  opts: { submittedById?: number; allowPossible?: boolean } = {},
): Promise<AddLeadResult> {
  const p = placeOf(input);
  const matches = await findLeadMatches(p);
  const same = matches.find((m) => m.how === 'same');
  if (same) return { status: 'duplicate', lead: same.lead };
  const customer = await findCustomerMatch(p);
  if (customer?.how === 'same') return { status: 'customer', name: customer.name };
  const possibles = matches.filter((m) => m.how === 'possible');
  if ((possibles.length || customer) && !opts.allowPossible) {
    return { status: 'possible', matches: possibles.slice(0, 5).map((m) => ({ id: m.lead.id, label: leadLabel(m.lead) })), customer: customer?.name ?? null };
  }
  const notes = [
    ...possibles.slice(0, 3).map((m) => `Possible duplicate of #${m.lead.id} (${leadLabel(m.lead)})`),
    ...(customer ? [`Possible FruitCrew customer: ${customer.name}`] : []),
  ];
  try {
    const lead = await prisma.lead.create({
      data: {
        name: input.name,
        nameKey: p.nameKey,
        address: input.address ?? null,
        addressKey: p.addressKey,
        city: input.city ?? null,
        cityKey: p.cityKey,
        state: input.state ?? null,
        zip: input.zip ?? null,
        phone: p.phone,
        category: input.category ?? null,
        placeId: input.placeId ?? null,
        source,
        submittedById: opts.submittedById ?? null,
        reviewNote: notes.join('; ') || null,
      },
    });
    return { status: 'created', lead };
  } catch (e) {
    // the same listing id came in twice at once
    if (isUniqueError(e) && input.placeId) {
      const lead = await prisma.lead.findUnique({ where: { placeId: input.placeId } });
      if (lead) return { status: 'duplicate', lead };
    }
    throw e;
  }
}

// ---- claims and outreach

/** Claims nobody has logged outreach on in time lapse; the outreach history stays. */
export async function expireClaims(now = new Date()): Promise<number> {
  const r = await prisma.leadClaim.updateMany({ where: { endedAt: null, expiresAt: { lt: now } }, data: { endedAt: now, endReason: 'expired' } });
  return r.count;
}

export class ClaimError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type ClaimableLead = Pick<Lead, 'doNotContact' | 'orgId' | 'mergedIntoId' | 'contactStatus' | 'reopenedForId'>;

/** Why this ambassador can't claim a lead right now (no open claim on it assumed), or null. */
export function claimBlock(lead: ClaimableLead, ambassadorId: number): { code: string; message: string } | null {
  if (lead.mergedIntoId) return { code: 'merged', message: 'That business is listed under another entry.' };
  if (lead.doNotContact) return { code: 'doNotContact', message: 'This business asked not to be contacted.' };
  if (lead.orgId) return { code: 'customer', message: 'This business already uses FruitCrew.' };
  // anyone who's been contacted needs an admin's OK for another try
  if (lead.contactStatus !== 'NEW' && lead.reopenedForId !== ambassadorId) {
    return { code: 'contacted', message: 'Someone has already talked to this business — ask for a follow-up first.' };
  }
  return null;
}

/** Reserve a business before approaching it. One open claim per business
 * (the database's partial unique index settles a tie), and a cap per student. */
export async function claimLead(ambassadorId: number, leadId: number, now = new Date()) {
  const prog = await program();
  if (!prog.referralsOpen) throw new ClaimError('paused', 'New claims are paused for now.');
  return prisma.$transaction(async (tx) => {
    // one claim at a time per student, so two taps can't both squeeze under the cap
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ambassadorId})`;
    await tx.leadClaim.updateMany({ where: { endedAt: null, expiresAt: { lt: now } }, data: { endedAt: now, endReason: 'expired' } });
    const lead = await tx.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new ClaimError('notFound', 'That business is no longer on the list.');
    const open = await tx.leadClaim.findFirst({ where: { leadId, endedAt: null } });
    if (open) {
      throw open.ambassadorId === ambassadorId
        ? new ClaimError('yours', 'You already have this one.')
        : new ClaimError('taken', 'Another ambassador has this business right now.');
    }
    const block = claimBlock(lead, ambassadorId);
    if (block) throw new ClaimError(block.code, block.message);
    const mine = await tx.leadClaim.count({ where: { ambassadorId, endedAt: null } });
    if (mine >= prog.maxActiveClaims) {
      throw new ClaimError('limit', `You can hold ${prog.maxActiveClaims} businesses at a time — finish or release one first.`);
    }
    try {
      const claim = await tx.leadClaim.create({ data: { leadId, ambassadorId, claimedAt: now, expiresAt: new Date(now.getTime() + prog.claimDays * DAY) } });
      if (lead.reopenedForId === ambassadorId) await tx.lead.update({ where: { id: leadId }, data: { reopenedForId: null } });
      return claim;
    } catch (e) {
      if (isUniqueError(e)) throw new ClaimError('taken', 'Another ambassador just claimed this business.');
      throw e;
    }
  });
}

export async function releaseClaim(ambassadorId: number, leadId: number, reason = 'released'): Promise<boolean> {
  const r = await prisma.leadClaim.updateMany({ where: { leadId, ambassadorId, endedAt: null }, data: { endedAt: new Date(), endReason: reason } });
  return r.count > 0;
}

const OUTCOME_STATUS: Partial<Record<ContactOutcome, 'CONTACTED' | 'INTERESTED' | 'FOLLOW_UP' | 'DECLINED'>> = {
  NO_ANSWER: 'CONTACTED',
  LEFT_INFO: 'CONTACTED',
  SPOKE: 'CONTACTED',
  INTERESTED: 'INTERESTED',
  FOLLOW_UP: 'FOLLOW_UP',
  DECLINED: 'DECLINED',
};

export interface ContactInput {
  contactedAt: Date;
  method: 'IN_PERSON' | 'PHONE' | 'EMAIL' | 'SOCIAL' | 'OTHER';
  outcome: ContactOutcome;
  notes: string | null;
  followUp: boolean;
  followUpAt: Date | null;
}

/** Log one visit, call or message on a business the student holds. Outreach
 * keeps the claim alive; a "no" or "don't contact us" ends it. */
export async function logContact(ambassadorId: number, leadId: number, c: ContactInput, now = new Date()) {
  const prog = await program();
  return prisma.$transaction(async (tx) => {
    const claim = await tx.leadClaim.findFirst({ where: { leadId, ambassadorId, endedAt: null, expiresAt: { gte: now } } });
    if (!claim) throw new ClaimError('notClaimed', 'Claim this business first — your claim may have lapsed.');
    const contact = await tx.leadContact.create({ data: { leadId, ambassadorId, ...c } });
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    const next = OUTCOME_STATUS[c.outcome];
    // a plain "talked to them" doesn't undo an earlier "interested"
    const keep = next === 'CONTACTED' && lead.contactStatus !== 'NEW';
    await tx.lead.update({
      where: { id: leadId },
      data: {
        lastContactAt: c.contactedAt,
        ...(next && !keep ? { contactStatus: next } : {}),
        ...(c.outcome === 'FOLLOW_UP' || c.followUp ? { followUpAt: c.followUpAt } : {}),
        ...(c.outcome === 'DO_NOT_CONTACT'
          ? { doNotContact: true, dncReason: 'Asked not to be contacted', contactStatus: 'DECLINED' as const }
          : {}),
      },
    });
    if (c.outcome === 'DECLINED' || c.outcome === 'DO_NOT_CONTACT') {
      await tx.leadClaim.update({ where: { id: claim.id }, data: { endedAt: now, endReason: c.outcome === 'DECLINED' ? 'declined' : 'doNotContact' } });
    } else {
      // another week from now, or a week past the follow-up the owner asked for
      const until = Math.max(claim.expiresAt.getTime(), now.getTime() + prog.claimDays * DAY, c.followUpAt ? c.followUpAt.getTime() + prog.claimDays * DAY : 0);
      await tx.leadClaim.update({ where: { id: claim.id }, data: { expiresAt: new Date(until) } });
    }
    return contact;
  });
}

/** One status for a lead, as students see it — built from the separate facts. */
export type LeadStatus =
  | 'available'
  | 'claimedByYou'
  | 'claimed'
  | 'contacted'
  | 'interested'
  | 'followUp'
  | 'trial'
  | 'customer'
  | 'declined'
  | 'doNotContact';

export function leadStatus(
  lead: Pick<Lead, 'doNotContact' | 'orgId' | 'contactStatus'>,
  openClaimBy: number | null,
  me: number | null,
  orgPaying: boolean | null,
): LeadStatus {
  if (lead.doNotContact) return 'doNotContact';
  if (lead.orgId) return orgPaying ? 'customer' : 'trial';
  if (openClaimBy != null) return openClaimBy === me ? 'claimedByYou' : 'claimed';
  switch (lead.contactStatus) {
    case 'DECLINED':
      return 'declined';
    case 'FOLLOW_UP':
      return 'followUp';
    case 'INTERESTED':
      return 'interested';
    case 'CONTACTED':
      return 'contacted';
    default:
      return 'available';
  }
}

/** Paying for FruitCrew right now — from the subscription itself, so it's
 * right even where billing is switched off (a comped business isn't paying). */
export const isPaying = (org: { subscriptionStatus: string | null; billingExempt: boolean }) =>
  !org.billingExempt && (org.subscriptionStatus === 'active' || org.subscriptionStatus === 'past_due');

// ---- referrals: crediting a business to a student

export type Warning =
  | { code: 'selfEmail' | 'selfPhone' | 'selfName' | 'sameDomain' | 'noAddress' }
  | { code: 'duplicate'; name: string; since: string }
  | { code: 'otherClaim'; name: string };

const PUBLIC_MAIL = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'live.com', 'msn.com',
  'me.com', 'mac.com', 'protonmail.com', 'proton.me', 'qq.com', '163.com', '126.com', 'ymail.com', 'comcast.net', 'verizon.net',
]);
const domainOf = (email: string | null | undefined) => (email ?? '').toLowerCase().split('@')[1] ?? '';

/** Whether a sign-up is obviously the student's own business — never credited. */
export function isSelfReferral(a: { email: string; phone: string | null }, signup: { email: string; phone: string | null }): boolean {
  if (a.email.toLowerCase() === signup.email.toLowerCase()) return true;
  const ap = phoneKey(a.phone);
  return ap.length >= 10 && ap === phoneKey(signup.phone);
}

/** The lead a signing-up business matches — preferring one this student held. */
export async function matchLeadFor(business: { businessName: string; address?: string | null; phone?: string | null }, ambassadorId?: number) {
  const p = placeOf({ name: business.businessName, address: business.address ?? null, phone: business.phone ?? null, zip: zip5(business.address) });
  const matches = (await findLeadMatches(p)).filter((m) => m.how === 'same' || (m.how === 'possible' && sameName(m.lead.nameKey, p.nameKey)));
  if (!matches.length) return null;
  if (ambassadorId != null) {
    for (const m of matches) {
      const held = await prisma.leadClaim.findFirst({ where: { leadId: m.lead.id, ambassadorId }, orderBy: { claimedAt: 'desc' } });
      if (held) return m.lead;
    }
  }
  return matches[0]!.lead;
}

/** Credit a sign-up request to the student whose code it carries, on the
 * program's current terms. Nothing happens for an unknown or switched-off
 * code, while referrals are paused, or for the student's own business. */
export async function creditSignup(signupRequestId: number, code: string, via: 'link' | 'code'): Promise<boolean> {
  const prog = await program();
  if (!code || !prog.referralsOpen) return false;
  const a = await prisma.ambassador.findUnique({ where: { code } });
  if (!a || a.status === 'DEACTIVATED') return false;
  const sr = await prisma.signupRequest.findUniqueOrThrow({ where: { id: signupRequestId } });
  if (isSelfReferral(a, sr)) return false;
  const lead = await matchLeadFor(sr, a.id);
  try {
    await prisma.referral.create({
      data: {
        ambassadorId: a.id,
        signupRequestId,
        source: via,
        leadId: lead?.id ?? null,
        bountyCents: prog.bountyCents,
        rateBps: prog.rateBps,
        extraStoreRateBps: prog.extraStoreRateBps,
        maxPaidPeriods: prog.maxPaidPeriods,
      },
    });
    return true;
  } catch (e) {
    if (isUniqueError(e)) return false;
    throw e;
  }
}

/** A newly approved business: the leads that are it become customers (no
 * more pitching them), and whoever held them is done. */
export async function linkLeadsToOrg(orgId: number, business: { name: string; address?: string | null; phone?: string | null }, leadId?: number | null) {
  const p = placeOf({ name: business.name, address: business.address ?? null, phone: business.phone ?? null, zip: zip5(business.address) });
  const ids = new Set<number>((await findLeadMatches(p)).filter((m) => m.how === 'same').map((m) => m.lead.id));
  if (leadId) ids.add(leadId);
  if (!ids.size) return;
  await prisma.lead.updateMany({ where: { id: { in: [...ids] }, orgId: null }, data: { orgId } });
  await prisma.leadClaim.updateMany({ where: { leadId: { in: [...ids] }, endedAt: null }, data: { endedAt: new Date(), endReason: 'signedUp' } });
}

type ReferralForCheck = Prisma.ReferralGetPayload<{ include: { ambassador: true; signupRequest: true; org: true } }>;

/** Things that don't add up about a referred business, for an admin to look at. */
export async function warningsFor(r: ReferralForCheck): Promise<Warning[]> {
  const out: Warning[] = [];
  const a = r.ambassador;
  const sr = r.signupRequest;
  const owners = r.orgId
    ? await prisma.user.findMany({ where: { orgId: r.orgId, role: 'OWNER' }, select: { email: true, phone: true, name: true } })
    : [];
  const emails = [sr?.email, ...owners.map((o) => o.email)].filter((e): e is string => !!e).map((e) => e.toLowerCase());
  const phones = [sr?.phone, ...owners.map((o) => o.phone)].map(phoneKey).filter((p) => p.length >= 7);
  const names = [sr?.contactName, ...owners.map((o) => o.name)].filter((n): n is string => !!n).map(nameKey);
  if (emails.includes(a.email.toLowerCase())) out.push({ code: 'selfEmail' });
  if (a.phone && phones.includes(phoneKey(a.phone))) out.push({ code: 'selfPhone' });
  if (names.some((n) => n && n === nameKey(a.name))) out.push({ code: 'selfName' });
  const dom = domainOf(a.email);
  if (dom && !PUBLIC_MAIL.has(dom) && emails.some((e) => domainOf(e) === dom)) out.push({ code: 'sameDomain' });
  if (sr && !sr.address) out.push({ code: 'noAddress' });

  // already a FruitCrew business before this sign-up — not new business for anyone
  const name = r.org?.name ?? sr?.businessName ?? '';
  const p = placeOf({ name, address: sr?.address ?? null, phone: sr?.phone ?? null, zip: zip5(sr?.address) });
  const before = r.createdAt;
  const others = await prisma.org.findMany({
    where: { ...(r.orgId ? { id: { not: r.orgId } } : {}), deletedAt: null, createdAt: { lt: before } },
    select: { id: true, name: true, createdAt: true },
  });
  const theirSignups = await signupsOf(others.filter((o) => sameName(nameKey(o.name), p.nameKey)).map((o) => o.id));
  const twin = others.find((o) => {
    if (!sameName(nameKey(o.name), p.nameKey)) return false;
    const osr = theirSignups.get(o.id);
    const q: Place = { nameKey: nameKey(o.name), addressKey: addressKey(osr?.address), cityKey: null, zip: zip5(osr?.address), phone: phoneKey(osr?.phone) || null, placeId: null };
    return sameLocation(p, q) !== 'different'; // another location of a chain is new business
  });
  if (twin) out.push({ code: 'duplicate', name: twin.name, since: twin.createdAt.toISOString() });

  // another student held this business when it signed up
  const lead = r.leadId ? await prisma.lead.findUnique({ where: { id: r.leadId } }) : await matchLeadFor({ businessName: name, address: sr?.address ?? null, phone: sr?.phone ?? null });
  if (lead) {
    const theirs = await prisma.leadClaim.findFirst({
      where: { leadId: lead.id, ambassadorId: { not: a.id }, claimedAt: { lte: before }, OR: [{ endedAt: null }, { endedAt: { gte: before } }] },
      include: { ambassador: { select: { name: true } } },
    });
    if (theirs) out.push({ code: 'otherClaim', name: theirs.ambassador.name });
  }
  return out;
}

// ---- each referred store, and the bounty

export interface StoreProgress {
  storeId: number;
  name: string;
  /** 1 = the business's first store */
  position: number;
  workers: number;
  postedWeeks: number;
  activated: boolean;
}

/** A business's billable stores (departments count toward their store), oldest
 * first, with how far along each is. A store "gets going" with an owner on the
 * business, a worker, and a posted week with real shifts on it. */
export async function storesOf(orgId: number): Promise<StoreProgress[]> {
  const [stores, owner] = await Promise.all([
    prisma.store.findMany({ where: { orgId }, select: { id: true, name: true, parentStoreId: true }, orderBy: { id: 'asc' } }),
    prisma.user.count({ where: { orgId, role: 'OWNER' } }),
  ]);
  const tops = stores.filter((s) => s.parentStoreId == null);
  return Promise.all(
    tops.map(async (s, i) => {
      const ids = [s.id, ...stores.filter((d) => d.parentStoreId === s.id).map((d) => d.id)];
      const [links, snaps, schedules] = await Promise.all([
        prisma.employeeStore.findMany({ where: { storeId: { in: ids } }, select: { employeeId: true }, distinct: ['employeeId'] }),
        // weeks it has posted (the current copy, and earlier ones kept as
        // history — not the "before …" safety copies), counted when they had
        // shifts with people on them
        prisma.scheduleSnapshot.findMany({ where: { storeId: { in: ids }, OR: [{ label: 'posted' }, { label: null }] }, select: { storeId: true, label: true, weekStart: true, shifts: true } }),
        prisma.schedule.findMany({ where: { storeId: { in: ids } }, select: { storeId: true, postedWeekStart: true } }),
      ]);
      // an unlabelled copy is also what a draft that was never posted becomes
      // once the board moves on — only weeks up to the last one posted count
      const lastPosted = new Map(schedules.map((s) => [s.storeId, s.postedWeekStart]));
      const posted = snaps.filter((p) => {
        if (p.label === 'posted') return true;
        const last = p.storeId != null ? lastPosted.get(p.storeId) : null;
        return !!last && p.weekStart <= last;
      });
      const real = posted.filter((p) => Array.isArray(p.shifts) && (p.shifts as { employeeId?: number | null }[]).some((x) => x?.employeeId != null));
      const postedWeeks = new Set(real.map((p) => p.weekStart.toISOString())).size;
      return { storeId: s.id, name: s.name, position: i + 1, workers: links.length, postedWeeks, activated: owner > 0 && links.length >= 1 && postedWeeks >= 1 };
    }),
  );
}

/** Record the bounty for each of a referral's stores that has got going. It
 * always starts out pending — a platform admin approves every one. */
export async function refreshReferral(referralId: number): Promise<void> {
  const r = await prisma.referral.findUnique({ where: { id: referralId }, include: { ambassador: true, signupRequest: true, org: true } });
  if (!r?.orgId || !r.org || r.org.deletedAt || r.rejectedAt || r.bountyCents <= 0) return;
  const stores = await storesOf(r.orgId);
  const fresh = stores.filter((s) => s.activated);
  if (!fresh.length) return;
  const have = new Set((await prisma.commission.findMany({ where: { bountyStoreId: { in: fresh.map((s) => s.storeId) } }, select: { bountyStoreId: true } })).map((c) => c.bountyStoreId));
  const todo = fresh.filter((s) => !have.has(s.storeId));
  if (!todo.length) return;
  const warnings = await warningsFor(r);
  const flags = [
    ...(r.ambassador.status !== 'ACTIVE' ? [`ambassador is ${r.ambassador.status.toLowerCase()}`] : []),
    ...warnings.map((w) => w.code),
  ];
  for (const s of todo) {
    try {
      await prisma.commission.create({
        data: {
          ambassadorId: r.ambassadorId,
          referralId: r.id,
          storeId: s.storeId,
          storeName: s.name,
          kind: 'BOUNTY',
          status: 'PENDING',
          bountyStoreId: s.storeId,
          amountCents: r.bountyCents,
          memo: 'Store set up',
          flags: flags.join(', ') || null,
          availableAt: new Date(),
        },
      });
      if (r.ambassador.status === 'ACTIVE') inBackground('ambassadorStoreSetUp', sendStoreSetUp(r.ambassador, s.name, r.bountyCents));
    } catch (e) {
      // two views at once — the unique bountyStoreId keeps it to one
      if (!isUniqueError(e)) throw e;
    }
  }
}

/** Every credited business — the daily job, and before admin views. */
export async function refreshReferrals(where: Prisma.ReferralWhereInput = {}): Promise<void> {
  const rs = await prisma.referral.findMany({ where: { ...where, orgId: { not: null }, rejectedAt: null }, select: { id: true } });
  for (const r of rs) await refreshReferral(r.id);
}

// ---- payments, refunds and disputes (from Stripe's webhook)

export interface PaidInvoice {
  invoiceId: string;
  orgId: number;
  paidAt: Date;
  /** subscription_create / subscription_cycle are regular charges; anything else (a mid-month change) earns nothing */
  billingReason: string | null;
  /** what was actually collected, and the invoice's amount before discounts and credit */
  amountPaid: number;
  subtotal: number;
  /** how the money came in (payment intent or charge) — how a refund finds this */
  paymentRef: string | null;
  /** only the stores lines matter; add-ons earn nothing */
  storeLines: { interval: Interval; quantity: number; amount: number; proration: boolean; periodStart: Date | null; periodEnd: Date | null }[];
}

/** Paid months a store has used up — every payment that wasn't refunded counts,
 * so starting the plan again later doesn't start the count over. */
async function periodsUsed(storeId: number): Promise<number> {
  const r = await prisma.commission.aggregate({ where: { storeId, kind: 'RECURRING', status: { not: 'REVERSED' } }, _sum: { periods: true } });
  return r._sum.periods ?? 0;
}

/** A referred business paid: record each of its stores' share, until the store
 * has had its paid months. Safe to call twice for the same invoice. */
export async function recordPaidInvoice(inv: PaidInvoice): Promise<Commission[]> {
  if (inv.amountPaid <= 0 || inv.subtotal <= 0) return [];
  if (inv.billingReason !== 'subscription_create' && inv.billingReason !== 'subscription_cycle') return [];
  const r = await prisma.referral.findUnique({ where: { orgId: inv.orgId }, include: { ambassador: true } });
  if (!r || r.rejectedAt) return [];
  const prog = await program();
  const collected = Math.min(1, inv.amountPaid / inv.subtotal);
  const stores = await prisma.store.findMany({ where: { orgId: inv.orgId, parentStoreId: null }, select: { id: true, name: true }, orderBy: { id: 'asc' } });
  const out: Commission[] = [];
  for (const line of inv.storeLines.filter((l) => !l.proration && l.amount > 0)) {
    const q = Math.max(1, line.quantity);
    const fullCents = (line.interval === 'year' ? yearlyTotal(q) : monthlyTotal(q)) * 100;
    for (let n = 1; n <= Math.min(q, stores.length); n++) {
      const store = stores[n - 1]!;
      // this store's part of the line, by its price tier
      const tier = line.interval === 'year' ? yearlyPriceOfStore(n) : priceOfStore(n);
      const gross = line.amount * ((tier * 100) / fullCents) * collected;
      // the share is on the monthly price — a year counts as twelve months of it
      const periods = line.interval === 'year' ? 12 : 1;
      const basis = priceOfStore(n) * 100 * periods * (line.amount / fullCents) * collected;
      const rate = n === 1 ? r.rateBps : r.extraStoreRateBps;
      const left = r.maxPaidPeriods - (await periodsUsed(store.id));
      if (left <= 0) continue;
      const counted = Math.min(periods, left);
      const cents = Math.round(((basis * rate) / 10_000) * (counted / periods));
      if (cents <= 0) continue;
      const ok = r.verifiedAt && r.ambassador.status === 'ACTIVE';
      try {
        out.push(
          await prisma.commission.create({
            data: {
              ambassadorId: r.ambassadorId,
              referralId: r.id,
              storeId: store.id,
              storeName: store.name,
              kind: 'RECURRING',
              status: ok ? 'APPROVED' : 'PENDING',
              amountCents: cents,
              stripeInvoiceId: inv.invoiceId,
              stripePaymentRef: inv.paymentRef,
              grossCents: Math.round(gross),
              periodStart: line.periodStart,
              periodEnd: line.periodEnd,
              periods: counted,
              memo: line.interval === 'year' ? 'Yearly payment' : 'Monthly payment',
              flags: r.ambassador.status !== 'ACTIVE' ? `ambassador is ${r.ambassador.status.toLowerCase()}` : r.verifiedAt ? null : 'business not verified yet',
              availableAt: new Date(inv.paidAt.getTime() + prog.holdDays * DAY),
              ...(ok ? { decidedAt: new Date() } : {}),
            },
          }),
        );
      } catch (e) {
        if (!isUniqueError(e)) throw e; // already recorded — the same event twice
      }
    }
  }
  return out;
}

/** Money went back to the business (a refund, or a dispute): take back the
 * same share of the student's commission — reversed outright if it hasn't
 * been paid out yet, otherwise as a minus on their next payout. */
export async function reverseForPayment(paymentRef: string, fractionBack: number, why: string): Promise<void> {
  const share = Math.min(1, Math.max(0, fractionBack));
  if (share <= 0) return;
  const rows = await prisma.commission.findMany({
    where: { stripePaymentRef: paymentRef, kind: 'RECURRING', status: { in: ['PENDING', 'APPROVED', 'PAID'] } },
    include: { payout: true },
  });
  for (const c of rows) {
    const adjustments = { stripePaymentRef: paymentRef, kind: 'ADJUSTMENT' as const, ambassadorId: c.ambassadorId, storeId: c.storeId, status: { not: 'REVERSED' as const } };
    const unpaid = c.status !== 'PAID' && c.payout?.status !== 'PAID';
    if (share >= 1 && unpaid) {
      // never paid out: it simply doesn't count (nor anything already taken back from it)
      await prisma.$transaction(async (tx) => {
        await tx.commission.updateMany({ where: adjustments, data: { status: 'REVERSED', decisionNote: why, decidedAt: new Date() } });
        await tx.commission.update({ where: { id: c.id }, data: { status: 'REVERSED', decisionNote: why, decidedAt: new Date(), payoutId: null } });
        if (c.payoutId) await resumPayout(tx, c.payoutId);
      });
      continue;
    }
    // the refund total so far decides what's owed back, so a second notice for the same refund adds nothing
    const taken = -((await prisma.commission.aggregate({ where: adjustments, _sum: { amountCents: true } }))._sum.amountCents ?? 0);
    const more = Math.round(c.amountCents * share) - taken;
    if (more <= 0) continue;
    await prisma.commission.create({
      data: {
        ambassadorId: c.ambassadorId,
        referralId: c.referralId,
        storeId: c.storeId,
        storeName: c.storeName,
        kind: 'ADJUSTMENT',
        status: 'APPROVED',
        amountCents: -more,
        stripePaymentRef: paymentRef,
        memo: `Taken back: ${why}`,
        availableAt: new Date(),
        decidedAt: new Date(),
      },
    });
  }
}

/** A not-yet-sent payout's total after one of its rows came out. */
async function resumPayout(tx: Prisma.TransactionClient, payoutId: number) {
  const sum = await tx.commission.aggregate({ where: { payoutId }, _sum: { amountCents: true } });
  const amount = sum._sum.amountCents ?? 0;
  await tx.payout.update({ where: { id: payoutId }, data: amount > 0 ? { amountCents: amount } : { amountCents: 0, status: 'CANCELED', canceledAt: new Date() } });
  if (amount <= 0) await tx.commission.updateMany({ where: { payoutId }, data: { payoutId: null } });
}

// ---- where each commission stands

export type CommissionState = 'pending' | 'held' | 'payable' | 'sending' | 'paid' | 'rejected' | 'reversed';

export function commissionState(c: Pick<Commission, 'status' | 'availableAt' | 'payoutId'>, now = new Date()): CommissionState {
  switch (c.status) {
    case 'PENDING':
      return 'pending';
    case 'PAID':
      return 'paid';
    case 'REJECTED':
      return 'rejected';
    case 'REVERSED':
      return 'reversed';
    default:
      if (c.payoutId) return 'sending';
      return c.availableAt > now ? 'held' : 'payable';
  }
}

const sumOf = <T extends { amountCents: number }>(rows: T[]) => rows.reduce((n, r) => n + r.amountCents, 0);

/** A student's money: what's waiting, owed, paid — actual amounts only. */
export function totalsOf(rows: Pick<Commission, 'status' | 'availableAt' | 'payoutId' | 'kind' | 'amountCents'>[], now = new Date()) {
  const by = (states: CommissionState[], kinds?: Commission['kind'][]) =>
    sumOf(rows.filter((r) => states.includes(commissionState(r, now)) && (!kinds || kinds.includes(r.kind))));
  return {
    pendingBounties: by(['pending'], ['BOUNTY']),
    /** waiting on a check, or on the refund window */
    pendingCommissions: by(['pending'], ['RECURRING']) + by(['held'], ['RECURRING']),
    /** approved and owed, not sent yet */
    approvedUnpaid: by(['payable', 'sending']) + by(['held'], ['BOUNTY', 'ADJUSTMENT']),
    paid: by(['paid']),
    lifetime: by(['held', 'payable', 'sending', 'paid']),
  };
}

// ---- a student's referred stores, with months used and an estimate

export type BusinessStage = 'requested' | 'declined' | 'notCredited' | 'closed' | 'trial' | 'paying' | 'canceled';

type ReferralFull = Prisma.ReferralGetPayload<{ include: { signupRequest: true; org: true } }>;

export function businessStage(r: ReferralFull): BusinessStage {
  const sr = r.signupRequest;
  if (r.rejectedAt) return 'notCredited';
  if (!r.org) return sr && sr.status === 'DENIED' ? 'declined' : 'requested';
  if (r.org.deletedAt) return 'closed';
  if (isPaying(r.org)) return 'paying';
  if (r.org.subscriptionStatus && ['canceled', 'unpaid', 'incomplete_expired'].includes(r.org.subscriptionStatus)) return 'canceled';
  return 'trial';
}

export async function referredStores(where: Prisma.ReferralWhereInput, now = new Date()) {
  const rs = await prisma.referral.findMany({
    where,
    include: { signupRequest: true, org: true, ambassador: { select: { id: true, name: true, code: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const ids = rs.map((r) => r.id);
  const rows = ids.length ? await prisma.commission.findMany({ where: { referralId: { in: ids } } }) : [];
  return Promise.all(
    rs.map(async (r) => {
      const stage = businessStage(r);
      const stores = r.orgId && !r.org?.deletedAt ? await storesOf(r.orgId) : [];
      const mine = rows.filter((c) => c.referralId === r.id);
      return {
        r,
        stage,
        name: r.org?.name ?? r.signupRequest?.businessName ?? '—',
        stores: stores.map((s) => {
          const own = mine.filter((c) => c.storeId === s.storeId);
          const paidMonths = own.filter((c) => c.kind === 'RECURRING' && c.status !== 'REVERSED').reduce((n, c) => n + c.periods, 0);
          const left = Math.max(0, r.maxPaidPeriods - paidMonths);
          const perMonth = monthlyShareCents(r, s.position);
          const bounty = own.find((c) => c.kind === 'BOUNTY');
          return {
            ...s,
            paidMonths,
            monthsLeft: left,
            earnedCents: sumOf(own.filter((c) => ['held', 'payable', 'sending', 'paid'].includes(commissionState(c, now)))),
            bounty: bounty ? commissionState(bounty, now) : null,
            perMonthCents: perMonth,
            // an estimate only: the rest of its paid months at today's price, if it keeps paying
            estimateLeftCents: stage === 'paying' && !r.rejectedAt ? left * perMonth : 0,
          };
        }),
      };
    }),
  );
}

// ---- payouts

/** What can go out to a student now: approved, past the refund window, not in a payout yet. */
export async function payableRows(ambassadorId: number, now = new Date()) {
  return prisma.commission.findMany({ where: { ambassadorId, status: 'APPROVED', payoutId: null, availableAt: { lte: now } }, orderBy: { id: 'asc' } });
}

export class PayoutError extends Error {}

/** Approve sending a student everything payable — the money goes out by hand,
 * then someone marks it done. A row can only ever be in one payout. */
export async function approvePayout(ambassadorId: number, byUserId: number, now = new Date()) {
  const a = await prisma.ambassador.findUniqueOrThrow({ where: { id: ambassadorId } });
  if (!a.isAdult || !a.w9Received) throw new PayoutError('Mark them 18+ with a W-9 on file before paying them.');
  return prisma.$transaction(async (tx) => {
    const rows = await tx.commission.findMany({ where: { ambassadorId, status: 'APPROVED', payoutId: null, availableAt: { lte: now } } });
    const amount = sumOf(rows);
    if (amount <= 0) throw new PayoutError('Nothing to pay right now.');
    const payout = await tx.payout.create({ data: { ambassadorId, amountCents: amount, approvedById: byUserId } });
    const moved = await tx.commission.updateMany({ where: { id: { in: rows.map((r) => r.id) }, payoutId: null, status: 'APPROVED' }, data: { payoutId: payout.id } });
    if (moved.count !== rows.length) throw new PayoutError('Something changed while approving — try again.');
    return payout;
  });
}

export async function completePayout(payoutId: number, byUserId: number, how: { method: string | null; reference: string | null }) {
  return prisma.$transaction(async (tx) => {
    const done = await tx.payout.updateMany({ where: { id: payoutId, status: 'APPROVED' }, data: { status: 'PAID', paidAt: new Date(), paidById: byUserId, ...how } });
    if (done.count === 0) throw new PayoutError('That payout was already finished or canceled.');
    await tx.commission.updateMany({ where: { payoutId, status: 'APPROVED' }, data: { status: 'PAID' } });
    return tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
  });
}

export async function cancelPayout(payoutId: number) {
  return prisma.$transaction(async (tx) => {
    const done = await tx.payout.updateMany({ where: { id: payoutId, status: 'APPROVED' }, data: { status: 'CANCELED', canceledAt: new Date() } });
    if (done.count === 0) throw new PayoutError('Only a payout that hasn’t been sent can be canceled.');
    await tx.commission.updateMany({ where: { payoutId }, data: { payoutId: null } });
  });
}

// ---- the program as a whole: the pilot budget and the overview

export async function budget(now = new Date()) {
  const prog = await program();
  const [rows, payouts, stores] = await Promise.all([
    prisma.commission.findMany({ select: { status: true, availableAt: true, payoutId: true, kind: true, amountCents: true } }),
    prisma.payout.findMany({ where: { status: 'PAID' }, select: { amountCents: true } }),
    referredStores({ rejectedAt: null, orgId: { not: null } }, now),
  ]);
  const paid = sumOf(payouts);
  const approvedUnpaid = sumOf(rows.filter((r) => r.status === 'APPROVED'));
  const pending = sumOf(rows.filter((r) => r.status === 'PENDING'));
  // what paying referred stores would still earn if they keep paying
  const futureRecurring = stores.reduce((n, b) => n + b.stores.reduce((m, s) => m + s.estimateLeftCents, 0), 0);
  // and the most that stores still in their trial could add
  const ifTrialsConvert = stores
    .filter((b) => b.stage === 'trial')
    .reduce((n, b) => n + b.stores.reduce((m, s) => m + (s.bounty ? 0 : b.r.bountyCents) + b.r.maxPaidPeriods * s.perMonthCents, 0), 0);
  const committed = paid + approvedUnpaid + pending + futureRecurring;
  const perNewStore = prog.bountyCents + prog.maxPaidPeriods * monthlyShareCents(prog, 1);
  const remaining = prog.budgetCents - committed;
  return {
    budgetCents: prog.budgetCents,
    paidCents: paid,
    approvedUnpaidCents: approvedUnpaid,
    pendingCents: pending,
    estimatedFutureCents: futureRecurring,
    ifTrialsConvertCents: ifTrialsConvert,
    remainingCents: remaining,
    /** the most one more referred store could cost on today's terms */
    perNewStoreCents: perNewStore,
    overBudget: remaining < 0,
    nearLimit: remaining < perNewStore,
  };
}

// ---- audit

export async function audit(
  actorUserId: number | null,
  action: string,
  refs: { ambassadorId?: number | null; referralId?: number | null; leadId?: number | null; commissionId?: number | null; payoutId?: number | null },
  detail?: Prisma.InputJsonValue,
) {
  await prisma.ambassadorAudit.create({
    data: {
      actorUserId,
      action,
      ambassadorId: refs.ambassadorId ?? null,
      referralId: refs.referralId ?? null,
      leadId: refs.leadId ?? null,
      commissionId: refs.commissionId ?? null,
      payoutId: refs.payoutId ?? null,
      ...(detail !== undefined ? { detail } : {}),
    },
  });
}

export type { CommissionStatus };
