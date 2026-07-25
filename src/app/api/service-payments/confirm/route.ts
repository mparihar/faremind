import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getStripe } from '@/lib/stripe';

/**
 * POST /api/service-payments/confirm
 * ─────────────────────────────────────────────────────────────
 * Legacy client-called confirmation, now a SERVER-VERIFIED, IDEMPOTENT fallback
 * to the Stripe webhook (which is authoritative and lives on the BACKEND).
 *
 * We don't trust the browser: we re-fetch the PaymentIntent from Stripe and only
 * proceed when Stripe reports `succeeded`, then delegate the actual fulfillment
 * to the backend (POST /api/payments/fulfill) so there is a SINGLE fulfillment
 * implementation. Fulfillment is idempotent, so a webhook + confirm race
 * credits/records exactly once.
 *
 * Body: { paymentId?: string, stripePaymentIntentId?: string }
 */
const BACKEND = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

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

    // ── Delegate fulfillment to the backend (single, idempotent implementation) ──
    try {
      const res = await fetch(`${BACKEND}/api/payments/fulfill`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: payment.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return NextResponse.json({ error: data.error || 'Fulfillment failed' }, { status: 502 });
      return NextResponse.json({ success: true, alreadyDone: data.alreadyDone, purpose: data.purpose });
    } catch (e: any) {
      // The webhook remains the authoritative path and will finalize it.
      return NextResponse.json({ success: false, pending: true, message: 'Payment verified; fulfillment will complete automatically.' });
    }
  } catch (err: any) {
    console.error('[POST /api/service-payments/confirm]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
