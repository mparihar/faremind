import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const methods = await prisma.paymentMethod.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    let updatedMethods = [];
    for (const method of methods) {
      if (method.expYear < currentYear || (method.expYear === currentYear && method.expMonth < currentMonth)) {
        await prisma.paymentMethod.update({
          where: { id: method.id },
          data: { status: 'EXPIRED' }
        });
        method.status = 'EXPIRED';
      } else {
        updatedMethods.push(method);
      }
    }

    return NextResponse.json({ success: true, paymentMethods: updatedMethods });
  } catch (error) {
    console.error('[GET /api/payment-methods]', error);
    return NextResponse.json({ error: 'Failed to fetch payment methods' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, providerPaymentMethodId, providerCustomerId } = body;

    if (!userId || !providerPaymentMethodId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Fetch the payment method from Stripe to get secure, verified card details
    const stripe = require('@/lib/stripe').stripe;
    const pm = await stripe.paymentMethods.retrieve(providerPaymentMethodId);
    if (!pm || !pm.card) {
      return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 });
    }

    const existingActive = await prisma.paymentMethod.findFirst({
      where: { userId, status: 'ACTIVE' }
    });

    const paymentMethod = await prisma.paymentMethod.create({
      data: {
        userId,
        provider: 'STRIPE',
        providerCustomerId: providerCustomerId || null,
        providerPaymentMethodId,
        cardBrand: pm.card.brand || 'Unknown',
        cardLast4: pm.card.last4,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year,
        cardholderName: pm.billing_details?.name,
        billingCountry: pm.billing_details?.address?.country,
        billingZip: pm.billing_details?.address?.postal_code,
        isDefault: !existingActive,
        status: 'ACTIVE'
      }
    });

    return NextResponse.json({ success: true, paymentMethod });
  } catch (error) {
    console.error('[POST /api/payment-methods]', error);
    return NextResponse.json({ error: 'Failed to create payment method' }, { status: 500 });
  }
}
