import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

export const GET = withAdmin(async (_req: NextRequest) => {
  const now = new Date();
  // Calculate "today" in US Central time (where the admin operates)
  const centralNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const dayStart = new Date(centralNow); dayStart.setHours(0, 0, 0, 0);
  // Convert back to UTC for DB queries
  const offset = now.getTime() - centralNow.getTime();
  const dayStartUTC = new Date(dayStart.getTime() + offset);
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
  const monthStart = new Date(now); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  // ── Auto-cleanup stale pending records ──────────────────────────────────
  // This ensures the Pending Work count is always accurate
  await Promise.allSettled([
    // 1. Seat change audit trail entries → CONFIRMED (they're already done)
    prisma.changeRequest.updateMany({
      where: { type: { not: 'DATE_CHANGE' }, status: 'NEW' },
      data: { status: 'CONFIRMED', confirmedAt: now },
    }),
    // 2. Expired change request quotes → CANCELLED
    prisma.changeRequest.updateMany({
      where: {
        status: { in: ['NEW', 'QUOTED', 'CUSTOMER_PAYMENT_PENDING'] },
        expiresAt: { lt: now },
      },
      data: { status: 'CANCELLED' },
    }),
    // 3. Cancellation records where booking is already CANCELLED → resolve the record
    prisma.$executeRaw`
      UPDATE cancellations SET status = 'CANCELLED', cancelled_at = NOW()
      WHERE status IN ('CANCEL_REQUESTED', 'IN_PROGRESS')
      AND booking_id IN (
        SELECT id FROM master_bookings WHERE booking_status = 'CANCELLED'
      )
    `,
  ]);

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
    prisma.masterBooking.count({ where: { bookingStatus: 'CONFIRMED', createdAt: { gte: dayStartUTC } } }),
    prisma.masterBooking.count({ where: { bookingStatus: 'CANCELLED', updatedAt: { gte: dayStartUTC } } }),
    prisma.changeRequest.count({
      where: {
        AND: [
          { status: { in: ['NEW', 'QUOTED', 'CUSTOMER_PAYMENT_PENDING'] } },
          { type: 'DATE_CHANGE' }, // Seat changes are audit trail — not pending work
          { OR: [
            { expiresAt: null },           // no expiry set
            { expiresAt: { gte: now } },   // not yet expired
          ]},
        ],
      },
    }),
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
