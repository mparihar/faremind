import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';
import { providerIdOf } from '@/lib/providers/provider-identity';


/** What a booking contributes to the revenue split. */
const REVENUE_FIELDS = {
  primaryProvider: true,
  serviceFeeAmount: true,
  markupAmount: true,
  seatServiceTotal: true,
  travelInsuranceAmount: true,
  priceProtectionAmount: true,
  thirdPartyPayableTotal: true,
} as const;

interface RevenueSplit {
  /** What customers were charged — volume, not earnings. */
  bookingValue: number;
  /** What FareMind actually earned on it. */
  fareMindRevenue: number;
  byProvider: Record<string, number>;
}

/**
 * Split captured payments by provider, and separate volume from earnings.
 *
 * The tile said "Week Revenue" over the sum of what customers paid — mostly the
 * airline's money passing through. $18,257 of bookings against $780 actually
 * earned reads as 23x what FareMind made. Both numbers are now shown, labelled
 * for what they are.
 *
 * Booking value is summed per PAYMENT, because that is what was captured.
 * FareMind revenue is summed per BOOKING — a booking with two payments would
 * otherwise count its service fee twice.
 */
function splitRevenue(
  rows: Array<{ bookingId: string; amount: unknown; booking: Record<string, unknown> | null }>,
): RevenueSplit {
  const n = (v: unknown) => (v == null ? 0 : Number(v));
  const byProvider: Record<string, number> = {};
  let bookingValue = 0;

  const seen = new Set<string>();
  let fareMindRevenue = 0;

  for (const r of rows) {
    const amount = n(r.amount);
    bookingValue += amount;

    const provider = providerIdOf(r.booking?.primaryProvider) ?? 'unknown';
    byProvider[provider] = (byProvider[provider] ?? 0) + amount;

    if (r.booking && !seen.has(r.bookingId)) {
      seen.add(r.bookingId);
      // Third-party products earn us the spread, not the premium.
      const thirdParty = Math.max(0,
        n(r.booking.travelInsuranceAmount) + n(r.booking.priceProtectionAmount) - n(r.booking.thirdPartyPayableTotal));
      fareMindRevenue += n(r.booking.serviceFeeAmount) + n(r.booking.markupAmount)
        + n(r.booking.seatServiceTotal) + thirdParty;
    }
  }

  const cents = (v: number) => Math.round(v * 100) / 100;
  for (const k of Object.keys(byProvider)) byProvider[k] = cents(byProvider[k]);
  return { bookingValue: cents(bookingValue), fareMindRevenue: cents(fareMindRevenue), byProvider };
}

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
    // Captured payments WITH the provider and the revenue fields of the booking
    // they belong to. The bare _sum could only produce one blended number, and
    // a blended number cannot answer "how much of this was Duffel".
    prisma.bookingPayment.findMany({
      where: { status: 'SUCCEEDED', paidAt: { gte: weekStart } },
      select: { bookingId: true, amount: true, booking: { select: REVENUE_FIELDS } },
    }),
    prisma.bookingPayment.findMany({
      where: { status: 'SUCCEEDED', paidAt: { gte: monthStart } },
      select: { bookingId: true, amount: true, booking: { select: REVENUE_FIELDS } },
    }),
    prisma.masterBooking.findMany({
      take: 8,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        payments: { take: 1, orderBy: { createdAt: 'desc' }, select: { status: true, amount: true, currency: true } },
        pnrs: { where: { isPrimary: true }, take: 1, select: { pnrCode: true, airlinePnr: true } }
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
      masterBookingReference: mb.masterBookingReference,
      // The airline's locator, so the table can lead with our reference and
      // the airline's rather than with Mystifly's.
      airlinePnr: mb.airlinePnr ?? mb.pnrs[0]?.airlinePnr ?? null,
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
      // Kept under the original names so nothing reading this breaks; the
      // split sits alongside.
      weekRevenue: splitRevenue(weekRevenue as any).bookingValue,
      monthRevenue: splitRevenue(monthRevenue as any).bookingValue,
      weekSplit: splitRevenue(weekRevenue as any),
      monthSplit: splitRevenue(monthRevenue as any),
    },
    recentBookings,
  });
}, 'READ_ONLY');
