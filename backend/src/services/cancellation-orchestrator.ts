/**
 * Cancellation Orchestration Service
 *
 * Central service managing the complete cancellation lifecycle:
 *   Customer confirms → Support ticket → Provider cancel → Stripe refund
 *   → Provider reimbursement monitoring → Reconciliation → Ticket closed
 *
 * Provider-specific logic is delegated through IBookingProvider adapters.
 * This service is provider-agnostic.
 */

import { prisma } from '../lib/db';
import * as mbq from '../lib/manage-booking-queries';
import { getProvider, type CancelResult } from './provider-adapter';
import { fireNotification } from '../lib/notify';
import Stripe from 'stripe';
import { randomBytes } from 'crypto';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { typescript: true });

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

export interface CancellationInitiateRequest {
  bookingId: string;
  quoteId: string;
  refundMethod?: string;
  /**
   * Manual USD refund amount to pay the customer, overriding the provider-derived
   * amount. Used by admin/agent "Force Cancel + Refund" when the auto-quote can't
   * produce a trustworthy amount (e.g. INR-penalty currency mismatch). When set,
   * this is used as the effective refund (before the FareMind service fee).
   */
  overrideRefundAmount?: number;
  /** Who triggered this (for logs/audit): e.g. 'ADMIN', 'AGENT'. */
  forcedBy?: string;
}

export interface CancellationInitiateResult {
  success: boolean;
  cancellationId: string;
  bookingRefundId: string;
  supportTicketId: string;
  bookingReference: string;
  cancellationMethod: string;
  refundAmount: number;
  refundCurrency: string;
  refundTimeline: string;
  refundMethod: string;
}

export interface ReconciliationResult {
  status: 'MATCHED' | 'MISMATCH' | 'MANUAL_REVIEW';
  expectedAmount: number;
  actualAmount: number;
  difference: number;
  currency: string;
}

