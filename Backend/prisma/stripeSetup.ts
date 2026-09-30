// One-time: create FruitCrew's prices in Stripe, then print the id to put in
// STRIPE_PRICE_STORES. Safe to run again — anything it made before is found by
// its lookup key and reused, and only what's missing gets created.
//
//   STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup
//
// - Stores: graduated per-store price — the 1st store is $16/month, the 2nd
//   $14, the 3rd $12, every one after $10. A subscription's quantity is its
//   number of stores, and Stripe adds the tiers up itself (3 stores = $42).
// - Add-ons: Chat, Shift notes and Closing duties, $2/month each, one line per
//   add-on on the subscription. The app finds these by lookup key, so they
//   need no env vars (see src/lib/billing.ts addonPriceId).
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Set STRIPE_SECRET_KEY first (use the test-mode key until you go live).');
  process.exit(1);
}
const stripe = new Stripe(key);
const mode = key.startsWith('sk_live_') ? 'LIVE' : 'test';
// Stripe's tax category for business-use software as a service — required
// when Stripe handles sales tax (Managed Payments / Stripe Tax), right either way
const TAX_CODE = 'txcd_10103001';

/** Give a price's product the tax category if it doesn't have one yet. */
async function ensureTaxCode(price: Stripe.Price, label: string) {
  const productId = typeof price.product === 'string' ? price.product : price.product.id;
  const product = await stripe.products.retrieve(productId);
  const current = typeof product.tax_code === 'string' ? product.tax_code : product.tax_code?.id;
  if (current !== TAX_CODE) {
    await stripe.products.update(productId, { tax_code: TAX_CODE });
    console.log(`  · set the tax category on ${label}`);
  }
}

async function existing(lookupKey: string) {
  return (await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 })).data[0];
}

// --- stores
const STORES = 'fruitcrew_stores_monthly';
let stores = await existing(STORES);
if (stores) {
  console.log(`✓ Stores price already there (${stores.id})`);
  await ensureTaxCode(stores, 'the stores product');
} else {
  const product = await stripe.products.create({
    name: 'FruitCrew',
    description: 'Scheduling, payroll hours and shift trading — priced per store.',
    tax_code: TAX_CODE,
  });
  stores = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    lookup_key: STORES,
    nickname: 'Per store, monthly',
    recurring: { interval: 'month' },
    billing_scheme: 'tiered',
    tiers_mode: 'graduated',
    tiers: [
      { up_to: 1, unit_amount: 1600 },
      { up_to: 2, unit_amount: 1400 },
      { up_to: 3, unit_amount: 1200 },
      { up_to: 'inf', unit_amount: 1000 },
    ],
  });
  console.log(`+ Created the stores price (${stores.id})`);
}

// --- add-ons
const ADDONS: { key: string; name: string; description: string }[] = [
  { key: 'chat', name: 'FruitCrew add-on: Chat', description: 'Store group chat and direct messages.' },
  { key: 'notes', name: 'FruitCrew add-on: Shift notes', description: 'The shift handoff log — refunds, complaints, lost & found.' },
  { key: 'closing', name: 'FruitCrew add-on: Closing duties', description: 'Who closes, and what needs doing before they leave.' },
];
for (const a of ADDONS) {
  const lookupKey = `fruitcrew_addon_${a.key}`;
  const found = await existing(lookupKey);
  if (found) {
    console.log(`✓ ${a.name} already there (${found.id})`);
    await ensureTaxCode(found, a.name);
    continue;
  }
  const product = await stripe.products.create({ name: a.name, description: a.description, tax_code: TAX_CODE });
  const price = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    lookup_key: lookupKey,
    nickname: `${a.key} add-on, monthly`,
    recurring: { interval: 'month' },
    unit_amount: 200,
  });
  console.log(`+ Created ${a.name} (${price.id})`);
}

console.log(`\nDone (${mode} mode). Put this in the API's environment:\n\nSTRIPE_PRICE_STORES=${stores.id}`);
