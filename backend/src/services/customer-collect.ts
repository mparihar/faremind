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

export interface CollectionRefundResult {
  refunded: boolean;
  amount: number | null;
  stripeRefundId: string | null;
  error?: string;
}

/**
 * Give back a collection we took for a servicing action that then failed — e.g. the
 * airline refused the reissue we had already charged for.
 *
 * The bare refundCollection() above issues the Stripe refund and nothing else, so a
 * reversed collection left no BookingRefund, no timeline entry and a ServicePayment
 * still reading SUCCEEDED, and a refund that itself failed was only console.error'd —
 * the customer stayed charged with nobody told. This records the reversal the same way
 * a cancellation refund is recorded, and escalates loudly when it cannot be made.
 *
 * Refunds the whole PaymentIntent (Stripe's default with no `amount`), which is exactly
 * what the customer paid for the servicing action: fare difference plus service fee.
 * Never throws — returns a typed result.
 */
export async function refundCollectionWithAudit(params: {
  bookingId: string;
  chargeId: string;
  /** Amount collected, for records. Falls back to the Stripe refund amount. */
  amount?: number | null;
  currency?: string;
  /** Why it is being reversed, e.g. 'the airline rejected the reissue'. */
  reason: string;
  /** Timeline event type, e.g. 'REISSUE_REFUNDED'. */
  eventType?: string;
  bookingRef?: string;
}): Promise<CollectionRefundResult> {
  const { bookingId, chargeId, reason } = params;
  const currency = params.currency || 'USD';

  try {
    const stripeRefund = await stripe.refunds.create(
      { payment_intent: chargeId, reason: 'requested_by_customer', metadata: { booking_id: bookingId, kind: 'collection_reversal' } },
      { idempotencyKey: `collect-refund-${chargeId}` },
    );
    const amount = params.amount ?? (stripeRefund.amount != null ? stripeRefund.amount / 100 : null);

    await prisma.bookingRefund.create({
      data: {
        bookingId, amount: amount ?? 0, currency,
        method: 'ORIGINAL_PAYMENT', status: 'COMPLETED', provider: 'MYSTIFLY',
      },
    }).catch((e: any) => console.error('[collect-refund] BookingRefund record failed:', e?.message));

    // The collection's ServicePayment must stop claiming the customer paid.
    await prisma.servicePayment.updateMany({
      where: { stripePaymentIntentId: chargeId },
      data: { status: 'REFUNDED' },
    }).catch(() => {});

    await prisma.bookingEvent.create({
      data: {
        bookingId,
        eventType: params.eventType || 'COLLECTION_REFUNDED',
        eventTitle: 'Collected Amount Refunded',
        eventDescription: `${amount != null ? `${amount.toFixed(2)} ${currency}` : 'The collected amount'} was refunded to the original card because ${reason}. Stripe refund ${stripeRefund.id}.`,
        actorType: 'system', actorName: 'Collection Reversal',
        payloadJson: { stripeRefundId: stripeRefund.id, amount, chargeId } as any,
      },
    }).catch(() => {});

    console.log(`[collect-refund] refunded ${chargeId} (${amount ?? '?'} ${currency}) — ${reason}`);
    return { refunded: true, amount, stripeRefundId: stripeRefund.id };
  } catch (err: any) {
    const message = err?.message || 'Stripe refund failed';
    console.error(`[collect-refund] CRITICAL: refund of ${chargeId} FAILED — customer still charged: ${message}`);

    await prisma.bookingEvent.create({
      data: {
        bookingId, eventType: 'REFUND_FAILED', eventTitle: 'Refund Failed',
        eventDescription: `The amount collected from the customer could NOT be refunded after ${reason}: ${message}. The customer is still charged — a manual refund is required.`,
        actorType: 'system', actorName: 'Collection Reversal',
      },
    }).catch(() => {});

    await prisma.supportTicket.create({
      data: {
        subject: `Collection refund FAILED: ${params.bookingRef || bookingId} — customer still charged`,
        description: [
          `A collection taken from the customer could not be refunded after ${reason}.`,
          '', `Stripe PaymentIntent: ${chargeId}`,
          `Amount: ${params.amount != null ? `${Number(params.amount).toFixed(2)} ${currency}` : 'unknown'}`,
          `Error: ${message}`, '', 'A manual refund to the original card is required.',
        ].join('\n'),
        priority: 'HIGH', status: 'OPEN', category: 'Refund', channel: 'SYSTEM',
        bookingRef: params.bookingRef || undefined,
        ticketType: 'REFUND', queue: 'CANCELLATION_SUPPORT',
      } as any,
    }).catch(() => {});

    return { refunded: false, amount: params.amount ?? null, stripeRefundId: null, error: message };
  }
}
