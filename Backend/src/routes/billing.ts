import { Router, type Request, type Response } from 'express';
import type Stripe from 'stripe';
import prisma from '../lib/prisma.js';
import { requireOwner } from '../lib/auth.js';
import { alertError } from '../lib/errorAlert.js';
import { APP_URL } from '../lib/appUrl.js';
import { INCLUDED_REQUESTS } from '../lib/scheduleAssistant.js';
import { ADDONS, ADDON_PRICE, ADDON_PRICE_YEARLY, addonsFor, isAddonKey, type AddonKey } from '../lib/addons.js';
import { reverseForPayment, recordPaidInvoice, type Interval, type PaidInvoice } from '../lib/ambassadors.js';
import {
  addonOfItem,
  addonPriceId,
  billingEnabled,
  billingState,
  intervalOf,
  isStoresPrice,
  monthlyTotal,
  priceOfStore,
  REFUND_DAYS,
  storesInUse,
  storesItem,
  storesPriceId,
  stripe,
  syncFromSubscription,
  yearlyPriceOfStore,
  yearlyTotal,
} from '../lib/billing.js';

const router = Router();
// Stripe needs absolute return URLs, so local dev falls back to the Vite server
const RETURN_URL = APP_URL || 'http://localhost:5173';

async function summary(orgId: number) {
  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
  const state = billingState(org);
  const storesUsed = await storesInUse(orgId);
  const paid = state === 'active' || state === 'past_due' ? (org.storeLimit ?? storesUsed) : null;
  // a trial only counts down while billing is live
  const trialEndsAt = state === 'trial' || state === 'lapsed' ? org.trialEndsAt : null;
  const on = addonsFor(org);
  const paying = state === 'active' || state === 'past_due';
  const paidAddons = paying ? ADDONS.filter((a) => org.addons.includes(a)) : [];
  const used = state === 'trial' ? await addonsUsed(orgId) : [];
  return {
    enabled: billingEnabled(),
    state,
    trialEndsAt,
    daysLeft: trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000)) : null,
    storeLimit: org.storeLimit,
    storesInUse: storesUsed,
    paidStores: paid,
    monthly: (paid != null ? monthlyTotal(paid) : monthlyTotal(Math.max(1, storesUsed))) + ADDON_PRICE * paidAddons.length,
    /** the stores part alone — the Subscribe step adds the chosen add-ons to it */
    storesMonthly: paid != null ? monthlyTotal(paid) : monthlyTotal(Math.max(1, storesUsed)),
    nextStorePrice: priceOfStore((paid ?? Math.max(1, storesUsed)) + 1),
    addonPrice: ADDON_PRICE,
    /** how the current plan is billed — null until there is one */
    interval: paying ? (org.billingInterval === 'year' ? 'year' : 'month') : null,
    /** paying yearly instead: 88% of twelve months, rounded up */
    storesYearly: yearlyTotal(paid ?? Math.max(1, storesUsed)),
    nextStoreYearlyPrice: yearlyPriceOfStore((paid ?? Math.max(1, storesUsed)) + 1),
    addonYearlyPrice: ADDON_PRICE_YEARLY,
    refundDays: REFUND_DAYS,
    addons: ADDONS.map((key) => ({ key, on: on.includes(key), paid: paidAddons.includes(key), usedInTrial: used.includes(key) })),
    hasBillingAccount: !!org.stripeCustomerId,
  };
}

/** Add-ons the business actually used during its trial — pre-ticked when it subscribes. */
async function addonsUsed(orgId: number): Promise<AddonKey[]> {
  const inOrg = { store: { orgId } };
  const [messages, dms, notes, closing, asked] = await Promise.all([
    prisma.message.count({ where: inOrg, take: 1 }),
    prisma.directMessage.count({
      where: {
        sender: { OR: [{ orgId }, { employee: { is: { employeeStores: { some: { store: { orgId } } } } } }] },
      },
      take: 1,
    }),
    prisma.shiftNote.count({ where: inOrg, take: 1 }),
    prisma.closingDuty.count({ where: inOrg, take: 1 }),
    // only counts once they've gone past what the plan includes
    prisma.assistantRequest.count({ where: { orgId } }),
  ]);
  return [
    ...(messages + dms > 0 ? (['chat'] as const) : []),
    ...(notes > 0 ? (['notes'] as const) : []),
    ...(closing > 0 ? (['closing'] as const) : []),
    ...(asked > INCLUDED_REQUESTS ? (['assistant'] as const) : []),
  ];
}

// GET /billing — the business's plan, for Settings › Plan
router.get('/', ...requireOwner, async (req, res) => {
  res.json(await summary(req.user!.orgId!));
});

function requireBilling(res: Response): boolean {
  if (billingEnabled()) return true;
  res.status(409).json({ error: 'Billing isn’t set up yet.' });
  return false;
}

