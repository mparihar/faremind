/**
 * ═══════════════════════════════════════════════
 * FareMind — Stripe Client
 * ═══════════════════════════════════════════════
 *
 * Server-side Stripe SDK lazy singleton.
 * Used by checkout payment routes to create and confirm PaymentIntents.
 *
 * Requires STRIPE_SECRET_KEY in .env
 *
 * NOTE: Stripe v22+ throws at construction if the key is empty.
 * We lazy-init so the module can still load (returning a clear JSON
 * error) instead of crashing the entire route with an HTML 500 page.
 */

import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is not configured — payment processing is unavailable.');
    }
    _stripe = new Stripe(key, { typescript: true });
  }
  return _stripe;
}

/** @deprecated Use getStripe() for safe lazy initialization */
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return (getStripe() as any)[prop];
  },
});
