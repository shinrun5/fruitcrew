import Stripe from 'stripe';
import prisma from './prisma.js';
import { notifyMany } from './notify.js';
import { ADDONS, addonLookupKey, isAddonKey, type AddonKey } from './addons.js';

export type BillingInterval = 'month' | 'year';

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
// Paying yearly: each store's year is 88% of twelve months of its monthly
// price, rounded up to the dollar — $169 for the first store, $148, $127,
// then $106 each. (Stripe's yearly tiers are exactly these.)
export const YEARLY_SHARE = 0.88;
export const yearlyPriceOfStore = (n: number): number => Math.ceil(priceOfStore(n) * 12 * YEARLY_SHARE);
export const yearlyTotal = (stores: number): number => {
  let total = 0;
  for (let n = 1; n <= stores; n++) total += yearlyPriceOfStore(n);
  return total;
};
/** Refunds are given within this long of a payment (the free month is for trying it). */
export const REFUND_DAYS = 14;
export const STORES_YEARLY_KEY = 'fruitcrew_stores_yearly';

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
  // had a plan and it ended (cancelled, unpaid): no trial to fall back on, even
  // for a business that signed up before trials started
  if (org.subscriptionStatus && !org.trialEndsAt) return 'lapsed';
  // no trial date means billing went live after they signed up and nobody has
  // started their trial yet (see POST /admin/billing/start-trials) — still free
  if (!org.trialEndsAt || org.trialEndsAt > now) return 'trial';
  return 'lapsed';
}

/** How many stores the plan counts — sections are part of a store. */
export function storesInUse(orgId: number): Promise<number> {
  return prisma.store.count({ where: { orgId, parentStoreId: null } });
}

/** Whether a price is the per-store one — monthly (by its id) or yearly (by lookup key). */
export const isStoresPrice = (p: Pick<Stripe.Price, 'id' | 'lookup_key'>) =>
  p.id === process.env.STRIPE_PRICE_STORES || p.lookup_key === STORES_YEARLY_KEY;

/** The line item on a subscription that carries the per-store price. */
export function storesItem(sub: Stripe.Subscription): Stripe.SubscriptionItem | undefined {
  return sub.items.data.find((i) => isStoresPrice(i.price));
}

/** Monthly or yearly — from the stores line, which every subscription has. */
export function intervalOf(sub: Stripe.Subscription): BillingInterval {
  return storesItem(sub)?.price.recurring?.interval === 'year' ? 'year' : 'month';
}

/** Which add-on a subscription line is, from its price's lookup key
 * (fruitcrew_addon_chat, fruitcrew_addon_chat_yearly, …) — set by prisma/stripeSetup.ts. */
export function addonOfItem(item: Stripe.SubscriptionItem): AddonKey | null {
  const key = item.price.lookup_key?.replace(/^fruitcrew_addon_/, '').replace(/_yearly$/, '');
  return isAddonKey(key) && (item.price.lookup_key === addonLookupKey(key) || item.price.lookup_key === addonLookupKey(key, 'year'))
    ? key
    : null;
}

// add-on and yearly price ids, found by lookup key once and remembered — so
// there's no env var per price to keep in sync
let lookedUp: Map<string, string> | null = null;
async function priceByLookupKey(key: string): Promise<string> {
  if (!lookedUp) {
    const keys = [STORES_YEARLY_KEY, ...ADDONS.map((a) => addonLookupKey(a)), ...ADDONS.map((a) => addonLookupKey(a, 'year'))];
    const list = await stripe().prices.list({ lookup_keys: keys, active: true, limit: keys.length });
    lookedUp = new Map(list.data.map((p) => [p.lookup_key ?? '', p.id]));
  }
  const id = lookedUp.get(key);
  if (!id) {
    lookedUp = null; // look again next time — it may have been created since
    throw new Error(`Price ${key} missing in Stripe — run npm run stripe:setup`);
  }
  return id;
}

export const addonPriceId = (key: AddonKey, interval: BillingInterval = 'month') =>
  priceByLookupKey(addonLookupKey(key, interval));

export const storesPriceId = async (interval: BillingInterval) =>
  interval === 'year' ? priceByLookupKey(STORES_YEARLY_KEY) : process.env.STRIPE_PRICE_STORES!;

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
  const paidAddons = sub.items.data.map(addonOfItem).filter((k): k is AddonKey => k !== null);
  await prisma.org.update({
    where: { id: org.id },
    data: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      billingInterval: intervalOf(sub),
      // what they pay for is what they may have; once it ends, back to the
      // one-store default (they keep any extra stores, just can't add more).
      // A comped business's limit is set by hand, so leave it alone.
      ...(org.billingExempt ? {} : { storeLimit: live ? quantity : 1 }),
      // the add-ons on the subscription; none once it has ended
      addons: live ? paidAddons : [],
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