// POST /billing/checkout — start a subscription through Stripe Checkout. An
// unfinished free trial carries over, so subscribing early costs nothing
// until the day the trial would have ended.
router.post('/checkout', ...requireOwner, async (req, res) => {
  if (!requireBilling(res)) return;
  const orgId = req.user!.orgId!;
  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
  const state = billingState(org);
  if (state === 'active' || state === 'past_due' || state === 'exempt') {
    return res.status(409).json({ error: 'This business already has a plan.' });
  }
  const chosen: AddonKey[] = Array.isArray(req.body?.addons) ? [...new Set(req.body.addons.filter(isAddonKey))] as AddonKey[] : [];
  const interval: Interval = req.body?.interval === 'year' ? 'year' : 'month';
  try {
    let customerId = org.stripeCustomerId;
    if (!customerId) {
      const c = await stripe().customers.create({ email: req.user!.email, name: org.name, metadata: { orgId: String(orgId) } });
      customerId = c.id;
      await prisma.org.update({ where: { id: orgId }, data: { stripeCustomerId: customerId } });
    }
    // Stripe wants a trial end at least 2 days out; closer than that, just start now
    const trialEnd =
      org.trialEndsAt && org.trialEndsAt.getTime() > Date.now() + 2 * 86_400_000
        ? Math.floor(org.trialEndsAt.getTime() / 1000)
        : undefined;
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: String(orgId),
      line_items: [
        { price: await storesPriceId(interval), quantity: Math.max(1, await storesInUse(orgId)) },
        ...(await Promise.all(chosen.map(async (key) => ({ price: await addonPriceId(key, interval), quantity: 1 })))),
      ],
      subscription_data: { metadata: { orgId: String(orgId) }, ...(trialEnd ? { trial_end: trialEnd } : {}) },
      success_url: `${RETURN_URL}/settings?billing=done`,
      cancel_url: `${RETURN_URL}/settings`,
    });
    res.json({ url: session.url });
  } catch (e) {
    alertError('billing.checkout', e, { orgId });
    res.status(502).json({ error: 'Couldn’t reach the payment page. Try again in a minute.' });
  }
});

