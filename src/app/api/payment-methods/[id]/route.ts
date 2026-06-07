import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { stripe } from '@/lib/stripe';

export async function DELETE(req: NextRequest, context: { params: { id: string } }) {
  try {
    const { id } = context.params;
    
    const paymentMethod = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!paymentMethod) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Detach from Stripe
    try {
      await stripe.paymentMethods.detach(paymentMethod.providerPaymentMethodId);
    } catch (e: any) {
      console.warn('Could not detach payment method from Stripe:', e.message);
    }

    await prisma.paymentMethod.update({
      where: { id },
      data: { status: 'DELETED' }
    });

    // If it was default, make another one default
    if (paymentMethod.isDefault) {
      const another = await prisma.paymentMethod.findFirst({
        where: { userId: paymentMethod.userId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' }
      });
      if (another) {
        await prisma.paymentMethod.update({
          where: { id: another.id },
          data: { isDefault: true }
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/payment-methods]', error);
    return NextResponse.json({ error: 'Failed to delete payment method' }, { status: 500 });
  }
}
