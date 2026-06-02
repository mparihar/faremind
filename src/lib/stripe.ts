/**
 * ═══════════════════════════════════════════════
 * FareMind — Stripe Client
 * ═══════════════════════════════════════════════
 *
 * Server-side Stripe SDK singleton.
 * Used by checkout payment routes to create and confirm PaymentIntents.
 *
 * Requires STRIPE_SECRET_KEY in .env
 */

import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('[Stripe] STRIPE_SECRET_KEY is not set — payment processing will fail');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  typescript: true,
});
