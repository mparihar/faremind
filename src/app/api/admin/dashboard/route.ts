import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

export const GET = withAdmin(async (_req: NextRequest) => {
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
  const monthStart = new Date(now); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [
    totalBookings,
    confirmedToday,
    cancelledToday,
    pendingChanges,
    pendingCancellations,
    weekRevenue,
    monthRevenue,
    recentBookings,
    openAlerts,
  ] = await Promise.all([
    prisma.booking.count(),
    prisma.booking.count({ where: { status: 'CONFIRMED', createdAt: { gte: dayStart } } }),
    prisma.booking.count({ where: { status: 'CANCELLED', cancelledAt: { gte: dayStart } } }),
    prisma.changeRequest.count({ where: { status: { in: ['NEW', 'QUOTED', 'CUSTOMER_PAYMENT_PENDING'] } } }),
    prisma.cancellationRecord.count({ where: { status: { in: ['CANCEL_REQUESTED', 'IN_PROGRESS'] } } }),
    prisma.payment.aggregate({
      where: { status: 'COMPLETED', processedAt: { gte: weekStart } },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { status: 'COMPLETED', processedAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
    prisma.booking.findMany({
      take: 8,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        payments: { take: 1, orderBy: { createdAt: 'desc' }, select: { status: true, amount: true } },
      },
    }),
    prisma.priceAlert.count({ where: { status: 'NEW' } }),
  ]);

  return NextResponse.json({
    stats: {
      totalBookings,
      confirmedToday,
      cancelledToday,
      pendingWork: pendingChanges + pendingCancellations,
      pendingChanges,
      pendingCancellations,
      openAlerts,
      weekRevenue: Number(weekRevenue._sum.amount ?? 0),
      monthRevenue: Number(monthRevenue._sum.amount ?? 0),
    },
    recentBookings,
  });
}, 'READ_ONLY');
