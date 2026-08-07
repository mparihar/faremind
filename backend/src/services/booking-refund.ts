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
import { classifyRefund, refundQueue, type RefundState } from '../lib/refund-status';

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

  // A refund that is merely PENDING has not failed — it is money in flight, and
  // writing a failure reason for it makes it read as owed on every screen that
  // classifies off that field. Only a genuine failure gets one.
  const failed = status === 'failed' || status === 'canceled';
  const reason = failed ? (failureReason ?? `Stripe refund ${status}`) : null;

  await prisma.bookingFailureAudit.update({
    where: { id: audit.id },
    data: {
      refundStatus: settled ? 'REFUND_ISSUED' : 'REFUND_PENDING',
      refundId,
      refundAmount: amount,
      refundedAt: settled ? new Date() : null,
      // A refund that fails AFTER acceptance is the case nothing could see
      // before: the create() succeeded, so we told the customer it was done.
      refundFailureReason: reason,
    },
  }).catch((e) => console.warn(`[BookingRefund] could not record ${refundId}: ${e.message}`));

  const state = classifyRefund({
    stripePaymentIntentId: paymentIntentId,
    refundStatus: settled ? 'REFUND_ISSUED' : 'REFUND_PENDING',
    refundId,
    refundFailureReason: reason,
  });

  console.log(
    `[BookingRefund] webhook: ${refundId} ${status} — ${amount.toFixed(2)} ${currency} ` +
    `(audit ${audit.id}) → ${state}`,
  );

  await syncFailureTicket({ auditId: audit.id, state, refundId, amount, currency, status, failureReason: reason });
}

/**
 * Move the support ticket with the money.
 *
 * Every booking failure opens a ticket in the support queue, and it carried the
 * refund status as text written once, at creation. That text was a snapshot of
 * what we had just ASKED Stripe for, and nothing ever revised it — so a ticket
 * reading "MANUAL REFUND REQUIRED" stayed that way after the money landed, and
 * one auto-closed on "refund issued" stayed closed even when the refund later
 * failed. Support was reading the request, not the outcome.
 *
 * The webhook is the only thing that knows which it turned out to be, so it
 * writes the verdict onto the ticket too: cleared and closed when the money is
 * back, reopened and queued for a human when it is not. Each transition leaves
 * an internal message, so the thread shows what happened and when rather than
 * silently changing state under whoever is holding it.
 */
async function syncFailureTicket(params: {
  auditId: string;
  state: RefundState;
  refundId: string;
  amount: number;
  currency: string;
  status: string;
  failureReason?: string | null;
}): Promise<void> {
  const { auditId, state, refundId, amount, currency, status, failureReason } = params;

  try {
    // failureAuditId is unique — one ticket per failure.
    const ticket = await prisma.supportTicket.findUnique({
      where: { failureAuditId: auditId },
      select: { id: true, status: true, assignedToId: true },
    });
    if (!ticket) return;

    const money = `${amount.toFixed(2)} ${currency}`;

    if (state === 'REFUNDED') {
      await prisma.supportTicket.update({
        where: { id: ticket.id },
        data: {
          // Someone holding the ticket gets RESOLVED, not CLOSED — closing a
          // ticket out from under the person working it hides it from them
          // before they have seen why it moved.
          status: ticket.assignedToId ? 'RESOLVED' : 'CLOSED',
          closedAt: ticket.assignedToId ? null : new Date(),
          queue: null,
        },
      });
      await postTicketNote(ticket.id,
        `Refund confirmed by Stripe — ${money} returned to the original card (${refundId}).\n` +
        `No further action required.`);
      return;
    }

    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status: 'OPEN',
        closedAt: null,
        priority: 'URGENT',
        queue: refundQueue(state),
      },
    });
    await postTicketNote(ticket.id, state === 'IN_FLIGHT'
      ? `Refund ${refundId} for ${money} is in flight at Stripe — accepted, not yet settled.\n` +
        `Monitor; this ticket closes itself when Stripe confirms.`
      : `REFUND FAILED — the customer is still owed ${money}.\n` +
        `Stripe reported "${status}"${failureReason ? `: ${failureReason}` : ''} for ${refundId}.\n` +
        `This must be refunded manually.`);
  } catch (e) {
    // The audit is already written and is the record of what is owed. A ticket
    // that could not be synced must not lose that.
    console.warn(`[BookingRefund] could not sync ticket for audit ${auditId}: ${(e as Error).message}`);
  }
}

/** An internal note on the ticket thread — staff-visible, never sent to the customer. */
async function postTicketNote(ticketId: string, content: string): Promise<void> {
  await prisma.supportTicketMessage.create({
    data: { ticketId, senderId: null, content, isInternal: true },
  }).catch((e) => console.warn(`[BookingRefund] note failed on ${ticketId}: ${e.message}`));
}