// POST /billing/stores { quantity } — change how many stores the plan pays
// for. The prorated difference is charged (or credited) right away, and the
// change only happens if the card goes through.
router.post('/stores', ...requireOwner, async (req, res) => {
  if (!requireBilling(res)) return;
  const orgId = req.user!.orgId!;
  const quantity = req.body?.quantity;
  const used = await storesInUse(orgId);
  if (!Number.isInteger(quantity) || quantity < Math.max(1, used) || quantity > 1000) {
    return res.status(400).json({ error: `Pick a number of stores from ${Math.max(1, used)} up.` });
  }
  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
  if (billingState(org) !== 'active' || !org.stripeSubscriptionId) {
    return res.status(409).json({ error: 'Subscribe first, then you can add stores.' });
  }
  try {
    const sub = await stripe().subscriptions.retrieve(org.stripeSubscriptionId);
    const item = storesItem(sub);
    if (!item) throw new Error('subscription has no stores item');
    const updated = await stripe().subscriptions.update(sub.id, {
      items: [{ id: item.id, quantity }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'error_if_incomplete',
    });
    await syncFromSubscription(updated);
    res.json(await summary(orgId));
  } catch (e) {
    const card = (e as { type?: string }).type === 'StripeCardError';
    if (!card) alertError('billing.stores', e, { orgId, quantity });
    res.status(card ? 402 : 502).json({
      error: card ? 'Your card was declined — update it under Manage billing.' : 'Couldn’t change your plan. Try again in a minute.',
    });
  }
});

// POST /billing/addons { key, on } — add or remove one add-on on a paid
// plan. Adding charges the prorated $2 right away (and only happens if the
// card goes through); removing credits it. Turning one off never deletes its
// data — it's there again the moment it's turned back on.
router.post('/addons', ...requireOwner, async (req, res) => {
  if (!requireBilling(res)) return;
  const orgId = req.user!.orgId!;
  const { key, on } = req.body ?? {};
  if (!isAddonKey(key) || typeof on !== 'boolean') return res.status(400).json({ error: 'Unknown add-on' });
  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
  if (billingState(org) !== 'active' || !org.stripeSubscriptionId) {
    return res.status(409).json({ error: 'Subscribe first, then you can change add-ons.' });
  }
  try {
    const sub = await stripe().subscriptions.retrieve(org.stripeSubscriptionId);
    const item = sub.items.data.find((i) => addonOfItem(i) === key);
    if (on === !!item) return res.json(await summary(orgId)); // already that way
    const updated = await stripe().subscriptions.update(sub.id, {
      // the same billing period as the rest of the plan — Stripe won't mix them
      items: on ? [{ price: await addonPriceId(key, intervalOf(sub)), quantity: 1 }] : [{ id: item!.id, deleted: true }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'error_if_incomplete',
    });
    await syncFromSubscription(updated);
    res.json(await summary(orgId));
  } catch (e) {
    const card = (e as { type?: string }).type === 'StripeCardError';
    if (!card) alertError('billing.addons', e, { orgId, key, on });
    res.status(card ? 402 : 502).json({
      error: card ? 'Your card was declined — update it under Manage billing.' : 'Couldn’t change your plan. Try again in a minute.',
    });
  }
});

// POST /billing/portal — Stripe's own page for the card, invoices and cancelling
router.post('/portal', ...requireOwner, async (req, res) => {
  if (!requireBilling(res)) return;
  const org = await prisma.org.findUniqueOrThrow({ where: { id: req.user!.orgId! } });
  if (!org.stripeCustomerId) return res.status(409).json({ error: 'Subscribe first.' });
  try {
    const s = await stripe().billingPortal.sessions.create({ customer: org.stripeCustomerId, return_url: `${RETURN_URL}/settings` });
    res.json({ url: s.url });
  } catch (e) {
    alertError('billing.portal', e, { orgId: org.id });
    res.status(502).json({ error: 'Couldn’t open billing. Try again in a minute.' });
  }
});

export default router;

/** POST /api/billing/webhook — Stripe's notices about subscriptions. Mounted
 * in index.ts ahead of express.json(), since the signature is checked against
 * the raw body. Every event re-reads the subscription from Stripe and syncs it,
 * so retries and out-of-order delivery are harmless. */
export async function billingWebhook(req: Request, res: Response) {
  if (!billingEnabled()) return res.status(404).end();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(
      req.body as Buffer,
      req.headers['stripe-signature'] as string,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch {
    return res.status(400).json({ error: 'Bad signature' });
  }

  // money in and out of a business a student brought in: their share
  if (event.type === 'invoice.paid' || event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
    try {
      if (event.type === 'invoice.paid') await commissionForInvoice(event.data.object.id!);
      else if (event.type === 'charge.refunded') {
        const c = event.data.object;
        const ref = typeof c.payment_intent === 'string' ? c.payment_intent : (c.payment_intent?.id ?? c.id);
        if (c.amount > 0) await reverseForPayment(ref, c.amount_refunded / c.amount, 'the business was refunded');
      } else {
        const d = event.data.object;
        const ref = typeof d.payment_intent === 'string' ? d.payment_intent : (d.payment_intent?.id ?? (typeof d.charge === 'string' ? d.charge : d.charge.id));
        await reverseForPayment(ref, 1, 'the business disputed the charge');
      }
      return res.json({ received: true });
    } catch (e) {
      alertError('billing.webhook.commission', e, { type: event.type });
      return res.status(500).json({ error: 'commission failed' }); // Stripe retries
    }
  }

  let subscriptionId: string | null = null;
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    subscriptionId = typeof s.subscription === 'string' ? s.subscription : (s.subscription?.id ?? null);
  } else if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    subscriptionId = event.data.object.id;
  }
  if (!subscriptionId) return res.json({ received: true });

  try {
    await syncFromSubscription(await stripe().subscriptions.retrieve(subscriptionId));
    res.json({ received: true });
  } catch (e) {
    alertError('billing.webhook', e, { type: event.type, subscriptionId });
    res.status(500).json({ error: 'sync failed' }); // Stripe retries
  }
}

/** A paid invoice, as the ambassador rules need it: which business, what was
 * collected, how (so a refund can find it), and its stores lines. */
async function commissionForInvoice(invoiceId: string) {
  const inv = await stripe().invoices.retrieve(invoiceId, { expand: ['payments', 'lines.data.pricing.price_details.price'] });
  const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
  if (!customerId) return;
  const org = await prisma.org.findUnique({ where: { stripeCustomerId: customerId }, select: { id: true } });
  if (!org) return;
  let lines = inv.lines.data;
  if (inv.lines.has_more) lines = (await stripe().invoices.listLineItems(invoiceId, { limit: 100, expand: ['data.pricing.price_details.price'] })).data;
  const payment = inv.payments?.data.find((p) => p.status === 'paid')?.payment;
  const ref = payment
    ? typeof payment.payment_intent === 'string'
      ? payment.payment_intent
      : (payment.payment_intent?.id ?? (typeof payment.charge === 'string' ? payment.charge : (payment.charge?.id ?? null)))
    : null;
  const paid: PaidInvoice = {
    invoiceId,
    orgId: org.id,
    paidAt: new Date((inv.status_transitions.paid_at ?? Math.floor(Date.now() / 1000)) * 1000),
    billingReason: inv.billing_reason ?? null,
    amountPaid: inv.amount_paid,
    subtotal: inv.subtotal,
    paymentRef: ref,
    storeLines: lines.flatMap((l) => {
      const price = l.pricing?.price_details?.price;
      if (!price || typeof price === 'string' || !isStoresPrice(price)) return [];
      return [
        {
          interval: (price.recurring?.interval === 'year' ? 'year' : 'month') as Interval,
          quantity: l.quantity ?? 1,
          amount: l.amount,
          // a mid-month change (a store added) is billed as a part-period line
          proration: !!l.parent?.subscription_item_details?.proration,
          periodStart: l.period?.start ? new Date(l.period.start * 1000) : null,
          periodEnd: l.period?.end ? new Date(l.period.end * 1000) : null,
        },
      ];
    }),
  };
  await recordPaidInvoice(paid);
}
