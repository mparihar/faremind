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
import * as mystifly from '../services/mystifly';
import type { PtrType } from '../services/mystifly';
import { prisma } from '../lib/db';
import { buildPtrPassengers, type PtrPassenger } from '../lib/ptr-passengers';

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
      include: { passengers: { orderBy: { passengerOrder: 'asc' } }, tickets: true },
    });
    if (!booking) return [];
    return buildPtrPassengers(booking);
  } catch {
    return [];
  }
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

      return { success: true, ptrId, providerPtrId, ptrStatus, raw: result };
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
      const { uniqueId, bookingId, newFareSourceCode, requestedBy, notes } = request.body as {
        uniqueId: string; bookingId?: string; newFareSourceCode?: string; requestedBy?: string; notes?: string;
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

      const result = await mystifly.postTicketingRequest(uniqueId, 'ReIssueQuote', undefined, newFareSourceCode);
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        if (ptrRecord) await updatePtrRecord(ptrRecord.id, { status: 'FAILED', failureReason: message, failedAt: new Date() });
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_REISSUE_QUOTE_FAILED', raw: result });
      }

      const quoteData = result?.Data || result;
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

      return { success: true, ptrId: ptrRecord?.id, quote: quoteData, raw: result };
    } catch (error: any) {
      console.error('[PTR] ReIssueQuote error:', error.message);
      return reply.code(502).send({ error: `ReIssueQuote failed: ${error.message}` });
    }
  });

  // ── Reissue Execute ────────────────────────────

  fastify.post('/reissue', async (request, reply) => {
    try {
      const { uniqueId, ptrId, newFareSourceCode, requestedBy } = request.body as {
        uniqueId: string; ptrId?: string; newFareSourceCode?: string; requestedBy?: string;
      };
      if (!uniqueId) return reply.code(400).send({ error: 'uniqueId is required' });

      if (ptrId) await updatePtrRecord(ptrId, { status: 'EXECUTING', approvedBy: requestedBy, approvedAt: new Date() });

      const result = await mystifly.postTicketingRequest(uniqueId, 'ReIssue', undefined, newFareSourceCode);
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        if (ptrId) await updatePtrRecord(ptrId, { status: 'FAILED', failureReason: message, failedAt: new Date(), providerExecResponse: result });
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_REISSUE_FAILED', raw: result });
      }

      if (ptrId) await updatePtrRecord(ptrId, { status: 'COMPLETED', executedAt: new Date(), providerExecResponse: result });

      return { success: true, ptrId, raw: result };
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

  // ── Schedule Change: probe (capture live response shape) ───────────────
  // Temporary probe to capture the real GetPolicyInfoForScheduleChange response
  // for a booking, so we can build the detection cron against the verified shape.
  // Logs under [SCHEDULE][DEBUG] and returns the raw payload.
  fastify.post('/schedule-change/probe', async (request, reply) => {
    try {
      const { uniqueId, actionType } = request.body as { uniqueId: string; actionType?: string };
      if (!uniqueId) return reply.code(400).send({ error: 'uniqueId (MFRef) is required' });
      const result = await mystifly.getScheduleChangePolicy(uniqueId, (actionType as any) || 'None');
      return { success: true, mfRef: uniqueId, raw: result };
    } catch (error: any) {
      console.error('[PTR] ScheduleChange probe error:', error.message);
      return reply.code(502).send({ error: `Schedule-change probe failed: ${error.message}` });
    }
  });
};

export default ptrPlugin;