export interface NormalizedProviderRefundStatus {
  status: 'PENDING' | 'PROCESSING' | 'SETTLED' | 'REJECTED' | 'FAILED' | 'UNKNOWN';
  providerRefundId?: string;
  settlementReference?: string;
  reimbursedAmount?: number;
  currency?: string;
  settledAt?: string;
  rawStatus?: string;
  rawResponse: unknown;
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function fmtCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

function generateIdempotencyKey(prefix: string, ...parts: string[]): string {
  return `${prefix}:${parts.join(':')}`;
}

function generateCorrelationId(): string {
  return `cor_${randomBytes(12).toString('hex')}`;
}

/** Calculate the next provider status check time using progressive polling */
function calculateNextCheckAt(checkCount: number, refundRequestedAt: Date): Date {
  const now = new Date();
  const daysSinceRequest = (now.getTime() - refundRequestedAt.getTime()) / (1000 * 60 * 60 * 24);

  let intervalHours: number;
  if (daysSinceRequest <= 2) {
    intervalHours = 6;       // First 48h: every 6 hours
  } else if (daysSinceRequest <= 7) {
    intervalHours = 12;      // Day 3–7: every 12 hours
  } else if (daysSinceRequest <= 14) {
    intervalHours = 24;      // Day 8–14: every 24 hours
  } else {
    intervalHours = -1;      // After 14 days: mark overdue
  }

  if (intervalHours < 0) return now; // Overdue — check immediately, will be flagged
  return new Date(now.getTime() + intervalHours * 60 * 60 * 1000);
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Initiate Cancellation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Master cancellation handler. Replaces the inline logic in manage-booking.ts.
 *
 * Flow:
 *   1. Validate booking eligibility
 *   2. Create support ticket (CANCEL_INITIATED)
 *   3. Submit cancellation to provider
 *   4. On success: process customer refund
 *   5. Set up reimbursement monitoring
 */
export async function initiateCancellation(
  req: CancellationInitiateRequest,
  booking: any,
): Promise<CancellationInitiateResult> {
  const { bookingId, quoteId, refundMethod = 'ORIGINAL_PAYMENT', overrideRefundAmount, forcedBy } = req;
  const correlationId = generateCorrelationId();
  const resolvedRefundMethod = refundMethod === 'AIRLINE_CREDIT' ? 'AIRLINE_CREDIT' : 'ORIGINAL_PAYMENT';
  const originalAmount = Number(booking.totalAmount);
  const providerPnr = booking.pnrs?.find((p: any) => p.providerOrderId);
  const primaryPnr = booking.pnrs?.find((p: any) => p.isPrimary) ?? booking.pnrs?.[0];
  const isRefundable = primaryPnr?.refundable ?? false;
  const ticketNumbers = (booking.passengers || []).map((p: any) => p.ticketNumber).filter(Boolean);

  const isVoid = quoteId.includes('void');
  const isCancelAnyway = quoteId.includes('norefund');

  // ── Step 1: Create support ticket immediately ──────────────────────
  const supportTicket = await prisma.supportTicket.create({
    data: {
      subject: `Cancellation: ${booking.masterBookingReference} — ${booking.customerName ?? 'Customer'}`,
      description: [
        `Customer confirmed cancellation for booking ${booking.masterBookingReference}.`,
        '',
        '── Booking Details ──',
        `Reference: ${booking.masterBookingReference}`,
        `Airline PNR: ${booking.masterPnr ?? 'N/A'}`,
        `Route: ${booking.originAirport} → ${booking.destinationAirport}`,
        `Departure: ${booking.departureDate ? new Date(booking.departureDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}`,
        `Amount: ${fmtCurrency(originalAmount, booking.currency)}`,
        `Provider: ${booking.primaryProvider ?? 'Unknown'}`,
        `Provider PNR: ${providerPnr?.providerOrderId ?? 'N/A'}`,
        `Ticket Numbers: ${ticketNumbers.join(', ') || 'N/A'}`,
        '',
        '── Cancellation Details ──',
        `Quote ID: ${quoteId}`,
        `Method: ${isVoid ? 'VOID' : isCancelAnyway ? 'CANCEL_NO_REFUND' : 'REFUND'}`,
        `Refundable: ${isRefundable ? 'Yes' : 'No'}`,
        `Correlation ID: ${correlationId}`,
        '',
        '── Customer ──',
        `Name: ${booking.customerName ?? 'N/A'}`,
        `Email: ${booking.customerEmail ?? 'N/A'}`,
        '',
        '── Status ──',
        'Cancellation initiated. Awaiting provider confirmation.',
      ].join('\n'),
      priority: 'NORMAL',
      status: 'CANCEL_INITIATED',
      category: 'Cancellation Request',
      channel: 'SYSTEM',
      customerName: booking.customerName ?? '',
      customerEmail: booking.customerEmail ?? '',
      bookingRef: booking.masterBookingReference,
      airlinePnr: booking.masterPnr ?? undefined,
      ticketType: 'BOOKING_CANCELLATION',
      queue: 'CANCELLATION_SUPPORT',
      providerPnr: providerPnr?.providerOrderId ?? undefined,
      providerBookingRef: providerPnr?.providerOrderId ?? undefined,
      correlationId,
    },
  });

  // ── Step 2: Create booking event ───────────────────────────────────
  await mbq.createBookingEvent({
    bookingId,
    eventType: 'CANCELLATION_STARTED',
    eventTitle: 'Cancellation initiated',
    eventDescription: `Support ticket ${supportTicket.ticketNumber || supportTicket.id} created. Submitting to provider.`,
    actorType: 'customer',
    actorId: booking.userId || undefined,
  });

  // ── Step 3: Execute provider cancellation ──────────────────────────
  let providerResult: CancelResult;
  try {
    const provider = getProvider(booking.primaryProvider);
    console.log(`[CANCEL_CONFIRM] Step 3: calling confirmCancellation`, JSON.stringify({ bookingId, quoteId, provider: booking.primaryProvider, isVoid, isCancelAnyway }));
    providerResult = await provider.confirmCancellation(quoteId);
    console.log(`[CANCEL_CONFIRM] Step 3 OK: provider confirmed`, JSON.stringify({ cancellationId: providerResult.cancellationId, refundAmount: providerResult.refundAmount, refundCurrency: providerResult.refundCurrency }));

    // Real provider penalty/refund + PTR number (PTR id is embedded in the quote/cancellation id).
    const ptrNumber = quoteId.match(/_(\d+)$/)?.[1]
      || String(providerResult.cancellationId || '').match(/_(\d+)$/)?.[1]
      || 'N/A';
    const providerPenaltyApprox = Math.max(0, originalAmount - (providerResult.refundAmount || 0));
    console.log(`[Cancel][PTR]${forcedBy ? ` (forced by ${forcedBy})` : ''} method=${isVoid ? 'VOID' : isCancelAnyway ? 'CANCEL_NO_REFUND' : 'REFUND'} bookingRef=${booking.masterBookingReference} mfRef=${providerPnr?.providerOrderId ?? 'N/A'} ptrNumber=${ptrNumber} providerRefund=${providerResult.refundAmount} ${providerResult.refundCurrency || ''} penaltyApprox=${providerPenaltyApprox} cancellationId=${providerResult.cancellationId}`);

    // Store provider response
    await mbq.storeProviderPayload({
      bookingId,
      provider: booking.primaryProvider,
      payloadType: 'cancellation_confirmed',
      providerReference: providerResult.cancellationId,
      payloadJson: providerResult.raw as object,
    });

    // Update support ticket → CANCEL_CONFIRMED
    await prisma.supportTicket.update({
      where: { id: supportTicket.id },
      data: {
        status: 'CANCEL_CONFIRMED',
        description: prisma.$executeRaw ? undefined : undefined, // keep original
      },
    });

    // Booking event
    await mbq.createBookingEvent({
      bookingId,
      eventType: 'CANCELLATION_CONFIRMED',
      eventTitle: 'Provider confirmed cancellation',
      eventDescription: `Provider ${booking.primaryProvider} confirmed cancellation. ID: ${providerResult.cancellationId}`,
      actorType: 'system',
    });

  } catch (providerErr) {
    // Provider failed — update ticket to SUPPORT_REQUIRED
    const rawMsg = providerErr instanceof Error ? providerErr.message : String(providerErr);
    const isTransient = /\(50[023]\)|internal server error|service unavailable|bad gateway/i.test(rawMsg);

    await prisma.supportTicket.update({
      where: { id: supportTicket.id },
      data: {
        status: 'SUPPORT_REQUIRED',
        priority: 'HIGH',
        description: [
          `CANCELLATION FAILED — Provider returned an error.`,
          '',
          `Error: ${rawMsg}`,
          `Quote ID: ${quoteId}`,
          `Provider Order: ${providerPnr?.providerOrderId ?? 'N/A'}`,
          `Ticket Numbers: ${ticketNumbers.join(', ') || 'N/A'}`,
          `Transient Error: ${isTransient ? 'Yes — retry may succeed' : 'No'}`,
        ].join('\n'),
      },
    });

    // Also update CancellationRecord if one was already created
    await mbq.createBookingEvent({
      bookingId,
      eventType: 'CANCELLATION_FAILED',
      eventTitle: 'Provider cancellation failed',
      eventDescription: rawMsg,
      actorType: 'system',
    });

    const customerMsg = isTransient
      ? 'The airline\'s system is temporarily unavailable. A support ticket has been created and our team will assist you shortly.'
      : `The airline could not process the cancellation. Please contact FareMind Support at support@faremind.ai`;

    throw Object.assign(new Error(customerMsg), {
      code: 'PROVIDER_CANCEL_FAILED',
      supportTicketCreated: true,
      supportTicketId: supportTicket.id,
    });
  }

  // ── Step 4: Calculate financials ───────────────────────────────────
  const isBookingRefundable = !isCancelAnyway && (isRefundable || isVoid || providerResult.refundAmount > 0);
  const adminFee = isBookingRefundable ? await getAdminServiceFee(booking) : 0;
  // For VOID (unticketed), provider may return refundAmount=0 since no ticket was issued
  // In that case, the customer gets originalAmount back (minus admin fee)
  // Manual override (Force Cancel + Refund) takes precedence over the provider-derived
  // amount — used when the auto-quote can't produce a trustworthy USD refund.
  const effectiveRefundAmount = (overrideRefundAmount != null && overrideRefundAmount >= 0)
    ? overrideRefundAmount
    : (providerResult.refundAmount > 0
        ? providerResult.refundAmount
        : (isVoid ? originalAmount : 0));
  if (overrideRefundAmount != null) {
    console.log(`[Cancel][Override]${forcedBy ? ` (forced by ${forcedBy})` : ''} manual refund amount applied: ${overrideRefundAmount} (provider-derived was ${providerResult.refundAmount})`);
  }
  const netRefundAmount = effectiveRefundAmount > 0
    ? Math.max(0, effectiveRefundAmount - adminFee)
    : 0;
  const fareMindFee = isBookingRefundable && netRefundAmount > 0 ? adminFee : 0;
  const airlinePenalty = Math.max(0, originalAmount - providerResult.refundAmount);
  const totalPenalty = Math.max(0, originalAmount - netRefundAmount);
  const cancellationMethod = isVoid ? 'VOID' : isCancelAnyway ? 'CANCEL_NO_REFUND' : 'REFUND';
  const isFullRefund = netRefundAmount >= originalAmount - 1;
  const newPaymentStatus = netRefundAmount <= 0 ? 'NO_REFUND' : isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  const newTicketingStatus = isVoid ? 'VOIDED' : isCancelAnyway ? 'CANCELLED' : 'REFUND_PENDING';

  console.log(`[CANCEL_CONFIRM] Step 4: financials`, JSON.stringify({ bookingId, originalAmount, providerRefundAmount: providerResult.refundAmount, effectiveRefundAmount, adminFee, netRefundAmount, fareMindFee, cancellationMethod, newPaymentStatus, newTicketingStatus }));

  // ── Step 5: Update booking status ──────────────────────────────────
  await prisma.masterBooking.update({
    where: { id: bookingId },
    data: { bookingStatus: 'CANCELLED', paymentStatus: newPaymentStatus as any, ticketingStatus: newTicketingStatus as any },
  });
  await prisma.bookingPnr.updateMany({ where: { bookingId }, data: { status: 'CANCELLED' } });
  await prisma.bookingJourney.updateMany({ where: { bookingId }, data: { journeyStatus: 'cancelled' } });
  await prisma.bookingSegment.updateMany({ where: { bookingId }, data: { segmentStatus: 'cancelled' } });

  // ── Step 6: Create CancellationRecord ──────────────────────────────
  const cancel = await mbq.createCancellationRecord({
    bookingId,
    requestedBy: booking.userId || booking.customerEmail,
    originalAmount,
    penaltyAmount: totalPenalty,
    airlinePenalty,
    refundAmount: netRefundAmount,
    currency: providerResult.refundCurrency,
    refundMethod: resolvedRefundMethod as any,
    providerCancelId: providerResult.cancellationId,
    providerResponse: providerResult.raw as object,
    status: 'CANCEL_CONFIRMED',
  } as any);

  // ── Step 7: Create BookingRefund with reimbursement tracking ───────
  const idempotencyKey = generateIdempotencyKey('customer-refund', bookingId, cancel.id);
  const refundRecord = await prisma.bookingRefund.create({
    data: {
      bookingId,
      cancellationId: cancel.id,
      amount: netRefundAmount,
      currency: providerResult.refundCurrency,
      method: resolvedRefundMethod as any,
      status: netRefundAmount > 0 ? 'INITIATED' : 'COMPLETED',
      processingDays: isVoid ? 5 : 10,
      // Provider reimbursement tracking
      provider: booking.primaryProvider,
      providerPnr: providerPnr?.providerOrderId ?? null,
      providerBookingReference: providerPnr?.providerOrderId ?? null,
      providerRefundRequestId: quoteId,
      providerExpectedReimbursementAmount: providerResult.refundAmount, // pre-FareMind-fee amount
      fareMindCancellationFee: fareMindFee,
      // Status domains
      customerRefundStatus: netRefundAmount > 0 ? 'CUSTOMER_REFUND_PENDING' : 'CUSTOMER_REFUND_NOT_STARTED',
      providerReimbursementStatus: netRefundAmount > 0 ? 'PENDING' : 'NOT_STARTED',
      reconciliationStatus: 'RECONCILIATION_PENDING',
      // Monitoring schedule
      nextProviderStatusCheckAt: netRefundAmount > 0 ? new Date(Date.now() + 6 * 60 * 60 * 1000) : null, // First check in 6h
      // Linkage
      supportTicketId: supportTicket.id,
      idempotencyKey,
    },
  });

  // Link support ticket to refund record
  await prisma.supportTicket.update({
    where: { id: supportTicket.id },
    data: {
      cancellationId: cancel.id,
      bookingRefundId: refundRecord.id,
    },
  });

  // ── Step 8: Process customer refund (Stripe) ───────────────────────
  if (netRefundAmount > 0) {
    // Fire-and-forget: Stripe refund + notifications
    processCustomerRefund(
      refundRecord.id,
      bookingId,
      netRefundAmount,
      providerResult.refundCurrency,
      fareMindFee,
      booking,
      cancel,
      supportTicket.id,
      correlationId,
    ).catch(err => {
      console.error('[CancellationOrchestrator] Background refund error:', err);
    });
  } else {
    // No refund — update statuses and ticket
    await mbq.updateCancellationStatus(cancel.id, 'CANCELLED');
    await prisma.supportTicket.update({
      where: { id: supportTicket.id },
      data: { status: netRefundAmount <= 0 && isCancelAnyway ? 'CLOSED' : 'REFUND_PENDING', closedAt: isCancelAnyway ? new Date() : undefined },
    });
  }

  return {
    success: true,
    cancellationId: cancel.id,
    bookingRefundId: refundRecord.id,
    supportTicketId: supportTicket.id,
    bookingReference: booking.masterBookingReference,
    cancellationMethod,
    refundAmount: netRefundAmount,
    refundCurrency: providerResult.refundCurrency,
    refundTimeline: isVoid ? '3–5 business days' : '5–10 business days',
    refundMethod: resolvedRefundMethod,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 2. Process Customer Refund (Stripe)
// ═══════════════════════════════════════════════════════════════════════

async function processCustomerRefund(
  bookingRefundId: string,
  bookingId: string,
  netRefundAmount: number,
  currency: string,
  fareMindFee: number,
  booking: any,
  cancel: any,
  supportTicketId: string,
  correlationId: string,
): Promise<void> {
  try {
    const payment = await prisma.bookingPayment.findFirst({
      where: { bookingId, status: 'SUCCEEDED' },
      orderBy: { paidAt: 'desc' },
    });

    if (payment?.stripePaymentIntentId) {
      const stripeIdempotencyKey = generateIdempotencyKey('stripe-refund', bookingId, cancel.id);

      try {
        const refundAmountCents = Math.round(netRefundAmount * 100);
        const stripeRefund = await stripe.refunds.create(
          {
            payment_intent: payment.stripePaymentIntentId,
            amount: refundAmountCents,
            reason: 'requested_by_customer',
            metadata: {
              bookingId,
              bookingReference: booking.masterBookingReference,
              cancellationId: cancel.id,
              bookingRefundId,
              netRefundAmount: String(netRefundAmount),
              adminFeeDeducted: String(fareMindFee),
              correlationId,
            },
          },
          { idempotencyKey: stripeIdempotencyKey },
        );

        console.log(`[CancellationOrchestrator] ✅ Stripe refund: ${stripeRefund.id} — $${(stripeRefund.amount / 100).toFixed(2)} ${stripeRefund.currency}`);

        const refundCompleted = stripeRefund.status === 'succeeded';

        // Explicit refund-status log (FareMind-side Stripe refund outcome).
        console.log(`[Cancel][Stripe] status=${refundCompleted ? 'CUSTOMER_REFUNDED' : 'CUSTOMER_REFUND_PENDING'} stripeRefundId=${stripeRefund.id} amount=${(stripeRefund.amount / 100).toFixed(2)} ${String(stripeRefund.currency).toUpperCase()} bookingRef=${booking?.masterBookingReference ?? bookingId} bookingRefundId=${bookingRefundId}`);

        // Update BookingRefund
        await prisma.bookingRefund.update({
          where: { id: bookingRefundId },
          data: {
            status: refundCompleted ? 'CUSTOMER_REFUNDED' : 'PROCESSING',
            customerRefundStatus: refundCompleted ? 'CUSTOMER_REFUNDED' : 'CUSTOMER_REFUND_PENDING',
            stripeRefundId: stripeRefund.id,
            completedAt: refundCompleted ? new Date() : undefined,
          },
        });

        // Update support ticket → REFUND_ISSUED (customer refunded, awaiting provider reimbursement)
        await prisma.supportTicket.update({
          where: { id: supportTicketId },
          data: { status: 'REFUND_ISSUED' },
        });

        // Booking event
        await mbq.createBookingEvent({
          bookingId,
          eventType: 'REFUND_PROCESSED',
          eventTitle: 'Customer refund processed via Stripe',
          eventDescription: `Stripe refund ${stripeRefund.id}: ${fmtCurrency(netRefundAmount, currency)} refunded to original payment method.`,
          actorType: 'system',
        });

        // Mark cancellation as refund pending (awaiting provider reimbursement)
        await mbq.updateCancellationStatus(cancel.id, 'REFUND_PENDING');

      } catch (stripeErr: any) {
        console.error(`[CancellationOrchestrator] ❌ Stripe refund failed for PI ${payment.stripePaymentIntentId}:`, stripeErr.message);

        await prisma.bookingRefund.update({
          where: { id: bookingRefundId },
          data: {
            status: 'CUSTOMER_REFUND_FAILED',
            customerRefundStatus: 'CUSTOMER_REFUND_FAILED',
            failedAt: new Date(),
            failureReason: stripeErr.message,
          },
        });

        // Escalate support ticket
        await prisma.supportTicket.update({
          where: { id: supportTicketId },
          data: {
            status: 'SUPPORT_REQUIRED',
            priority: 'HIGH',
          },
        });

        await mbq.createBookingEvent({
          bookingId,
          eventType: 'REFUND_FAILED',
          eventTitle: 'Stripe refund failed',
          eventDescription: `Error: ${stripeErr.message}. Stripe PI: ${payment.stripePaymentIntentId}`,
          actorType: 'system',
        });
      }
    } else {
      // No Stripe payment found — manual refund required
      await prisma.bookingRefund.update({
        where: { id: bookingRefundId },
        data: {
          status: 'CUSTOMER_REFUND_FAILED',
          customerRefundStatus: 'CUSTOMER_REFUND_FAILED',
          failureReason: 'No Stripe payment intent found for this booking',
        },
      });
      await prisma.supportTicket.update({
        where: { id: supportTicketId },
        data: { status: 'SUPPORT_REQUIRED', priority: 'HIGH' },
      });
    }

    // ── Send customer notification ─────────────────────────────────
    try {
      if (booking.customerEmail) {
        await fireNotification({
          event_type: 'BOOKING_CANCELLED' as any,
          customer_email: booking.customerEmail,
          data: {
            customer_name: booking.customerName?.split(' ')[0] || 'Traveler',
            booking_reference: booking.masterBookingReference,
            route: `${booking.originAirport} → ${booking.destinationAirport}`,
            departure_date: booking.departureDate ? new Date(booking.departureDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A',
            refund_amount: fmtCurrency(netRefundAmount, currency),
            refund_timeline: '5–10 business days',
          },
        }).catch(() => {});
      }
    } catch (notifErr) {
      console.error('[CancellationOrchestrator] Notification error:', notifErr);
    }

  } catch (err) {
    console.error('[CancellationOrchestrator] processCustomerRefund unexpected error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 3. Check Provider Reimbursement (called by cron)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check one BookingRefund's provider reimbursement status.
 * Called by the reconciliation cron for each due record.
 */
export async function checkProviderReimbursement(bookingRefundId: string): Promise<void> {
  const refund = await prisma.bookingRefund.findUnique({
    where: { id: bookingRefundId },
  });
  if (!refund || !refund.provider) return;

  // Don't process already-settled or fully reconciled records
  if (['REIMBURSED', 'FAILED'].includes(refund.providerReimbursementStatus)) return;

  const attemptNumber = refund.providerStatusCheckCount + 1;
  const statusBefore = refund.providerReimbursementStatus;
  const requestedAt = new Date();

  try {
    const provider = getProvider(refund.provider);

    // Call provider-specific status check
    const providerStatus = await provider.getProviderRefundStatus(
      refund.providerRefundRequestId || '',
      refund.providerPnr || '',
    );

    const respondedAt = new Date();

    // Map provider status to internal status
    let newReimbursementStatus = refund.providerReimbursementStatus;
    const daysSinceCreated = (Date.now() - refund.createdAt.getTime()) / (1000 * 60 * 60 * 24);

    switch (providerStatus.status) {
      case 'SETTLED':
        newReimbursementStatus = 'REIMBURSED';
        break;
      case 'PROCESSING':
        newReimbursementStatus = 'PROCESSING';
        break;
      case 'REJECTED':
      case 'FAILED':
        newReimbursementStatus = 'FAILED';
        break;
      case 'PENDING':
      case 'UNKNOWN':
        if (daysSinceCreated > 14) {
          newReimbursementStatus = 'OVERDUE';
        } else {
          newReimbursementStatus = 'PENDING';
        }
        break;
    }

    const nextCheck = newReimbursementStatus === 'REIMBURSED' || newReimbursementStatus === 'FAILED'
      ? null
      : calculateNextCheckAt(attemptNumber, refund.createdAt);

    // Audit: Record the check
    await prisma.providerReimbursementCheck.create({
      data: {
        bookingRefundId,
        provider: refund.provider,
        providerRefundRequestId: refund.providerRefundRequestId,
        statusBefore,
        providerRawStatus: providerStatus.rawStatus || providerStatus.status,
        normalizedStatus: newReimbursementStatus,
        attemptNumber,
        requestedAt,
        respondedAt,
        success: true,
        providerResponseReference: providerStatus.providerRefundId || null,
        settlementAmount: providerStatus.reimbursedAmount ?? null,
        nextCheckAt: nextCheck,
      },
    });

    // Update BookingRefund
    const updateData: any = {
      providerReimbursementStatus: newReimbursementStatus,
      lastProviderStatusCheckAt: respondedAt,
      nextProviderStatusCheckAt: nextCheck,
      providerStatusCheckCount: attemptNumber,
    };

    if (providerStatus.status === 'SETTLED') {
      updateData.providerRefundId = providerStatus.providerRefundId ?? null;
      updateData.providerSettlementReference = providerStatus.settlementReference ?? null;
      updateData.providerReimbursedAt = providerStatus.settledAt ? new Date(providerStatus.settledAt) : new Date();
      updateData.actualProviderReimbursementAmount = providerStatus.reimbursedAmount ?? null;
    }

    await prisma.bookingRefund.update({
      where: { id: bookingRefundId },
      data: updateData,
    });

    // ── Handle state transitions ─────────────────────────────────
    if (providerStatus.status === 'SETTLED') {
      // Provider reimbursed → run reconciliation
      await onProviderReimbursed(bookingRefundId);
    } else if (newReimbursementStatus === 'OVERDUE') {
      await onProviderReimbursementOverdue(bookingRefundId, attemptNumber, daysSinceCreated);
    } else if (newReimbursementStatus === 'FAILED') {
      await onProviderReimbursementFailed(bookingRefundId);
    }

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[CancellationOrchestrator] Provider status check failed for refund ${bookingRefundId}:`, errorMsg);

    // Record the failed check — do NOT treat timeout as rejection
    const nextCheck = calculateNextCheckAt(attemptNumber, refund.createdAt);

    await prisma.providerReimbursementCheck.create({
      data: {
        bookingRefundId,
        provider: refund.provider,
        providerRefundRequestId: refund.providerRefundRequestId,
        statusBefore,
        normalizedStatus: statusBefore, // Keep current status on polling failure
        attemptNumber,
        requestedAt,
        respondedAt: new Date(),
        success: false,
        errorMessage: errorMsg,
        nextCheckAt: nextCheck,
      },
    });

    await prisma.bookingRefund.update({
      where: { id: bookingRefundId },
      data: {
        lastProviderStatusCheckAt: new Date(),
        nextProviderStatusCheckAt: nextCheck,
        providerStatusCheckCount: attemptNumber,
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 4. Reconciliation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Run financial reconciliation after provider reimburses FareMind.
 *
 * Expected identity:
 *   Provider Reimbursement = Customer Refund + FareMind Fee
 */
export async function reconcileRefund(bookingRefundId: string): Promise<ReconciliationResult> {
  const refund = await prisma.bookingRefund.findUnique({
    where: { id: bookingRefundId },
  });
  if (!refund) throw new Error(`BookingRefund ${bookingRefundId} not found`);

  const customerRefundAmount = Number(refund.amount);
  const fareMindFee = Number(refund.fareMindCancellationFee || 0);
  const expectedReimbursement = Number(refund.providerExpectedReimbursementAmount || 0);
  const actualReimbursement = Number(refund.actualProviderReimbursementAmount || 0);
  const currency = refund.currency;

  // Expected: Provider reimbursement ≈ Customer refund + FareMind fee
  const expectedTotal = customerRefundAmount + fareMindFee;
  const difference = Math.abs(actualReimbursement - expectedTotal);

  // Tolerance: $0.01 for same-currency
  const tolerance = 0.01;
  let status: ReconciliationResult['status'];

  if (actualReimbursement === 0 && expectedReimbursement === 0) {
    status = 'MATCHED'; // No-refund cancellation
  } else if (difference <= tolerance) {
    status = 'MATCHED';
  } else if (difference > tolerance && difference <= 1.0) {
    status = 'MATCHED'; // Minor rounding — still OK
  } else {
    status = 'MISMATCH';
  }

  const reconciliationStatus = status === 'MATCHED' ? 'MATCHED' : 'MISMATCH';

  await prisma.bookingRefund.update({
    where: { id: bookingRefundId },
    data: {
      reconciliationStatus,
      reconciledAt: new Date(),
    },
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      action: 'REFUND_RECONCILIATION',
      entityType: 'BookingRefund',
      entityId: bookingRefundId,
      bookingId: refund.bookingId,
      metadata: {
        customerRefundAmount,
        fareMindFee,
        expectedReimbursement: expectedTotal,
        actualReimbursement,
        difference,
        status,
        tolerance,
        currency,
      },
    },
  });

  return { status, expectedAmount: expectedTotal, actualAmount: actualReimbursement, difference, currency };
}

// ═══════════════════════════════════════════════════════════════════════
// 5. Lifecycle Event Handlers
// ═══════════════════════════════════════════════════════════════════════

/** Called when provider confirms reimbursement to FareMind */
async function onProviderReimbursed(bookingRefundId: string): Promise<void> {
  const refund = await prisma.bookingRefund.findUnique({ where: { id: bookingRefundId } });
  if (!refund) return;

  // Update support ticket
  if (refund.supportTicketId) {
    await prisma.supportTicket.update({
      where: { id: refund.supportTicketId },
      data: { status: 'REFUND_REIMBURSED' },
    });
  }

  // Booking event
  await mbq.createBookingEvent({
    bookingId: refund.bookingId,
    eventType: 'PROVIDER_REIMBURSED',
    eventTitle: 'Provider reimbursement confirmed',
    eventDescription: `Provider settled ${fmtCurrency(Number(refund.actualProviderReimbursementAmount || 0), refund.currency)}.`,
    actorType: 'system',
  });

  // Run reconciliation
  const result = await reconcileRefund(bookingRefundId);

  if (result.status === 'MATCHED') {
    // All good — close the support ticket
    if (refund.supportTicketId) {
      await prisma.supportTicket.update({
        where: { id: refund.supportTicketId },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    }

    // Update cancellation status
    if (refund.cancellationId) {
      await mbq.updateCancellationStatus(refund.cancellationId, 'REFUNDED');
    }

    await mbq.createBookingEvent({
      bookingId: refund.bookingId,
      eventType: 'CANCELLATION_JOURNEY_COMPLETED',
      eventTitle: 'Cancellation journey completed',
      eventDescription: 'Provider reimbursement received and reconciled. Support ticket closed.',
      actorType: 'system',
    });
  } else {
    // Mismatch — escalate
    if (refund.supportTicketId) {
      await prisma.supportTicket.update({
        where: { id: refund.supportTicketId },
        data: {
          status: 'ESCALATED',
          priority: 'HIGH',
          queue: 'REFUND_RECONCILIATION_QUEUE',
          escalatedAt: new Date(),
        },
      });
    }

    await mbq.createBookingEvent({
      bookingId: refund.bookingId,
      eventType: 'RECONCILIATION_MISMATCH',
      eventTitle: 'Reconciliation mismatch',
      eventDescription: `Expected ${fmtCurrency(result.expectedAmount, result.currency)}, received ${fmtCurrency(result.actualAmount, result.currency)}. Difference: ${fmtCurrency(result.difference, result.currency)}.`,
      actorType: 'system',
    });
  }
}

/** Called when provider reimbursement is overdue (>14 days) */
async function onProviderReimbursementOverdue(
  bookingRefundId: string,
  attemptCount: number,
  daysOutstanding: number,
): Promise<void> {
  const refund = await prisma.bookingRefund.findUnique({ where: { id: bookingRefundId } });
  if (!refund) return;

  // Escalate the existing support ticket — do NOT create a new one
  if (refund.supportTicketId) {
    await prisma.supportTicket.update({
      where: { id: refund.supportTicketId },
      data: {
        status: 'ESCALATED',
        priority: 'HIGH',
        queue: 'REFUND_RECONCILIATION_QUEUE',
        escalatedAt: new Date(),
      },
    });
  }

  await mbq.createBookingEvent({
    bookingId: refund.bookingId,
    eventType: 'PROVIDER_REIMBURSEMENT_OVERDUE',
    eventTitle: 'Provider reimbursement overdue',
    eventDescription: `${Math.round(daysOutstanding)} days since refund request. ${attemptCount} status checks performed. Expected: ${fmtCurrency(Number(refund.providerExpectedReimbursementAmount || 0), refund.currency)}.`,
    actorType: 'system',
  });
}

/** Called when provider reimbursement is rejected or failed */
async function onProviderReimbursementFailed(bookingRefundId: string): Promise<void> {
  const refund = await prisma.bookingRefund.findUnique({ where: { id: bookingRefundId } });
  if (!refund) return;

  if (refund.supportTicketId) {
    await prisma.supportTicket.update({
      where: { id: refund.supportTicketId },
      data: {
        status: 'ESCALATED',
        priority: 'HIGH',
        queue: 'REFUND_RECONCILIATION_QUEUE',
        escalatedAt: new Date(),
      },
    });
  }

  await mbq.createBookingEvent({
    bookingId: refund.bookingId,
    eventType: 'PROVIDER_REIMBURSEMENT_FAILED',
    eventTitle: 'Provider reimbursement failed',
    eventDescription: `Provider rejected or failed to reimburse. Expected: ${fmtCurrency(Number(refund.providerExpectedReimbursementAmount || 0), refund.currency)}.`,
    actorType: 'system',
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Admin Service Fee Helper (moved from manage-booking.ts)
// ═══════════════════════════════════════════════════════════════════════

async function getAdminServiceFee(booking: any): Promise<number> {
  try {
    // Use the booking's stored platform fee as the cancellation service fee.
    // This is the fee FareMind charged on booking, retained on cancellation.
    const platformFee = Number(booking.platformFee || 0);
    if (platformFee > 0) return platformFee;

    // Fallback: look for a SERVICE_FEE rule with per-traveler model
    const feeRule = await prisma.platformFeeRule.findFirst({
      where: {
        active: true,
        feeType: 'SERVICE_FEE',
      },
      orderBy: { priority: 'asc' },
    });
    if (feeRule) {
      const fixedAmount = Number(feeRule.fixedAmount || 0);
      if (feeRule.calculationModel === 'FIXED_PER_TRAVELER' && booking.passengers?.length) {
        return fixedAmount * booking.passengers.length;
      }
      return fixedAmount;
    }
    return 0;
  } catch {
    return 0;
  }
}
