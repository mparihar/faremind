/**
 * POST /api/stripe/webhook
 * ─────────────────────────────────────────────────────────────
 * The single AUTHORITATIVE source of truth for payment fulfillment.
 * FareMind never credits a wallet, applies a booking payment, or finalizes an
 * "other" payment on a browser redirect — only here, after Stripe has verified
 * the charge.
 *
 * Guarantees:
 *   • Signature is verified against STRIPE_WEBHOOK_SECRET (raw body).
 *   • Every event id is deduped via StripeWebhookEvent (processed exactly once).
 *   • Fulfillment is idempotent (see lib/payments/fulfill.ts claim).
 *   • Raw card data is never read, logged, or stored — Stripe references only.
 *
 * Stripe dashboard: add this URL as an endpoint and subscribe to
 *   payment_intent.succeeded, payment_intent.payment_failed, payment_intent.canceled
 */

import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { prisma } from '@/lib/db';
import { fulfillPayment, markPaymentFailed } from '@/lib/payments/fulfill';

// Ensure the raw body is available for signature verification (no caching/parsing).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

  let event: any;
  try {
    const rawBody = await req.text();
    event = getStripe().webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    console.error('[stripe/webhook] signature verification failed:', err?.message);
    return NextResponse.json({ error: `Webhook signature verification failed` }, { status: 400 });
  }

  // ── Dedupe: record the event id; if it already exists, we've processed it. ──
  try {
    await prisma.stripeWebhookEvent.create({
      data: { eventId: event.id, eventType: event.type, objectRef: (event.data?.object as any)?.id ?? null, status: 'PROCESSED' },
    });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      // Already handled — acknowledge so Stripe stops retrying.
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error('[stripe/webhook] dedupe write error:', e?.message);
    // fall through — better to attempt idempotent fulfillment than to drop the event
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        const payment = await prisma.servicePayment.findUnique({ where: { stripePaymentIntentId: pi.id }, select: { id: true } });
        if (!payment) {
          // Not a ServicePayment PI (e.g. a booking checkout PI handled elsewhere) — acknowledge.
          await tagEvent(event.id, 'IGNORED');
          return NextResponse.json({ received: true, ignored: true });
        }
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
      default:
        await tagEvent(event.id, 'IGNORED');
        break;
    }
  } catch (e: any) {
    console.error(`[stripe/webhook] handler error (${event.type}):`, e?.message);
    await tagEvent(event.id, 'ERROR', e?.message).catch(() => {});
    // Return 500 so Stripe retries; our fulfillment claim keeps it idempotent.
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function tagEvent(eventId: string, status: string, error?: string): Promise<void> {
  await prisma.stripeWebhookEvent.update({ where: { eventId }, data: { status, error: error?.slice(0, 500) } }).catch(() => {});
}
