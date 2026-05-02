import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

export const GET = withAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') ?? 'all'; // 'changes' | 'cancellations' | 'all'

  const [changes, cancellations] = await Promise.all([
    type !== 'cancellations'
      ? prisma.changeRequest.findMany({
          where: { status: { in: ['NEW', 'QUOTED', 'CUSTOMER_PAYMENT_PENDING'] } },
          orderBy: { createdAt: 'asc' },
          take: 50,
        })
      : [],
    type !== 'changes'
      ? prisma.cancellationRecord.findMany({
          where: { status: { in: ['CANCEL_REQUESTED', 'IN_PROGRESS', 'REFUND_PENDING'] } },
          orderBy: { createdAt: 'asc' },
          take: 50,
        })
      : [],
  ]);

  // Enrich with booking data
  const changeBookingIds = changes.map(c => c.bookingId);
  const cancelBookingIds = cancellations.map(c => c.bookingId);
  const allIds = [...new Set([...changeBookingIds, ...cancelBookingIds])];

  const bookings = allIds.length
    ? await prisma.booking.findMany({
        where: { id: { in: allIds } },
        select: {
          id: true, pnr: true, status: true,
          originAirport: true, destinationAirport: true,
          departureTime: true, totalPrice: true, currency: true,
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      })
    : [];

  const bookingMap = Object.fromEntries(bookings.map(b => [b.id, b]));

  return NextResponse.json({
    changes: changes.map(c => ({ ...c, booking: bookingMap[c.bookingId] })),
    cancellations: cancellations.map(c => ({ ...c, booking: bookingMap[c.bookingId] })),
    counts: { changes: changes.length, cancellations: cancellations.length },
  });
}, 'READ_ONLY');
