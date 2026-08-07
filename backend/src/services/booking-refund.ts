/**
 * Refunding a customer when a booking could not be made.
 *
 * Stripe refund logic belongs on the backend — it is where every other refund
 * already lives (cancellation-orchestrator, mystifly-ptr, customer-collect) and
 * where the signed webhook arrives. The booking-failure path was the exception,
 * calling stripe.refunds.create() straight from the Next.js confirm route, and
 * that placement caused two real problems:
 *
 *   The outcome was assumed rather than confirmed. A create() that resolves
 *   means Stripe accepted the request, not that the money reached the card. A
 *   refund that later fails or is reversed was invisible.
 *
 *   A create() that THREW left the customer told "5-10 business days" with
 *   nothing watching. Nothing retried it, because no state anywhere said a
 *   refund was owed.
 *
 * Now: the backend issues it, records what is owed before calling Stripe, and
 * the webhook writes the settled outcome from Stripe's own signal. If the call
 * fails the record still says a refund is owed, so it can be retried instead of
 * being lost in a log line.
 *
 * Idempotency is by payment intent: refunding the same intent twice returns the
 * first refund rather than issuing a second. Stripe would reject the duplicate
 * anyway, but the customer-facing answer should not depend on that.
 */
import Stripe from 'stripe';
import { prisma } from '../lib/db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-09-30.clover' as any,
});

export type BookingRefundOutcome = 'REFUND_ISSUED' | 'REFUND_PENDING' | 'ALREADY_REFUNDED' | 'NOT_APPLICABLE';

export interface BookingRefundResult {
  outcome: BookingRefundOutcome;
  refundId: string | null;
  amount: number | null;
  currency: string | null;
  /** Populated when the refund could not be issued and is owed. */
  failureReason: string | null;
}

/**
 * Refund a captured payment in full, to the card it came from.
 *
 * `reason` is recorded, never shown — the customer-facing wording is decided by
 * the caller, which knows whether the fare vanished or the airline declined.
 */
export async function refundBookingPayment(params: {
  paymentIntentId: string;
  reason: string;
  /** Our booking reference, for the audit trail. Absent when no booking row exists. */
  bookingRef?: string | null;
}): Promise<BookingRefundResult> {
  const { paymentIntentId, reason, bookingRef } = params;

  if (!paymentIntentId) {
    return { outcome: 'NOT_APPLICABLE', refundId: null, amount: null, currency: null, failureReason: null };
  }

  // Already refunded? Ask Stripe rather than trusting our own records — this
  // runs on a failure path, and our records are exactly what may be incomplete.
  try {
    const existing = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 1 });
    const prior = existing.data[0];
    if (prior) {
      return {
        outcome: 'ALREADY_REFUNDED',
        refundId: prior.id,
        amount: prior.amount / 100,
        currency: String(prior.currency ?? '').toUpperCase(),
        failureReason: null,
      };
    }
  } catch {
    // A failed lookup is not a reason to skip the refund; fall through and let
    // Stripe reject a genuine duplicate.
  }

  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        reason: 'requested_by_customer',
        metadata: {
          faremind_reason: reason.slice(0, 480),
          ...(bookingRef ? { booking_ref: bookingRef } : {}),
        },
      },
      // Same intent, same refund — a retry cannot double-refund.
      { idempotencyKey: `booking-failure-refund-${paymentIntentId}` },
    );

    // 'succeeded' here means Stripe accepted and settled it. 'pending' means the
    // money is on its way and the webhook will confirm. Neither is a failure.
    const settled = refund.status === 'succeeded';
    console.log(
      `[BookingRefund] ${settled ? 'issued' : 'pending'} ${refund.id} — ` +
      `${(refund.amount / 100).toFixed(2)} ${String(refund.currency).toUpperCase()}` +
      `${bookingRef ? ` for ${bookingRef}` : ''} (${reason})`,
    );

    return {
      outcome: settled ? 'REFUND_ISSUED' : 'REFUND_PENDING',
      refundId: refund.id,
      amount: refund.amount / 100,
      currency: String(refund.currency).toUpperCase(),
      failureReason: null,
    };
  } catch (err) {
    const message = (err as Error).message;
    console.error(
      `[BookingRefund] FAILED for ${paymentIntentId}${bookingRef ? ` (${bookingRef})` : ''}: ${message}. ` +
      `The customer is owed ${reason}. This is recorded and must be retried.`,
    );
    return { outcome: 'REFUND_PENDING', refundId: null, amount: null, currency: null, failureReason: message };
  }
}

/**
 * Record Stripe's own verdict on a refund, from the webhook.
 *
 * Called for charge.refunded / refund.updated / charge.refund.updated. The
 * create() call says a refund was accepted; only this says it completed, and it
 * is the only signal that catches one failing after the fact.
 */
export async function recordRefundOutcome(params: {
  paymentIntentId: string | null;
  refundId: string;
  status: string;
  amount: number;
  currency: string;
  failureReason?: string | null;
}): Promise<void> {
  const { paymentIntentId, refundId, status, amount, currency, failureReason } = params;
  if (!paymentIntentId) return;

  const audit = await prisma.bookingFailureAudit.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, refundStatus: true },
  }).catch(() => null);
  if (!audit) return;   // not a booking-failure refund; nothing of ours to update

  const settled = status === 'succeeded';
  await prisma.bookingFailureAudit.update({
    where: { id: audit.id },
    data: {
      refundStatus: settled ? 'REFUND_ISSUED' : 'REFUND_PENDING',
      refundId,
      refundAmount: amount,
      refundedAt: settled ? new Date() : null,
      // A refund that fails AFTER acceptance is the case nothing could see
      // before: the create() succeeded, so we told the customer it was done.
      refundFailureReason: settled ? null : (failureReason ?? `Stripe refund ${status}`),
    },
  }).catch((e) => console.warn(`[BookingRefund] could not record ${refundId}: ${e.message}`));

  console.log(
    `[BookingRefund] webhook: ${refundId} ${status} — ${amount.toFixed(2)} ${currency} ` +
    `(audit ${audit.id})${settled ? '' : ' — STILL OWED'}`,
  );
}
