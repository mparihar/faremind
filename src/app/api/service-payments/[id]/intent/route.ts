import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { stripe } from '@/lib/stripe';

/**
 * POST /api/service-payments/[id]/intent
 *
 * Create (or reuse) a Stripe PaymentIntent for a ServicePayment that ALREADY EXISTS.
 *
 * POST /api/service-payments always mints a new row, which is right when the customer
 * chooses to pay for something. It is wrong for a payment the system raised on their
 * behalf — a reissue difference, say — because the row already carries the execution
 * context the webhook needs to finish the job. Paying a duplicate row would take the
 * money and complete nothing.
 *
 * Auth: the session user must own the payment, by user id or by customer email.
 */

async function getSessionUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '') || req.cookies.get('faremind_session')?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true, role: true } } },
  });
  if (!session || !session.user || new Date(session.expiresAt) < new Date()) return null;
  return session.user;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await ctx.params;

    const payment = await prisma.servicePayment.findFirst({
      where: {
        id,
        OR: [
          { userId: user.id },
          { customerEmail: { equals: user.email, mode: 'insensitive' } },
        ],
      },
      include: { booking: { select: { masterBookingReference: true } } },
    });

    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    if (payment.status === 'SUCCEEDED') {
      return NextResponse.json({ error: 'This payment has already been made.', code: 'ALREADY_PAID' }, { status: 409 });
    }
    if (payment.status !== 'PENDING') {
      return NextResponse.json({ error: `This payment cannot be completed (status ${payment.status}).`, code: 'NOT_PAYABLE' }, { status: 409 });
    }

    const amount = Number(payment.amount);
    if (!(amount > 0)) {
      return NextResponse.json({ error: 'This payment has no amount due.', code: 'NOTHING_DUE' }, { status: 409 });
    }

    // Reuse the existing intent when it is still usable, so re-opening the page does not
    // strand a trail of abandoned PaymentIntents against one payable row.
    if (payment.stripePaymentIntentId) {
      try {
        const existing = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
        if (existing.status !== 'canceled' && existing.status !== 'succeeded' && existing.client_secret) {
          return NextResponse.json({
            paymentId: payment.id,
            clientSecret: existing.client_secret,
            stripePaymentIntentId: existing.id,
            amount, currency: payment.currency,
            description: payment.description,
            reused: true,
          });
        }
      } catch {
        // Unretrievable (wrong mode, deleted) — fall through and mint a fresh one.
      }
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: String(payment.currency || 'USD').toLowerCase(),
      description: `FAREMIND: ${payment.description}`,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: {
        booked_via: 'faremind',
        service_payment_id: payment.id,
        // The webhook dispatches on this to finish the underlying action.
        payment_purpose: payment.paymentPurpose,
        service_type: payment.serviceType,
        booking_ref: payment.booking?.masterBookingReference || '',
        customer_email: payment.customerEmail,
      },
    });

    await prisma.servicePayment.update({
      where: { id: payment.id },
      data: { stripePaymentIntentId: paymentIntent.id },
    });

    return NextResponse.json({
      paymentId: payment.id,
      clientSecret: paymentIntent.client_secret,
      stripePaymentIntentId: paymentIntent.id,
      amount, currency: payment.currency,
      description: payment.description,
      reused: false,
    });
  } catch (err: any) {
    console.error('[POST /api/service-payments/[id]/intent]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
