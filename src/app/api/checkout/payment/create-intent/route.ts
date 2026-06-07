/**
 * POST /api/checkout/payment/create-intent
 *
 * Creates a Stripe PaymentIntent for the customer's booking.
 * This is called BEFORE confirming the booking — it sets up the payment
 * that will be captured when the card is confirmed.
 *
 * Request:  { amount: number, currency: string, description?: string, customerEmail?: string, sessionId?: string }
 * Response: { paymentIntentId: string, clientSecret: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      amount,
      currency = 'USD',
      description = 'FAREMIND flight booking',
      customerEmail,
      sessionId,
      userId,
    } = body;

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { error: 'Valid amount is required' },
        { status: 400 }
      );
    }

    // Stripe expects amount in the smallest currency unit (cents for USD)
    const amountInCents = Math.round(amount * 100);

    console.log(
      `[Stripe] Creating PaymentIntent — $${amount.toFixed(2)} ${currency.toUpperCase()} (${amountInCents} cents)`
    );

    let customer = undefined;
    if (userId) {
      // Find a customer id for this user if it exists
      const prisma = (await import('@/lib/db')).default;
      const pm = await prisma.paymentMethod.findFirst({
        where: { userId, providerCustomerId: { not: null } }
      });
      if (pm?.providerCustomerId) {
        customer = pm.providerCustomerId;
      } else {
        // Create new customer for inline saving
        const newCust = await stripe.customers.create({
          email: customerEmail || undefined,
          metadata: { userId }
        });
        customer = newCust.id;
      }
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: currency.toLowerCase(),
      description,
      customer,
      // MANUAL CAPTURE — authorize only, do NOT charge yet.
      // The funds are held on the customer's card but not captured.
      // We capture ONLY after the provider order (Duffel) succeeds.
      // If the provider order fails, we cancel the authorization
      // and the customer is never charged.
      capture_method: 'manual',
      metadata: {
        booked_via: 'faremind',
        session_id: sessionId || '',
        customer_email: customerEmail || '',
      },
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
    });

    console.log(`[Stripe] ✅ PaymentIntent created: ${paymentIntent.id}`);

    return NextResponse.json({
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      customerId: customer,
    });
  } catch (err: any) {
    console.error('[Stripe] ❌ Failed to create PaymentIntent:', err.message);
    return NextResponse.json(
      { error: err.message || 'Failed to create payment' },
      { status: 500 }
    );
  }
}
