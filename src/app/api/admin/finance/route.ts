import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

export const GET = withAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to   = searchParams.get('to');

  const dateFilter = from || to ? {
    processedAt: {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to) }   : {}),
    },
  } : {};

  const [revenue, refunds, settlements, recentPayments] = await Promise.all([
    prisma.payment.aggregate({
      where: { status: 'COMPLETED', type: 'BOOKING', ...dateFilter },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.payment.aggregate({
      where: { status: { in: ['REFUNDED', 'PARTIALLY_REFUNDED'] }, ...dateFilter },
      _sum: { refundedAmount: true },
      _count: true,
    }),
    prisma.partnerSettlement.findMany({
      where: { status: 'PENDING' },
      include: { partner: { select: { name: true, email: true } } },
      orderBy: { periodEnd: 'desc' },
      take: 10,
    }),
    prisma.payment.findMany({
      take: 15,
      orderBy: { createdAt: 'desc' },
      include: {
        booking: {
          select: { pnr: true, originAirport: true, destinationAirport: true,
            user: { select: { firstName: true, lastName: true } } },
        },
      },
    }),
  ]);

  return NextResponse.json({
    revenue: { total: Number(revenue._sum.amount ?? 0), count: revenue._count },
    refunds: { total: Number(refunds._sum.refundedAmount ?? 0), count: refunds._count },
    pendingSettlements: settlements,
    recentPayments,
  });
}, 'FINANCE');
