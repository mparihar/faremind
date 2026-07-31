/**
 * Mystifly Post-Ticketing Request (PTR) Routes
 *
 * NEW route plugin — does NOT modify any existing routes.
 *
 * Endpoints:
 *   POST /api/mystifly-ptr/void-quote     — Get void quote
 *   POST /api/mystifly-ptr/void           — Execute void
 *   POST /api/mystifly-ptr/refund-quote   — Get refund quote
 *   POST /api/mystifly-ptr/refund         — Execute refund
 *   POST /api/mystifly-ptr/reissue-quote  — Get reissue quote
 *   POST /api/mystifly-ptr/reissue        — Execute reissue
 *   POST /api/mystifly-ptr/status         — Check PTR status
 *   POST /api/mystifly-ptr/mark-read      — Mark PTR as read
 */

import { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import * as mystifly from '../services/mystifly';
import type { PtrType } from '../services/mystifly';
import { prisma } from '../lib/db';
import { buildPtrPassengers, type PtrPassenger } from '../lib/ptr-passengers';
import { backfillEticketsFromTripDetails } from '../lib/eticket-backfill';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { typescript: true });

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

/**
 * Load the PTR passengers array for a Mystifly booking. Mystifly requires it on
 * every PTR request. Resolves the booking by Mystifly UniqueID (MFRef) or the
 * provided FareMind booking id/reference, then maps passengers + e-tickets.
 */
