/**
 * Ticketing — internal backend endpoints.
 *
 *   POST /api/ticketing/queue  { bookingId, providerUniqueId, fareSourceCode? }
 *     → enqueue a TicketingReconciliation record so the background cron polls
 *       Mystifly (AirTicketOrderStatus + TripDetails) until the ticket resolves.
 *
 * Called server-side by the Next.js checkout confirm route over HTTP (Next
 * routes cannot import backend worker code across the bundle boundary — that
 * silent failure is exactly why reconciliation records were never being created).
 */
import { FastifyPluginAsync } from 'fastify';
import { queueForReconciliation } from '../workers/ticketing-reconciliation';
import * as mystifly from '../services/mystifly';

const ticketingPlugin: FastifyPluginAsync = async (fastify) => {
  // Diagnostic: live AirTicketOrderStatus + TripDetails for an MFRef (staff/ops).
  fastify.post('/trip-details', async (request, reply) => {
    const { mfRef } = (request.body || {}) as { mfRef?: string };
    if (!mfRef) return reply.code(400).send({ error: 'mfRef is required' });
    try {
      const [ticketOrderStatus, tripDetails] = await Promise.all([
        mystifly.getTicketOrderStatus(mfRef).catch((e: any) => ({ error: e?.message || 'AirTicketOrderStatus failed' })),
        mystifly.getTripDetailsResilient(mfRef).catch((e: any) => ({ error: e?.message || 'TripDetails failed' })),
      ]);
      return { mfRef, ticketOrderStatus, tripDetails };
    } catch (e: any) {
      return reply.code(502).send({ error: e?.message || 'Provider lookup failed' });
    }
  });

  fastify.post('/queue', async (request, reply) => {
    const { bookingId, providerUniqueId, fareSourceCode } = (request.body || {}) as {
      bookingId?: string; providerUniqueId?: string; fareSourceCode?: string;
    };
    if (!bookingId || !providerUniqueId) {
      return reply.code(400).send({ error: 'bookingId and providerUniqueId are required' });
    }
    try {
      const id = await queueForReconciliation({ bookingId, providerUniqueId, fareSourceCode });
      return { success: true, reconciliationId: id };
    } catch (e: any) {
      request.log.error(`[ticketing/queue] failed for booking ${bookingId}: ${e?.message}`);
      return reply.code(500).send({ error: e?.message || 'Failed to queue reconciliation' });
    }
  });
};

export default ticketingPlugin;
