import { Capacitor } from '@capacitor/core'

// Twin of Backend/src/lib/billing.ts — for showing prices only; Stripe does
// the charging. $16/month includes the first store; each further store costs
// $2 less than the one before it, down to $10.
export const priceOfStore = (n: number): number => Math.max(16 - 2 * (n - 1), 10)

/** The iOS/Android app never offers a way to buy — app store rules say digital
 * purchases there must go through their own payment systems. */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform()
