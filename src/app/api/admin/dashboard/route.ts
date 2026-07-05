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
    recentBookingsMaster,
    openAlerts,
    openSupportTickets,
  ] = await Promise.all([
    prisma.masterBooking.count(),
    prisma.masterBooking.count({ where: { bookingStatus: 'CONFIRMED', createdAt: { gte: dayStart } } }),
    prisma.masterBooking.count({ where: { bookingStatus: 'CANCELLED', updatedAt: { gte: dayStart } } }),
    prisma.changeRequest.count({ where: { status: { in: ['NEW', 'QUOTED', 'CUSTOMER_PAYMENT_PENDING'] } } }),
    prisma.cancellationRecord.count({ where: { status: { in: ['CANCEL_REQUESTED', 'IN_PROGRESS'] } } }),
    prisma.bookingPayment.aggregate({
      where: { status: 'SUCCEEDED', paidAt: { gte: weekStart } },
      _sum: { amount: true },
    }),
    prisma.bookingPayment.aggregate({
      where: { status: 'SUCCEEDED', paidAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
    prisma.masterBooking.findMany({
      take: 8,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        payments: { take: 1, orderBy: { createdAt: 'desc' }, select: { status: true, amount: true, currency: true } },
        pnrs: { where: { isPrimary: true }, take: 1, select: { pnrCode: true } }
      },
    }),
    prisma.priceAlert.count({ where: { status: 'NEW' } }),
    prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
  ]);

  const recentBookings = recentBookingsMaster.map(mb => {
    const nameParts = mb.customerName.split(' ');
    const firstName = nameParts[0] ?? '';
    const lastName = nameParts.slice(1).join(' ') || '';

    return {
      id: mb.id,
      pnr: mb.masterPnr ?? mb.pnrs[0]?.pnrCode ?? mb.masterBookingReference,
      status: mb.bookingStatus,
      originAirport: mb.originAirport,
      destinationAirport: mb.destinationAirport,
      departureTime: mb.departureDate,
      totalPrice: Number(mb.totalAmount),
      currency: mb.currency,
      createdAt: mb.createdAt,
      user: mb.user 
        ? { firstName: mb.user.firstName, lastName: mb.user.lastName, email: mb.user.email }
        : { firstName, lastName, email: mb.customerEmail },
      payments: mb.payments.map(p => ({ status: p.status, amount: Number(p.amount) })),
    };
  });

  return NextResponse.json({
    stats: {
      totalBookings,
      confirmedToday,
      cancelledToday,
      pendingWork: pendingChanges + pendingCancellations,
      pendingChanges,
      pendingCancellations,
      openAlerts,
      openSupportTickets,
      weekRevenue: Number(weekRevenue._sum.amount ?? 0),
      monthRevenue: Number(monthRevenue._sum.amount ?? 0),
    },
    recentBookings,
  });
}, 'READ_ONLY');
