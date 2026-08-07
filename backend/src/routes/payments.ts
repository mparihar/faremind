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
import { refundBookingPayment } from '../services/booking-refund';

const paymentsPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * Refund a captured payment for a booking that could not be made.
   *
   * Owned by the backend like every other refund, so the money movement and the
   * webhook that confirms it live in one place. The frontend used to call
   * Stripe directly here, which meant nothing recorded that a refund was owed
   * if the call failed.
   */
  fastify.post('/booking-refund', async (request, reply) => {
    const { paymentIntentId, reason, bookingRef } = request.body as {
      paymentIntentId?: string; reason?: string; bookingRef?: string;
    };
    if (!paymentIntentId) {
      return reply.code(400).send({ error: 'paymentIntentId is required' });
    }
    const result = await refundBookingPayment({
      paymentIntentId,
      reason: reason || 'Booking could not be completed',
      bookingRef: bookingRef ?? null,
    });
    // Never a 5xx: the caller is already handling a failed booking, and a
    // refund that could not be issued still has to be reported, not thrown.
    return reply.send(result);
  });

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
