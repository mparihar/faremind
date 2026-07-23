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

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

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

      const result = await mystifly.postTicketingRequest(uniqueId, 'VoidQuote');
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        if (ptrRecord) await updatePtrRecord(ptrRecord.id, { status: 'FAILED', failureReason: message, failedAt: new Date() });
        // Void is only allowed inside the airline's void window (typically same day
        // as ticketing). A generic rejection here almost always means the ticket is
        // outside that window — point the agent at Refund / Force Cancel instead.
        const notEligible = /verify the request|not eligible|not allowed|not permitted|window|invalid/i.test(message);
        const friendly = notEligible
          ? `Void is not available for this ticket (${message}). Void is only allowed within the airline's void window — usually the same day as ticketing. Use "Get Refund Quote" instead, or "Force Cancel + Refund".`
          : message;
        return reply.code(422).send({ error: friendly, errorCode: 'MYSTIFLY_VOID_QUOTE_FAILED', raw: result });
      }

      // Extract quote info
      const quoteData = result?.Data || result;
      if (ptrRecord) {
        await updatePtrRecord(ptrRecord.id, {
          status: 'QUOTE_RECEIVED',
          quoteTotalAmount: quoteData?.TotalAmount || null,
          quotePenaltyAmount: quoteData?.PenaltyAmount || null,
          quoteCurrency: quoteData?.Currency || 'USD',
          providerQuoteResponse: result,
        });
      }

      return { success: true, ptrId: ptrRecord?.id, quote: quoteData, raw: result };
    } catch (error: any) {
      console.error('[PTR] VoidQuote error:', error.message);
      return reply.code(502).send({ error: `VoidQuote failed: ${error.message}` });
    }
  });

  // ── Void Execute ───────────────────────────────

  fastify.post('/void', async (request, reply) => {
    try {
      const { uniqueId, ptrId, requestedBy } = request.body as {
        uniqueId: string; ptrId?: string; requestedBy?: string;
      };
      if (!uniqueId) return reply.code(400).send({ error: 'uniqueId is required' });

      if (ptrId) await updatePtrRecord(ptrId, { status: 'EXECUTING', approvedBy: requestedBy, approvedAt: new Date() });

      const result = await mystifly.postTicketingRequest(uniqueId, 'Void');
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        if (ptrId) await updatePtrRecord(ptrId, { status: 'FAILED', failureReason: message, failedAt: new Date(), providerExecResponse: result });
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_VOID_FAILED', raw: result });
      }

      if (ptrId) await updatePtrRecord(ptrId, { status: 'COMPLETED', executedAt: new Date(), providerExecResponse: result });

      return { success: true, ptrId, raw: result };
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

      const result = await mystifly.postTicketingRequest(uniqueId, 'RefundQuote');
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        if (ptrRecord) await updatePtrRecord(ptrRecord.id, { status: 'FAILED', failureReason: message, failedAt: new Date() });
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_REFUND_QUOTE_FAILED', raw: result });
      }

      const quoteData = result?.Data || result;
      if (ptrRecord) {
        await updatePtrRecord(ptrRecord.id, {
          status: 'QUOTE_RECEIVED',
          quoteTotalAmount: quoteData?.TotalAmount || null,
          quotePenaltyAmount: quoteData?.PenaltyAmount || null,
          quoteRefundAmount: quoteData?.RefundAmount || null,
          quoteCurrency: quoteData?.Currency || 'USD',
          providerQuoteResponse: result,
        });
      }

      return { success: true, ptrId: ptrRecord?.id, quote: quoteData, raw: result };
    } catch (error: any) {
      console.error('[PTR] RefundQuote error:', error.message);
      return reply.code(502).send({ error: `RefundQuote failed: ${error.message}` });
    }
  });

  // ── Refund Execute ─────────────────────────────

  fastify.post('/refund', async (request, reply) => {
    try {
      const { uniqueId, ptrId, requestedBy } = request.body as {
        uniqueId: string; ptrId?: string; requestedBy?: string;
      };
      if (!uniqueId) return reply.code(400).send({ error: 'uniqueId is required' });

      if (ptrId) await updatePtrRecord(ptrId, { status: 'EXECUTING', approvedBy: requestedBy, approvedAt: new Date() });

      const result = await mystifly.postTicketingRequest(uniqueId, 'Refund');
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        if (ptrId) await updatePtrRecord(ptrId, { status: 'FAILED', failureReason: message, failedAt: new Date(), providerExecResponse: result });
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_REFUND_FAILED', raw: result });
      }

      if (ptrId) await updatePtrRecord(ptrId, { status: 'COMPLETED', executedAt: new Date(), providerExecResponse: result });

      return { success: true, ptrId, raw: result };
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
};

export default ptrPlugin;
