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
  const err = result?.Data?.Error || result?.Error;
  if (err?.ErrorCode && err.ErrorCode !== '0') {
    return { hasError: true, message: err.ErrorMessage || 'PTR request failed', code: err.ErrorCode };
  }
  return { hasError: false, message: '', code: '' };
}

async function createPtrRecord(params: {
  bookingId: string;
  providerUniqueId: string;
  requestType: string;
  requestedBy: string;
  requestedByRole?: string;
  notes?: string;
}) {
  return prisma.postTicketingRequest.create({
    data: {
      bookingId: params.bookingId,
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
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_VOID_QUOTE_FAILED', raw: result });
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
