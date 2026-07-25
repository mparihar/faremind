/**
 * Backend payments — internal fulfillment endpoint.
 *
 *   POST /api/payments/fulfill  { paymentId }  → run idempotent fulfillment
 *
 * Called server-side by the frontend /api/service-payments/confirm fallback
 * AFTER it has server-verified (re-fetched) that the PaymentIntent succeeded.
 * The Stripe webhook is the primary/authoritative path; this is the fallback.
 * Both share the same idempotent claim in services/payment-fulfill.ts.
 */
import { FastifyPluginAsync } from 'fastify';
import { fulfillPayment } from '../services/payment-fulfill';

const paymentsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/fulfill', async (request, reply) => {
    const { paymentId } = (request.body || {}) as { paymentId?: string };
    if (!paymentId) return reply.code(400).send({ error: 'paymentId is required' });
    try {
      const result = await fulfillPayment(paymentId, {});
      return { success: true, ...result };
    } catch (e: any) {
      return reply.code(500).send({ error: e?.message || 'Fulfillment failed' });
    }
  });
};

export default paymentsPlugin;
