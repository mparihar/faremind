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

const ticketingPlugin: FastifyPluginAsync = async (fastify) => {
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