async function loadPtrPassengers(uniqueId: string, bookingId?: string): Promise<PtrPassenger[]> {
  try {
    const booking = await prisma.masterBooking.findFirst({
      where: {
        OR: [
          { mystiflyMfRef: uniqueId },
          { providerOrderId: uniqueId },
          { masterPnr: uniqueId },
          { pnrs: { some: { providerOrderId: uniqueId } } },
          ...(bookingId ? [{ id: bookingId }, { masterBookingReference: bookingId }] : []),
        ],
      },
      include: {
        passengers: { orderBy: { passengerOrder: 'asc' } },
        // Ordered so ticket selection is deterministic across calls.
        tickets: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!booking) return [];

    // Bookings can reach a PTR with no e-ticket persisted yet (ticketing resolved
    // asynchronously). Mystifly rejects any PTR whose passengers lack an e-ticket, so
    // pull the numbers from TripDetails first — same guard the cancellation path uses.
    const mfRef = booking.mystiflyMfRef || booking.providerOrderId || booking.masterPnr;
    const hasEticket = booking.tickets.some((t: any) => t.eTicketNumber || t.ticketNumber);
    if (!hasEticket && mfRef) {
      try {
        const r = await backfillEticketsFromTripDetails(booking.id, mfRef);
        if (r.updated > 0) {
          const reloaded = await prisma.masterBooking.findUnique({
            where: { id: booking.id },
            include: {
              passengers: { orderBy: { passengerOrder: 'asc' } },
              tickets: { orderBy: { createdAt: 'asc' } },
            },
          });
          if (reloaded) return buildPtrPassengers(reloaded);
        }
      } catch (e) {
        console.warn(`[PTR] eTicket backfill failed for ${mfRef}:`, (e as Error).message);
      }
    }

    return buildPtrPassengers(booking);
  } catch {
    return [];
  }
}

/**
 * Build the `originDestinations` array required by a Mystifly ReIssueQuote.
 *
 * Mystifly's PostTicketingRequest contract has NO fare-source-code reissue —
 * `reissueQuoteRequestType` is only None|OND|Segment — so a reissue is always
 * expressed as origin/destination/date. Callers that want a genuine flight
 * change pass their own array; when they don't, we re-quote the itinerary the
 * booking already has (one OND per journey: first segment's origin → last
 * segment's destination). Omitting the array makes Mystifly 500.
 */
async function loadPtrOriginDestinations(
  uniqueId: string,
  bookingId?: string,
): Promise<mystifly.MystiflyReissueOriginDestination[]> {
  try {
    const booking = await prisma.masterBooking.findFirst({
      where: {
        OR: [
          { mystiflyMfRef: uniqueId },
          { providerOrderId: uniqueId },
          { masterPnr: uniqueId },
          { pnrs: { some: { providerOrderId: uniqueId } } },
          ...(bookingId ? [{ id: bookingId }, { masterBookingReference: bookingId }] : []),
        ],
      },
      include: {
        journeys: {
          orderBy: { journeyOrder: 'asc' },
          include: { segments: { orderBy: { segmentOrder: 'asc' }, take: 1 } },
        },
      },
    });
    if (!booking) return [];

    // Journey-level origin/destination/departure are non-nullable, so they are the
    // reliable source; the first segment is read only for its cabin.
    return booking.journeys.map((j: any) => ({
      originLocationCode: j.originAirport,
      destinationLocationCode: j.destinationAirport,
      // Date at midnight, per Mystifly's ReissueQuoteRQ contract — a wall-clock time
      // would narrow the search instead of returning the whole day's options.
      departureDateTime: `${new Date(j.departureDateTime).toISOString().slice(0, 10)}T00:00:00`,
      cabinPreference: mystifly.toCabinType(j.segments[0]?.cabin || j.cabinSummary || 'economy'),
    }));
  } catch {
    return [];
  }
}

/** Resolve the MasterBooking (id + status) for a PTR by MFRef or FareMind id/ref. */
async function resolvePtrBooking(uniqueId: string, bookingId?: string) {
  return prisma.masterBooking.findFirst({
    where: {
      OR: [
        { mystiflyMfRef: uniqueId },
        { providerOrderId: uniqueId },
        { masterPnr: uniqueId },
        { pnrs: { some: { providerOrderId: uniqueId } } },
        ...(bookingId ? [{ id: bookingId }, { masterBookingReference: bookingId }] : []),
      ],
    },
    select: { id: true, masterBookingReference: true, agentUserId: true, ticketingStatus: true, bookingStatus: true },
  });
}

function extractPtrError(result: any): { hasError: boolean; message: string; code: string } {
  // 1. Structured Mystifly error object (Data.Error / Error with ErrorCode).
  const err = result?.Data?.Error || result?.Error;
  if (err?.ErrorCode && err.ErrorCode !== '0') {
    return { hasError: true, message: err.ErrorMessage || 'PTR request failed', code: err.ErrorCode };
  }
  // 2. Array-style errors (Data.Errors[] / Errors[]).
  const errArr = result?.Data?.Errors || result?.Errors;
  if (Array.isArray(errArr) && errArr.length > 0) {
    const e0 = errArr[0] || {};
    return { hasError: true, message: e0.Message || e0.ErrorMessage || 'PTR request failed', code: e0.Code || e0.ErrorCode || 'UNKNOWN' };
  }
  // 3. Envelope-level failure: Success === false with a Message. This is how a
  //    provider 500 (e.g. "The remote server returned an error: (500) …") arrives
  //    when Mystifly wraps it in an HTTP 200 body — must NOT be treated as a quote.
  if (result && result.Success === false) {
    const msg: string = result.Message || 'The airline system returned an error for this request.';
    const isTransient = /\(5\d\d\)|internal server error|timeout|temporarily/i.test(msg);
    return {
      hasError: true,
      message: isTransient
        ? `The airline system is temporarily unavailable (${msg}). Please retry in a moment; if it persists, use Force Cancel + Refund or contact support.`
        : msg,
      code: isTransient ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR',
    };
  }
  return { hasError: false, message: '', code: '' };
}

/** Resolve a MasterBooking id from either its cuid `id` or its `masterBookingReference`. */
async function resolveMasterBookingId(input?: string): Promise<string | null> {
  if (!input) return null;
  const b = await prisma.masterBooking.findFirst({
    where: { OR: [{ id: input }, { masterBookingReference: input }] },
    select: { id: true },
  });
  return b?.id ?? null;
}

async function createPtrRecord(params: {
  bookingId: string;
  providerUniqueId: string;
  requestType: string;
  requestedBy: string;
  requestedByRole?: string;
  notes?: string;
}) {
  // The caller may pass a booking reference (e.g. FM5GQXHT) OR the MasterBooking id.
  // postTicketingRequest.bookingId is an FK to MasterBooking.id, so resolve first —
  // otherwise a reference triggers a foreign-key constraint violation. If it can't be
  // resolved, skip DB linkage (bookingId is optional tracking) rather than crash.
  const resolvedId = await resolveMasterBookingId(params.bookingId);
  if (!resolvedId) {
    console.warn(`[PTR] createPtrRecord: no MasterBooking found for "${params.bookingId}" — skipping PTR tracking record.`);
    return null;
  }
  return prisma.postTicketingRequest.create({
    data: {
      bookingId: resolvedId,
      provider: 'MYSTIFLY',
      providerUniqueId: params.providerUniqueId,
      requestType: params.requestType as any,
      status: 'QUOTE_PENDING',
      requestedBy: params.requestedBy,
      requestedByRole: params.requestedByRole || 'AGENT',
      notes: params.notes || null,
    },
  });
}

async function updatePtrRecord(id: string, data: Record<string, any>) {
  return prisma.postTicketingRequest.update({
    where: { id },
    data,
  });
}

/**
 * Hand an accepted-but-unfulfilled reissue to the settlement cron.
 *
 * Accepting a ReIssueQuote returns PTRStatus=InProcess with a 60-minute SLA — the
 * airline has NOT reissued yet. `reissue-reconciliation-cron` polls ChangeRequest rows
 * in PROVIDER_PROCESSING and `services/reissue-settlement.ts` advances them only once
 * the provider reports Resolution=Reissued (or refunds + escalates on rejection).
 * Without this row nothing ever verifies fulfilment, so the booking would claim a
 * reissue that may still fail at the airline an hour later.
 */
async function enqueueReissueSettlement(params: {
  uniqueId: string;
  bookingId?: string;
  providerPtrId: number;
  requestedBy?: string;
  providerResponse?: unknown;
  collectedChargeId?: string | null;
  collectedAmount?: number | null;
}): Promise<string | null> {
  // Resolve by MFRef as well as FareMind id/reference — the PTR console often has only
  // the MFRef, and an unresolved booking means fulfilment is never verified.
  const booking = await resolvePtrBooking(params.uniqueId, params.bookingId);
  if (!booking) {
    console.warn(`[PTR] enqueueReissueSettlement: no MasterBooking for "${params.bookingId || params.uniqueId}" — reissue will NOT be polled.`);
    return null;
  }
  try {
    const cr = await prisma.changeRequest.create({
      data: {
        bookingId: booking.id,
        type: 'DATE_CHANGE',
        status: 'PROVIDER_PROCESSING',
        requestedBy: params.requestedBy || 'agent',
        providerPtrId: String(params.providerPtrId),
        providerMfRef: params.uniqueId,
        providerResponse: (params.providerResponse ?? undefined) as any,
        collectedChargeId: params.collectedChargeId ?? null,
        collectedAmount: params.collectedAmount ?? null,
        // First poll ~30 min after accept; reissue-settlement widens the back-off.
        nextCheckAt: new Date(Date.now() + 30 * 60 * 1000),
      } as any,
    });
    return cr.id;
  } catch (e) {
    console.error('[PTR] enqueueReissueSettlement failed:', (e as Error).message);
    return null;
  }
}

// ═══════════════════════════════════════════════
// Route Plugin
// ═══════════════════════════════════════════════

const ptrPlugin: FastifyPluginAsync = async (fastify) => {

  // ── Void Quote ─────────────────────────────────

  fastify.post('/void-quote', async (request, reply) => {
    try {
      const { uniqueId, bookingId, requestedBy, notes } = request.body as {
        uniqueId: string; bookingId?: string; requestedBy?: string; notes?: string;
      };
      if (!uniqueId) return reply.code(400).send({ error: 'uniqueId is required' });

      // Create DB record
      let ptrRecord = null;
      if (bookingId) {
        ptrRecord = await createPtrRecord({
          bookingId,
          providerUniqueId: uniqueId,
          requestType: 'VOID_QUOTE',
          requestedBy: requestedBy || 'system',
          notes,
        });
      }

      const passengers = await loadPtrPassengers(uniqueId, bookingId);
      const result = await mystifly.voidQuote(uniqueId, passengers);
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        if (ptrRecord) await updatePtrRecord(ptrRecord.id, { status: 'FAILED', failureReason: message, failedAt: new Date() });
        const notEligible = /verify the request|not eligible|not allowed|not permitted|window|invalid/i.test(message);
        const friendly = notEligible
          ? `Void was rejected by the airline (${message}). Void is only possible within the airline's void window and while the ticket is in a voidable state. If this is a fresh booking, ticketing may still be settling — retry in a moment; otherwise use "Get Refund Quote" or "Force Cancel + Refund".`
          : message;
        return reply.code(422).send({ error: friendly, errorCode: 'MYSTIFLY_VOID_QUOTE_FAILED', raw: result });
      }

      // Void quote returns synchronously: Data.VoidQuotes[] with TotalRefundAmount / TotalVoidingFee.
      const quoteData = result?.Data || result;
      const vq = Array.isArray(quoteData?.VoidQuotes) ? quoteData.VoidQuotes : [];
      const providerPtrId = quoteData?.PTRId ?? quoteData?.PtrId ?? null;
      const totalRefund = vq.reduce((s: number, q: any) => s + (parseFloat(q?.TotalRefundAmount) || 0), 0);
      const totalVoidingFee = vq.reduce((s: number, q: any) => s + (parseFloat(q?.TotalVoidingFee) || 0), 0);
      const currency = vq[0]?.Currency || quoteData?.Currency || 'USD';
      if (ptrRecord) {
        await updatePtrRecord(ptrRecord.id, {
          status: 'QUOTE_RECEIVED',
          quoteTotalAmount: totalRefund || null,
          quotePenaltyAmount: totalVoidingFee || null,
          quoteRefundAmount: totalRefund || null,
          quoteCurrency: currency,
          providerQuoteResponse: result,
        });
      }

      return {
        success: true, ptrId: ptrRecord?.id, providerPtrId,
        ptrStatus: quoteData?.PTRStatus, voidingWindow: quoteData?.VoidingWindow,
        quote: { TotalRefundAmount: totalRefund, TotalVoidingFee: totalVoidingFee, Currency: currency, VoidQuotes: vq },
        raw: result,
      };
    } catch (error: any) {
      console.error('[PTR] VoidQuote error:', error.message);
      return reply.code(502).send({ error: `VoidQuote failed: ${error.message}` });
    }
  });

  // ── Void Execute ───────────────────────────────

  fastify.post('/void', async (request, reply) => {
    try {
      const { uniqueId, ptrId, bookingId, requestedBy } = request.body as {
        uniqueId: string; ptrId?: string; bookingId?: string; requestedBy?: string;
      };
      if (!uniqueId) return reply.code(400).send({ error: 'uniqueId is required' });

      // Reported back to the agent so a void that did NOT refund the customer is never
      // presented as a plain success.
      let customerRefund: Record<string, unknown> = { issued: false, reason: 'not attempted' };

      if (ptrId) await updatePtrRecord(ptrId, { status: 'EXECUTING', approvedBy: requestedBy, approvedAt: new Date() });

      // Direct Void — submit with the passengers array. Returns PTRStatus=InProcess;
      // fulfilment (Resolution=Voided) settles async and is polled via searchPtr.
      const passengers = await loadPtrPassengers(uniqueId, bookingId);
      const result = await mystifly.executeVoid(uniqueId, passengers);
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        if (ptrId) await updatePtrRecord(ptrId, { status: 'FAILED', failureReason: message, failedAt: new Date(), providerExecResponse: result });
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_VOID_FAILED', raw: result });
      }

      const data = result?.Data || result;
      const providerPtrId = data?.PTRId ?? data?.PtrId ?? null;
      const ptrStatus = data?.PTRStatus || 'InProcess';
      // COMPLETED only if the provider already reports it; otherwise EXECUTING (async).
      if (ptrId) await updatePtrRecord(ptrId, { status: /completed/i.test(ptrStatus) ? 'COMPLETED' : 'EXECUTING', executedAt: new Date(), providerExecResponse: result });

      // Reflect the void on the booking + timeline (provider void submitted OK).
      // The void is the refund mechanism within the void window (full amount
      // returned), so mark the ticket VOIDED and the booking CANCELLED, and
      // release the agent wallet hold. Best-effort — never fail the void response.
      try {
        const bk = await resolvePtrBooking(uniqueId, bookingId);
        if (bk) {
          await prisma.masterBooking.update({
            where: { id: bk.id },
            data: { bookingStatus: 'CANCELLED', ticketingStatus: 'VOIDED', providerBookingStatus: ptrStatus },
          });
          await prisma.bookingTicket.updateMany({ where: { bookingId: bk.id }, data: { ticketStatus: 'VOIDED' } }).catch(() => {});
          await prisma.bookingEvent.create({
            data: {
              bookingId: bk.id,
              eventType: 'BOOKING_VOIDED',
              eventTitle: 'Ticket Voided',
              eventDescription: `Ticket voided via provider${providerPtrId ? ` (PTR ${providerPtrId})` : ''}. Provider status: ${ptrStatus}. The void returns the full amount within the void window. Requested by ${requestedBy || 'staff'}.`,
              actorType: 'agent',
              actorName: requestedBy || 'staff',
              payloadJson: { providerPtrId, ptrStatus, uniqueId },
            },
          });
          // Refund the booker to their original card — a void within the window
          // returns the FULL amount the customer paid. Idempotent via the Stripe
          // idempotency key + a paymentStatus guard. Best-effort.
          try {
            const cur = await prisma.masterBooking.findUnique({ where: { id: bk.id }, select: { paymentStatus: true } });
            if (cur?.paymentStatus !== 'REFUNDED') {
              const payment = await prisma.bookingPayment.findFirst({ where: { bookingId: bk.id, status: 'SUCCEEDED' }, orderBy: { paidAt: 'desc' } });
              if (payment?.stripePaymentIntentId) {
                const paid = Number(payment.amount);
                const stripeRefund = await stripe.refunds.create(
                  { payment_intent: payment.stripePaymentIntentId, amount: Math.round(paid * 100), reason: 'requested_by_customer', metadata: { booking_ref: bk.masterBookingReference, action: 'ptr_void' } },
                  { idempotencyKey: `ptrvoid-refund-${bk.id}` },
                );
                await prisma.masterBooking.update({ where: { id: bk.id }, data: { paymentStatus: 'REFUNDED' } });
                await prisma.bookingRefund.create({
                  data: { bookingId: bk.id, amount: paid, currency: payment.currency || 'USD', method: 'ORIGINAL_PAYMENT', status: 'COMPLETED', provider: 'MYSTIFLY' },
                }).catch((be: any) => console.error('[PTR] bookingRefund record failed:', be?.message));
                await prisma.bookingEvent.create({
                  data: {
                    bookingId: bk.id, eventType: 'CUSTOMER_REFUNDED', eventTitle: 'Refund Issued',
                    eventDescription: `Full refund of ${paid.toFixed(2)} ${payment.currency || 'USD'} issued to the original card on void. Stripe refund ${stripeRefund.id}.`,
                    actorType: 'system', actorName: 'PTR Void', payloadJson: { stripeRefundId: stripeRefund.id, amount: paid },
                  },
                }).catch(() => {});
                customerRefund = { issued: true, amount: paid, currency: payment.currency || 'USD', stripeRefundId: stripeRefund.id };
              } else {
                customerRefund = { issued: false, reason: 'No captured payment with a Stripe PaymentIntent was found for this booking.' };
              }
            } else {
              customerRefund = { issued: false, reason: 'Booking is already marked REFUNDED.', alreadyRefunded: true };
            }
          } catch (re: any) {
            // A swallowed refund failure means the ticket is void and the customer is
            // still charged, with nothing surfacing it. Escalate exactly as
            // cancellation-orchestrator.processCustomerRefund does.
            customerRefund = { issued: false, failed: true, reason: re?.message || 'Stripe refund failed' };
            console.error(`[PTR] CRITICAL: void customer refund FAILED for ${bk.masterBookingReference}:`, re?.message);
            await prisma.bookingEvent.create({
              data: {
                bookingId: bk.id, eventType: 'REFUND_FAILED', eventTitle: 'Refund Failed',
                eventDescription: `Ticket was voided but the customer refund did NOT go through: ${re?.message || 'unknown error'}. The customer is still charged — a manual refund is required.`,
                actorType: 'system', actorName: 'PTR Void',
              },
            }).catch(() => {});
            await prisma.supportTicket.create({
              data: {
                subject: `Void refund FAILED: ${bk.masterBookingReference} — customer still charged`,
                description: [
                  `The ticket for ${bk.masterBookingReference} was voided at the provider, but the customer refund failed.`,
                  '',
                  `Error: ${re?.message || 'unknown'}`,
                  `Provider PTR: ${providerPtrId ?? 'n/a'} (${uniqueId})`,
                  'A manual refund to the original card is required.',
                ].join('\n'),
                priority: 'HIGH', status: 'OPEN', category: 'Refund', channel: 'SYSTEM',
                bookingRef: bk.masterBookingReference,
                ticketType: 'REFUND', queue: 'CANCELLATION_SUPPORT',
                providerPnr: uniqueId, providerBookingRef: uniqueId,
              } as any,
            }).catch(() => {});
          }

          // Release the agent wallet hold for agent-owned bookings.
          if (bk.agentUserId) {
            try {
              const walletSvc = await import('../services/agent-wallet');
              const amt = await prisma.masterBooking.findUnique({ where: { id: bk.id }, select: { totalAmount: true } });
              if (amt?.totalAmount) await walletSvc.releaseUtilization(bk.agentUserId, Number(amt.totalAmount), 'CANCELLATION', requestedBy || 'PTR_VOID', bk.id);
            } catch (we: any) { console.error('[PTR] void wallet release failed:', we?.message); }
          }
        }
      } catch (e: any) {
        console.error('[PTR] void booking-status update failed:', e?.message);
      }

      return {
        success: true,
        ptrId, providerPtrId, ptrStatus,
        customerRefund,
        // The void succeeded at the provider but the customer may still be charged —
        // the agent must see that rather than a bare success.
        warning: customerRefund.failed
          ? 'Ticket voided, but the customer refund FAILED. A support ticket has been raised; a manual refund is required.'
          : (!customerRefund.issued && !customerRefund.alreadyRefunded)
            ? `Ticket voided, but no customer refund was issued (${customerRefund.reason}). Verify the payment record.`
            : undefined,
        raw: result,
      };
    } catch (error: any) {
      console.error('[PTR] Void error:', error.message);
      return reply.code(502).send({ error: `Void failed: ${error.message}` });
    }
  });

  // ── Refund Quote ───────────────────────────────

  fastify.post('/refund-quote', async (request, reply) => {
    try {
      const { uniqueId, bookingId, requestedBy, notes } = request.body as {
        uniqueId: string; bookingId?: string; requestedBy?: string; notes?: string;
      };
      if (!uniqueId) return reply.code(400).send({ error: 'uniqueId is required' });

      let ptrRecord = null;
      if (bookingId) {
        ptrRecord = await createPtrRecord({
          bookingId,
          providerUniqueId: uniqueId,
          requestType: 'REFUND_QUOTE',
          requestedBy: requestedBy || 'system',
          notes,
        });
      }

      const passengers = await loadPtrPassengers(uniqueId, bookingId);
      const result = await mystifly.refundQuote(uniqueId, passengers);
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        if (ptrRecord) await updatePtrRecord(ptrRecord.id, { status: 'FAILED', failureReason: message, failedAt: new Date() });
        // The airline refused a refund PTR (non-refundable, still in void window, or
        // already processed). Point staff at the right alternative instead of a dead end.
        const notEligible = /not eligible|non.?refundable|no refund|not allowed|not permitted|verify the request/i.test(message);
        const friendly = notEligible
          ? `This ticket cannot be refunded through the airline's refund process (${message}). If it is still within the void window use "Get Void Quote"; otherwise use "Force Cancel + Refund" to cancel and issue a manual refund.`
          : message;
        return reply.code(422).send({ error: friendly, errorCode: 'MYSTIFLY_REFUND_QUOTE_FAILED', raw: result });
      }

      // Refund quote returns synchronously: Data.RefundQuotes[] (TotalRefundAmount /
      // TotalRefundCharges / CancellationCharge) + PTRId (needed to accept the refund).
      const quoteData = result?.Data || result;
      const rq = Array.isArray(quoteData?.RefundQuotes) ? quoteData.RefundQuotes : [];
      const providerPtrId = quoteData?.PTRId ?? quoteData?.PtrId ?? null;
      const totalRefund = rq.reduce((s: number, q: any) => s + (parseFloat(q?.TotalRefundAmount) || 0), 0);
      const totalCharges = rq.reduce((s: number, q: any) => s + (parseFloat(q?.TotalRefundCharges) || 0), 0);
      const cancellationCharge = rq.reduce((s: number, q: any) => s + (parseFloat(q?.CancellationCharge) || 0), 0);
      const currency = rq[0]?.Currency || quoteData?.Currency || 'USD';
      if (ptrRecord) {
        await updatePtrRecord(ptrRecord.id, {
          status: 'QUOTE_RECEIVED',
          quoteTotalAmount: totalRefund || null,
          quotePenaltyAmount: totalCharges || null,
          quoteRefundAmount: totalRefund || null,
          quoteCurrency: currency,
          providerQuoteResponse: result,
        });
      }

      return {
        success: true, ptrId: ptrRecord?.id, providerPtrId,
        ptrStatus: quoteData?.PTRStatus,
        quote: { TotalRefundAmount: totalRefund, TotalRefundCharges: totalCharges, CancellationCharge: cancellationCharge, Currency: currency, RefundQuotes: rq },
        raw: result,
      };
    } catch (error: any) {
      console.error('[PTR] RefundQuote error:', error.message);
      return reply.code(502).send({ error: `RefundQuote failed: ${error.message}` });
    }
  });

  // ── Refund Execute ─────────────────────────────

  fastify.post('/refund', async (request, reply) => {
    try {
      const { uniqueId, ptrId, providerPtrId, bookingId, requestedBy } = request.body as {
        uniqueId: string; ptrId?: string; providerPtrId?: number; bookingId?: string; requestedBy?: string;
      };
      if (!uniqueId) return reply.code(400).send({ error: 'uniqueId is required' });
      if (!providerPtrId) return reply.code(400).send({ error: 'providerPtrId (the RefundQuote PTR id) is required — run Get Refund Quote first.', errorCode: 'MISSING_PTR_ID' });

      if (ptrId) await updatePtrRecord(ptrId, { status: 'EXECUTING', approvedBy: requestedBy, approvedAt: new Date() });

      // Accept Refund — RefundQuote + AcceptQuote=yes + the RefundQuote PTR id + passengers.
      // Returns PTRType=Refund, PTRStatus=InProcess; settles async (Resolution=Refunded).
      const passengers = await loadPtrPassengers(uniqueId, bookingId);
      const result = await mystifly.executeRefund(uniqueId, providerPtrId, passengers, 'Refund accepted via FareMind');
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        if (ptrId) await updatePtrRecord(ptrId, { status: 'FAILED', failureReason: message, failedAt: new Date(), providerExecResponse: result });
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_REFUND_FAILED', raw: result });
      }

      const data = result?.Data || result;
      const ptrStatus = data?.PTRStatus || 'InProcess';
      if (ptrId) await updatePtrRecord(ptrId, { status: /completed/i.test(ptrStatus) ? 'COMPLETED' : 'EXECUTING', executedAt: new Date(), providerExecResponse: result });

      return { success: true, ptrId, providerPtrId, ptrStatus, raw: result };
    } catch (error: any) {
      console.error('[PTR] Refund error:', error.message);
      return reply.code(502).send({ error: `Refund failed: ${error.message}` });
    }
  });

  // ── Reissue Quote ──────────────────────────────

  fastify.post('/reissue-quote', async (request, reply) => {
    try {
      const { uniqueId, bookingId, newFareSourceCode, originDestinations, requestedBy, notes } = request.body as {
        uniqueId: string; bookingId?: string; newFareSourceCode?: string;
        originDestinations?: mystifly.MystiflyReissueOriginDestination[];
        requestedBy?: string; notes?: string;
      };
      if (!uniqueId) return reply.code(400).send({ error: 'uniqueId is required' });

      let ptrRecord = null;
      if (bookingId) {
        ptrRecord = await createPtrRecord({
          bookingId,
          providerUniqueId: uniqueId,
          requestType: 'REISSUE_QUOTE',
          requestedBy: requestedBy || 'system',
          notes,
        });
      }

      // Mystifly's ReIssueQuote is an OND request and requires both `passengers` and
      // `originDestinations`; it has no fare-source-code mode. Sending the bare
      // {mFRef, ptrType} body makes their service 500. Caller-supplied ONDs express a
      // real flight change; otherwise re-quote the booking's current itinerary.
      const passengers = await loadPtrPassengers(uniqueId, bookingId);
      const onds = (Array.isArray(originDestinations) && originDestinations.length > 0)
        ? originDestinations
        : await loadPtrOriginDestinations(uniqueId, bookingId);

      if (passengers.length === 0 || onds.length === 0) {
        const missing = [
          passengers.length === 0 ? 'passengers' : null,
          onds.length === 0 ? 'originDestinations' : null,
        ].filter(Boolean).join(' and ');
        const msg = `Cannot build the reissue quote: ${missing} could not be resolved for this booking. Mystifly rejects a ReIssueQuote without them.`;
        if (ptrRecord) await updatePtrRecord(ptrRecord.id, { status: 'FAILED', failureReason: msg, failedAt: new Date() });
        return reply.code(422).send({ error: msg, errorCode: 'REISSUE_QUOTE_INCOMPLETE' });
      }

      const result = await mystifly.reissueQuote(uniqueId, onds, passengers);
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        if (ptrRecord) await updatePtrRecord(ptrRecord.id, { status: 'FAILED', failureReason: message, failedAt: new Date() });
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_REISSUE_QUOTE_FAILED', raw: result });
      }

      // ReIssueQuote returns the PTR id synchronously; the priced options are fetched
      // separately via GetExchangeQuote (Search PTR).
      const quoteData = result?.Data || result;
      const providerPtrId = quoteData?.PTRId ?? quoteData?.PtrId ?? null;
      if (ptrRecord) {
        await updatePtrRecord(ptrRecord.id, {
          status: 'QUOTE_RECEIVED',
          quoteTotalAmount: quoteData?.TotalAmount || null,
          quotePenaltyAmount: quoteData?.PenaltyAmount || null,
          quoteCurrency: quoteData?.Currency || 'USD',
          fareSourceCode: newFareSourceCode,
          providerQuoteResponse: result,
        });
      }

      return { success: true, ptrId: ptrRecord?.id, providerPtrId, quote: quoteData, originDestinations: onds, raw: result };
    } catch (error: any) {
      console.error('[PTR] ReIssueQuote error:', error.message);
      return reply.code(502).send({ error: `ReIssueQuote failed: ${error.message}` });
    }
  });

  // ── Reissue Execute ────────────────────────────

  fastify.post('/reissue', async (request, reply) => {
    try {
      const { uniqueId, ptrId, providerPtrId, preferenceOption, bookingId, requestedBy } = request.body as {
        uniqueId: string; ptrId?: string; providerPtrId?: number; preferenceOption?: number;
        bookingId?: string; requestedBy?: string;
      };
      if (!uniqueId) return reply.code(400).send({ error: 'uniqueId is required' });
      if (!providerPtrId) return reply.code(400).send({ error: 'providerPtrId (the ReIssueQuote PTR id) is required — run Get Reissue Quote first.', errorCode: 'MISSING_PTR_ID' });

      if (ptrId) await updatePtrRecord(ptrId, { status: 'EXECUTING', approvedBy: requestedBy, approvedAt: new Date() });

      // Accept the quote: re-post with AcceptQuote=yes + the ReIssueQuote PTR id and the
      // chosen fare option. Same contract shape as the refund accept.
      const result = await mystifly.confirmReissue(uniqueId, providerPtrId, preferenceOption ?? 1);
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        if (ptrId) await updatePtrRecord(ptrId, { status: 'FAILED', failureReason: message, failedAt: new Date(), providerExecResponse: result });
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_REISSUE_FAILED', raw: result });
      }

      // Accepting returns PTRType=ReIssue / PTRStatus=InProcess with an SLA (typically
      // 60 min) — the airline has NOT reissued yet. Mark COMPLETED only if the provider
      // itself says so; otherwise EXECUTING, exactly as /void and /refund do.
      const data = result?.Data || result;
      const ptrStatus = data?.PTRStatus || 'InProcess';
      const slaInMinutes = data?.SLAInMinutes ?? null;
      const settled = /completed/i.test(ptrStatus);
      if (ptrId) await updatePtrRecord(ptrId, { status: settled ? 'COMPLETED' : 'EXECUTING', executedAt: new Date(), providerExecResponse: result });

      // Queue fulfilment polling. Booking status is advanced by reissue-settlement only
      // after the provider reports Resolution=Reissued — never here.
      let settlementId: string | null = null;
      if (!settled) {
        settlementId = await enqueueReissueSettlement({
          uniqueId,
          bookingId,
          providerPtrId,
          requestedBy,
          providerResponse: result,
        });
      }

      return {
        success: true,
        ptrId,
        providerPtrId,
        ptrStatus,
        slaInMinutes,
        settled,
        pendingFulfilment: !settled,
        settlementId,
        message: settled
          ? 'Reissue completed by the provider.'
          : data?.Message || `Reissue submitted. The airline fulfils it${slaInMinutes ? ` within ~${slaInMinutes} minutes` : ' shortly'}; the booking updates automatically once confirmed.`,
        raw: result,
      };
    } catch (error: any) {
      console.error('[PTR] ReIssue error:', error.message);
      return reply.code(502).send({ error: `ReIssue failed: ${error.message}` });
    }
  });

  // ── PTR Status Search ──────────────────────────

  fastify.post('/status', async (request, reply) => {
    try {
      const { uniqueId } = request.body as { uniqueId: string };
      if (!uniqueId) return reply.code(400).send({ error: 'uniqueId is required' });

      const result = await mystifly.searchPtrStatus(uniqueId);
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_PTR_STATUS_FAILED', raw: result });
      }

      return { success: true, ...result };
    } catch (error: any) {
      console.error('[PTR] Status search error:', error.message);
      return reply.code(502).send({ error: `PTR status search failed: ${error.message}` });
    }
  });

  // ── Mark As Read ───────────────────────────────

  fastify.post('/mark-read', async (request, reply) => {
    try {
      const { uniqueId } = request.body as { uniqueId: string };
      if (!uniqueId) return reply.code(400).send({ error: 'uniqueId is required' });

      const result = await mystifly.markPtrAsRead(uniqueId);
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_MARK_READ_FAILED', raw: result });
      }

      return { success: true, ...result };
    } catch (error: any) {
      console.error('[PTR] MarkAsRead error:', error.message);
      return reply.code(502).send({ error: `MarkAsRead failed: ${error.message}` });
    }
  });
};

export default ptrPlugin;
