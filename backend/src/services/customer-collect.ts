/**
 * Customer collection helper — charge the booking's ORIGINAL card off-session.
 *
 * Shared by the servicing flows that must collect money from the customer after
 * booking (Reissue + Collect Difference, and Change Flight fare-difference +
 * service fee). Centralises the Stripe off-session charge + refund so every
 * flow behaves identically.
 *
 * The charge is attempted on the payment method saved on the booking's most
 * recent SUCCEEDED BookingPayment (its Stripe PaymentIntent). Callers decide
 * what to do with each outcome (record a pending task, block the operation,
 * refund on downstream failure, etc.).
 */

import Stripe from 'stripe';
import { prisma } from '../lib/db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { typescript: true });

export type CollectStatus = 'CHARGED' | 'NO_SAVED_CARD' | 'FAILED' | 'NOTHING_DUE';

export interface CollectResult {
  status: CollectStatus;
  chargeId: string | null;
  /** Populated when status === 'FAILED'. */
  error?: string;
}

export interface CollectOptions {
  /** Human-readable Stripe description. */
  description: string;
  /** Stripe metadata `kind` (e.g. 'reissue_collect', 'change_collect'). */
  kind: string;
  /** Optional Stripe idempotency key to guard against double-charge on retry. */
  idempotencyKey?: string;
}

/**
 * Attempt an off-session USD charge on the booking's original card.
 * Never throws — returns a typed result the caller interprets.
 */
export async function chargeOriginalCard(
  booking: any,
  amountUsd: number,
  opts: CollectOptions,
): Promise<CollectResult> {
  if (!(amountUsd > 0)) return { status: 'NOTHING_DUE', chargeId: null };

  const bookingId = booking.id;
  const lastPayment = await prisma.bookingPayment.findFirst({
    where: { bookingId, status: 'SUCCEEDED' },
    orderBy: { paidAt: 'desc' },
  });

  let payment_method: string | undefined;
  let customer: string | undefined;
  if (lastPayment?.stripePaymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(lastPayment.stripePaymentIntentId);
      payment_method = (pi.payment_method as string) || undefined;
      customer = (pi.customer as string) || undefined;
    } catch { /* ignore — treated as no saved card below */ }
  }

  if (!payment_method) return { status: 'NO_SAVED_CARD', chargeId: null };

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: Math.round(amountUsd * 100),
        currency: 'usd',
        customer,
        payment_method,
        off_session: true,
        confirm: true,
        description: opts.description,
        metadata: { bookingId, kind: opts.kind },
      },
      opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
    );
    if (pi.status !== 'succeeded') {
      return { status: 'FAILED', chargeId: null, error: `charge not completed (status ${pi.status})` };
    }
    return { status: 'CHARGED', chargeId: pi.id };
  } catch (err: any) {
    return { status: 'FAILED', chargeId: null, error: err?.message || 'charge error' };
  }
}

/** Refund a previously created collection charge (best-effort caller logging). */
export async function refundCollection(chargeId: string): Promise<void> {
  await stripe.refunds.create({ payment_intent: chargeId });
}
