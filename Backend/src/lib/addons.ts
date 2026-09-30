import type { NextFunction, Request, Response } from 'express';
import { billingState, type OrgBilling } from './billing.js';

// Features a business pays for separately, per business, on top of the
// per-store plan — "everything you need, included; everything you want,
// provided". Each is one $2/month Stripe price (see prisma/stripeSetup.ts);
// Frontend/src/lib/addons.ts is the twin of this list.
export const ADDONS = ['chat', 'notes', 'closing'] as const;
export type AddonKey = (typeof ADDONS)[number];
export const ADDON_PRICE = 2;
export const addonLookupKey = (key: AddonKey) => `fruitcrew_addon_${key}`;
export const isAddonKey = (v: unknown): v is AddonKey => typeof v === 'string' && (ADDONS as readonly string[]).includes(v);

/** Which add-ons a business can use right now. Everything is on unless it's
 * actually paying: while billing is off, when comped, and during the free
 * trial (so they get to try them). A paying business has what its
 * subscription pays for; a lapsed one is locked out anyway. */
export function addonsFor(org: OrgBilling & { addons: string[] }): AddonKey[] {
  const state = billingState(org);
  if (state === 'active' || state === 'past_due') return ADDONS.filter((a) => org.addons.includes(a));
  if (state === 'lapsed') return [];
  return [...ADDONS];
}

/** Route guard: the signed-in user's business must have this add-on on. */
export function requireAddon(key: AddonKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.isSuperAdmin || req.user.addons.includes(key)) return next();
    res.status(403).json({ error: 'This isn’t turned on for your business.', addonRequired: key });
  };
}
