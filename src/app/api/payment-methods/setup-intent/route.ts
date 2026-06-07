import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import prisma from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, email, name } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // See if user already has a stripe customer id from any payment method
    let customerId = null;
    const existing = await prisma.paymentMethod.findFirst({
      where: { userId, providerCustomerId: { not: null } }
    });
    
    if (existing?.providerCustomerId) {
      customerId = existing.providerCustomerId;
    } else {
      // Create a new customer
      const customer = await stripe.customers.create({
        email: email || undefined,
        name: name || undefined,
        metadata: { userId }
      });
      customerId = customer.id;
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
    });

    return NextResponse.json({
      setupIntentId: setupIntent.id,
      clientSecret: setupIntent.client_secret,
      customerId,
    });
  } catch (error: any) {
    console.error('[Stripe] Failed to create SetupIntent:', error);
    return NextResponse.json({ error: error.message || 'Failed to create setup intent' }, { status: 500 });
  }
}
