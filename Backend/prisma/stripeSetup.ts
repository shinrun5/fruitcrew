// One-time: create FruitCrew's per-store price in Stripe, then print the id to
// put in STRIPE_PRICE_STORES. Safe to run again — it finds the price it made
// before (by lookup key) instead of making a second one.
//
//   STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup
//
// The price is graduated: the 1st store is $16/month, the 2nd $14, the 3rd
// $12, and every one after that $10. A subscription's quantity is its number
// of stores, and Stripe adds the tiers up itself (3 stores = $42/month).
import Stripe from 'stripe';

const LOOKUP_KEY = 'fruitcrew_stores_monthly';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Set STRIPE_SECRET_KEY first (use the test-mode key until you go live).');
  process.exit(1);
}
const stripe = new Stripe(key);

const existing = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], limit: 1 });
if (existing.data[0]) {
  console.log(`Already set up.\n\nSTRIPE_PRICE_STORES=${existing.data[0].id}`);
  process.exit(0);
}

const product = await stripe.products.create({
  name: 'FruitCrew',
  description: 'Scheduling, payroll hours and shift trading — priced per store.',
});
const price = await stripe.prices.create({
  product: product.id,
  currency: 'usd',
  lookup_key: LOOKUP_KEY,
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
console.log(`Created.\n\nSTRIPE_PRICE_STORES=${price.id}`);
