/**
 * POST /api/stripe/webhook
 * ─────────────────────────────────────────────────────────────
 * AUTHORITATIVE payment fulfillment. Lives on the backend alongside the other
 * Stripe business logic (refunds, cancellations). FareMind never credits a
 * wallet, applies a booking payment, or finalizes an "other" payment on a
 * browser redirect — only here, after Stripe verifies the charge.
 *
 * Guarantees:
 *   • Signature verified against STRIPE_WEBHOOK_SECRET (RAW body).
 *   • Every event id deduped via StripeWebhookEvent (processed exactly once).
 *   • Fulfillment is idempotent (services/payment-fulfill.ts claim).
 *   • Raw card data is never read/logged/stored — Stripe references only.
 *
 * Stripe dashboard: point the endpoint at the BACKEND URL and subscribe to
 *   payment_intent.succeeded, payment_intent.payment_failed, payment_intent.canceled
 */
import { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import { prisma } from '../lib/db';
import { fulfillPayment, markPaymentFailed } from '../services/payment-fulfill';
import { recordRefundOutcome } from '../services/booking-refund';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { typescript: true });

const stripeWebhookPlugin: FastifyPluginAsync = async (fastify) => {
  // Capture the RAW request body (Buffer) for signature verification. This
  // content-type parser is ENCAPSULATED to this plugin only — other routes keep
  // normal JSON parsing.
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  fastify.post('/', async (request, reply) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      request.log.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET not configured');
      return reply.code(500).send({ error: 'Webhook not configured' });
    }
    const sig = request.headers['stripe-signature'] as string | undefined;
    if (!sig) return reply.code(400).send({ error: 'Missing signature' });

    let event: any;
    try {
      event = stripe.webhooks.constructEvent(request.body as Buffer, sig, secret);
    } catch (err: any) {
      request.log.error(`[stripe/webhook] signature verification failed: ${err?.message}`);
      return reply.code(400).send({ error: 'Webhook signature verification failed' });
    }

    // ── Dedupe: first insert wins; a duplicate event id means already handled ──
    try {
      await prisma.stripeWebhookEvent.create({
        data: { eventId: event.id, eventType: event.type, objectRef: (event.data?.object as any)?.id ?? null, status: 'PROCESSED' },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') return reply.send({ received: true, duplicate: true });
      request.log.error(`[stripe/webhook] dedupe write error: ${e?.message}`);
      // fall through — better to attempt idempotent fulfillment than drop the event
    }

    try {
      switch (event.type) {
        case 'payment_intent.succeeded': {
          const pi = event.data.object;
          const payment = await prisma.servicePayment.findUnique({ where: { stripePaymentIntentId: pi.id }, select: { id: true } });
          if (!payment) { await tagEvent(event.id, 'IGNORED'); return reply.send({ received: true, ignored: true }); }
          const result = await fulfillPayment(payment.id, { stripeEventId: event.id });
          if (result.error) await tagEvent(event.id, 'ERROR', result.error);
          break;
        }
        case 'payment_intent.payment_failed': {
          const pi = event.data.object;
          const payment = await prisma.servicePayment.findUnique({ where: { stripePaymentIntentId: pi.id }, select: { id: true } });
          if (payment) await markPaymentFailed(payment.id, pi.last_payment_error?.message || 'Payment failed', event.id);
          break;
        }
        case 'payment_intent.canceled': {
          const pi = event.data.object;
          const payment = await prisma.servicePayment.findUnique({ where: { stripePaymentIntentId: pi.id }, select: { id: true } });
          if (payment) await markPaymentFailed(payment.id, 'Payment canceled', event.id);
          break;
        }
        // ── Refunds ──────────────────────────────────────────────────────
        //
        // The webhook is the only place Stripe's actual verdict arrives. A
        // refunds.create() that resolves means accepted, not settled — a refund
        // can still fail afterwards, and until now nothing would have noticed:
        // the customer had already been told their card was refunded.
        case 'charge.refunded':
        case 'refund.updated':
        case 'charge.refund.updated': {
          const obj = event.data.object as any;
          // charge.refunded carries the charge; refund.* carries the refund.
          const refund = obj?.object === 'refund' ? obj : obj?.refunds?.data?.[0];
          if (!refund) { await tagEvent(event.id, 'IGNORED'); break; }
          await recordRefundOutcome({
            paymentIntentId: refund.payment_intent ?? obj?.payment_intent ?? null,
            refundId: refund.id,
            status: String(refund.status ?? ''),
            amount: (refund.amount ?? 0) / 100,
            currency: String(refund.currency ?? '').toUpperCase(),
            failureReason: refund.failure_reason ?? null,
          });
          break;
        }

        default:
          await tagEvent(event.id, 'IGNORED');
          break;
      }
    } catch (e: any) {
      request.log.error(`[stripe/webhook] handler error (${event.type}): ${e?.message}`);
      await tagEvent(event.id, 'ERROR', e?.message).catch(() => {});
      return reply.code(500).send({ error: 'Handler error' }); // Stripe retries; fulfillment stays idempotent
    }

    return reply.send({ received: true });
  });
};

async function tagEvent(eventId: string, status: string, error?: string): Promise<void> {
  await prisma.stripeWebhookEvent.update({ where: { eventId }, data: { status, error: error?.slice(0, 500) } }).catch(() => {});
}

export default stripeWebhookPlugin;
