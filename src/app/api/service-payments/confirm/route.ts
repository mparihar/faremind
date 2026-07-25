import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getStripe } from '@/lib/stripe';
import { fulfillPayment } from '@/lib/payments/fulfill';

/**
 * POST /api/service-payments/confirm
 * ─────────────────────────────────────────────────────────────
 * Legacy client-called confirmation, now a SERVER-VERIFIED, IDEMPOTENT fallback
 * to the Stripe webhook (the authoritative fulfiller).
 *
 * We no longer trust the browser: we re-fetch the PaymentIntent from Stripe and
 * only fulfill when Stripe reports `succeeded`. If it's still processing, the
 * webhook will finalize it later. Fulfillment itself is idempotent (a single
 * claim in fulfillPayment), so a webhook + confirm race credits/records once.
 *
 * Body: { paymentId?: string, stripePaymentIntentId?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { paymentId, stripePaymentIntentId } = body;
    if (!paymentId && !stripePaymentIntentId) {
      return NextResponse.json({ error: 'paymentId or stripePaymentIntentId required' }, { status: 400 });
    }

    const payment = await prisma.servicePayment.findFirst({
      where: paymentId ? { id: paymentId } : { stripePaymentIntentId },
      select: { id: true, status: true, fulfilledAt: true, stripePaymentIntentId: true },
    });
    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });

    if (payment.status === 'SUCCEEDED' && payment.fulfilledAt) {
      return NextResponse.json({ success: true, message: 'Already confirmed' });
    }

    // ── Server-side verification: never trust the client's "it succeeded" ──
    if (payment.stripePaymentIntentId) {
      try {
        const pi = await getStripe().paymentIntents.retrieve(payment.stripePaymentIntentId);
        if (pi.status !== 'succeeded') {
          return NextResponse.json({ success: false, pending: true, status: pi.status, message: 'Payment not yet settled; it will be finalized automatically.' });
        }
      } catch {
        return NextResponse.json({ error: 'Unable to verify payment status.' }, { status: 502 });
      }
    }

    const result = await fulfillPayment(payment.id);
    return NextResponse.json({ success: true, alreadyDone: result.alreadyDone, purpose: result.purpose });
  } catch (err: any) {
    console.error('[POST /api/service-payments/confirm]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
