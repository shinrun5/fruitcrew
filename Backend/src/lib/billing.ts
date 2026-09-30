import Stripe from 'stripe';
import prisma from './prisma.js';
import { notifyMany } from './notify.js';

// Pricing: one $16/month plan that includes the first store; each further
// store costs $2 less than the one before it, down to a $10 floor. Stripe
// charges this itself — the stores price is a graduated tiered price and the
// subscription quantity is the number of stores paid for (see
// scripts/stripe-setup.ts) — so these helpers are only for showing prices.
// Frontend/src/lib/pricing.ts is the twin of this.
export const TRIAL_DAYS = 30;
export const priceOfStore = (n: number): number => Math.max(16 - 2 * (n - 1), 10);
export const monthlyTotal = (stores: number): number => {
  let total = 0;
  for (let n = 1; n <= stores; n++) total += priceOfStore(n);
  return total;
};

/** Billing only exists once all three Stripe settings are in place. Until
 * then nothing is charged, no trial runs, and nobody is ever locked out. */
export function billingEnabled(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_PRICE_STORES);
}

let client: Stripe | null = null;
export function stripe(): Stripe {
  if (!client) {
    // STRIPE_API_BASE points the SDK at a local stand-in — testing only
    const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
    client = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      ...(base ? { host: base.hostname, port: base.port, protocol: base.protocol.replace(':', '') as 'http' | 'https' } : {}),
    });
  }
  return client;
}

/** When a business created now should stop being free — null while billing is off. */
export function newTrialEnd(now = new Date()): Date | null {
  return billingEnabled() ? new Date(now.getTime() + TRIAL_DAYS * 86_400_000) : null;
}

export type BillingState = 'off' | 'exempt' | 'trial' | 'active' | 'past_due' | 'lapsed';

export interface OrgBilling {
  trialEndsAt: Date | null;
  billingExempt: boolean;
  subscriptionStatus: string | null;
}
export const ORG_BILLING_SELECT = { trialEndsAt: true, billingExempt: true, subscriptionStatus: true } as const;

// a subscription in any of these is paid up (or, past_due, still being retried)
const PAYING = new Set(['active', 'trialing']);

export function billingState(org: OrgBilling, now = new Date()): BillingState {
  if (!billingEnabled()) return 'off';
  if (org.billingExempt) return 'exempt';
  if (org.subscriptionStatus && PAYING.has(org.subscriptionStatus)) return 'active';
  // Stripe keeps retrying the card for a while — keep them working meanwhile
  if (org.subscriptionStatus === 'past_due') return 'past_due';
  // no trial date means billing went live after they signed up and nobody has
  // started their trial yet (see POST /admin/billing/start-trials) — still free
  if (!org.trialEndsAt || org.trialEndsAt > now) return 'trial';
  return 'lapsed';
}

/** How many stores the plan counts — sections are part of a store. */
export function storesInUse(orgId: number): Promise<number> {
  return prisma.store.count({ where: { orgId, parentStoreId: null } });
}

/** The line item on a subscription that carries the per-store price. */
export function storesItem(sub: Stripe.Subscription): Stripe.SubscriptionItem | undefined {
  return sub.items.data.find((i) => i.price.id === process.env.STRIPE_PRICE_STORES);
}

/** Copy a subscription's current state onto its business. Every webhook and
 * every change made here goes through this, always from a freshly fetched
 * subscription, so a repeated or out-of-order event can't leave stale data. */
export async function syncFromSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const metaOrgId = Number(sub.metadata?.orgId);
  const org = await prisma.org.findFirst({
    where: Number.isInteger(metaOrgId) && metaOrgId > 0 ? { id: metaOrgId } : { stripeCustomerId: customerId },
  });
  if (!org) return;
  // an old, replaced subscription finishing shouldn't clobber the current one
  if (org.stripeSubscriptionId && org.stripeSubscriptionId !== sub.id && !PAYING.has(sub.status)) return;

  const live = PAYING.has(sub.status) || sub.status === 'past_due';
  const quantity = storesItem(sub)?.quantity ?? 1;
  await prisma.org.update({
    where: { id: org.id },
    data: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      // what they pay for is what they may have; once it ends, back to the
      // one-store default (they keep any extra stores, just can't add more).
      // A comped business's limit is set by hand, so leave it alone.
      ...(org.billingExempt ? {} : { storeLimit: live ? quantity : 1 }),
    },
  });

  if (sub.status === 'past_due' && org.subscriptionStatus !== 'past_due') {
    const owners = await prisma.user.findMany({ where: { orgId: org.id, role: 'OWNER' }, select: { id: true } });
    await notifyMany(
      owners.map((o) => o.id),
      {
        kind: 'GENERIC',
        title: 'Your payment didn’t go through',
        body: 'Update your card in Settings › Plan so FruitCrew keeps working.',
        link: '/settings',
        email: true,
      },
    );
  }
}
