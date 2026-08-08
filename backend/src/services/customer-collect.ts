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
import { fireNotification } from '../lib/notify';

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

// The bare refundCollection() that used to live here has been removed. It
// issued a Stripe refund and did nothing else — no BookingRefund row, no
// timeline entry, no ServicePayment update, no email — and it had no callers
// left. Keeping an unaudited refund helper around is an invitation to wire it up
// in a hurry and silently return money to a customer nobody tells.
// Use refundCollectionWithAudit below.

/**
 * The email for a reversed servicing collection.
 *
 * Says what it is refunding and why, because "we have refunded you $120" against
 * a booking the customer still holds reads as a mistake unless it names the
 * reissue that failed.
 */
async function notifyCollectionReversed(params: {
  bookingId: string;
  amount: number | null;
  currency: string;
  reason: string;
  stripeRefundId: string;
  bookingRef?: string;
}): Promise<void> {
  try {
    const booking = await prisma.masterBooking.findUnique({
      where: { id: params.bookingId },
      select: {
        masterBookingReference: true, customerEmail: true, customerName: true,
        airlinePnr: true, masterPnr: true, originAirport: true, destinationAirport: true,
        agentEmail: true, agentName: true,
      },
    });

    await fireNotification({
      event_type: 'REFUND_ISSUED' as any,
      booking_id: params.bookingId,
      customer_email: booking?.customerEmail ?? undefined,
      data: {
        customer_name: booking?.customerName?.split(' ')[0] || 'Traveler',
        booking_reference: booking?.masterBookingReference ?? params.bookingRef ?? null,
        airline_pnr: booking?.airlinePnr ?? null,
        mystifly_ref: booking?.masterPnr ?? null,   // internal recipients only
        route: booking ? `${booking.originAirport} → ${booking.destinationAirport}` : null,
        refund_amount: params.amount != null ? `${params.currency} ${params.amount.toFixed(2)}` : 'The amount collected',
        refund_reference: params.stripeRefundId,
        // Names the servicing action, so the refund is not mistaken for the
        // booking itself being cancelled.
        refund_timeline: `This reverses the amount collected for a booking change, because ${params.reason}. ` +
          `Your original booking is unaffected. It can take 5–10 business days to appear on your statement.`,
        agent_email: booking?.agentEmail ?? null,
        agent_name: booking?.agentName ?? null,
      },
    });
  } catch (e: any) {
    // A refund that happened must never be undone by a mail failure.
    console.warn(`[collect-refund] notification failed for ${params.bookingId}: ${e?.message}`);
  }
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
 * This replaced a bare refundCollection() that issued the Stripe refund and
 * nothing else: a reversed collection left no BookingRefund, no timeline entry
 * and a ServicePayment still reading SUCCEEDED, and a refund that itself failed
 * was only console.error'd — the customer stayed charged with nobody told. This
 * records the reversal the way a cancellation refund is recorded, emails the
 * customer, agent and support, and escalates loudly when it cannot be made.
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

    // Tell the customer their money is coming back.
    //
    // This path recorded the reversal thoroughly — BookingRefund, timeline,
    // ServicePayment — and told nobody. A customer charged a fare difference for
    // a reissue the airline then refused got that money back in silence, and the
    // agent and support learned about it from a statement.
    //
    // NOT a commission reversal: this reverses a SERVICING collection, not the
    // booking. The original booking still stands, and the agent's commission on
    // it was earned and remains earned.
    await notifyCollectionReversed({
      bookingId,
      amount,
      currency,
      reason,
      stripeRefundId: stripeRefund.id,
      bookingRef: params.bookingRef,
    });

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
