import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

/**
 * Admin Finance — Payments API
 * Returns BookingPayment records with optional status filter.
 * NEW API — does not modify existing /api/admin/finance route.
 */
export const GET = withAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');

  const where: any = {};
  if (status && status !== 'ALL') {
    where.status = status;
  }

  const payments = await prisma.bookingPayment.findMany({
    where,
    include: {
      booking: {
        select: {
          masterBookingReference: true,
          primaryProvider: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return NextResponse.json({
    payments: payments.map(p => ({
      id: p.id,
      bookingId: p.bookingId,
      bookingRef: p.booking?.masterBookingReference || '',
      provider: p.booking?.primaryProvider || '',
      stripePaymentIntentId: p.stripePaymentIntentId,
      amount: Number(p.amount),
      currency: p.currency,
      paymentMethodType: p.paymentMethodType,
      cardLast4: p.cardLast4,
      status: p.status,
      paidAt: p.paidAt?.toISOString() || null,
      createdAt: p.createdAt.toISOString(),
    })),
  });
}, 'FINANCE');
