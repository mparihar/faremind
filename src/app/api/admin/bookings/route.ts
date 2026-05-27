import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

export const GET = withAdmin(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
    const limit  = Math.min(100, parseInt(searchParams.get('limit') ?? '20'));
    const search = searchParams.get('q') ?? '';
    const status = searchParams.get('status') ?? '';
    const from   = searchParams.get('from');
    const to     = searchParams.get('to');

    const where: any = {};

    if (status) where.bookingStatus = status;
    if (from || to) {
      where.departureDate = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to   ? { lte: new Date(to) }   : {}),
      };
    }

    if (search) {
      // Resolve any matching PNR codes first
      const matchingPnrs = await prisma.bookingPnr.findMany({
        where: { pnrCode: { contains: search, mode: 'insensitive' } },
        select: { bookingId: true },
      });
      const refBookingIds = [...new Set(matchingPnrs.map(r => r.bookingId))];

      where.OR = [
        { masterPnr: { contains: search, mode: 'insensitive' } },
        { masterBookingReference: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { originAirport: { contains: search.toUpperCase() } },
        { destinationAirport: { contains: search.toUpperCase() } },
        ...(refBookingIds.length > 0 ? [{ id: { in: refBookingIds } }] : []),
      ];
    }

    const [masterBookings, total] = await Promise.all([
      prisma.masterBooking.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user:       { select: { firstName: true, lastName: true, email: true } },
          passengers: { select: { id: true, passengerType: true }, orderBy: { passengerOrder: 'asc' } },
          payments:   { take: 1, orderBy: { createdAt: 'desc' }, select: { status: true, amount: true, currency: true } },
          journeys:   { where: { direction: 'OUTBOUND' }, take: 1, select: { cabinSummary: true } },
          pnrs:       { orderBy: { createdAt: 'asc' }, select: { id: true, pnrCode: true, journeyDirection: true, isPrimary: true, pnrType: true } },
        },
      }),
      prisma.masterBooking.count({ where }),
    ]);

    // Normalize to match BookingRow shape expected by the list page
    const bookings = masterBookings.map(mb => {
      const nameParts = mb.customerName.split(' ');
      const firstName = nameParts[0] ?? '';
      const lastName  = nameParts.slice(1).join(' ') || '';
      const cabin = (mb.journeys[0]?.cabinSummary ?? 'economy').toUpperCase();

      return {
        id:                     mb.id,
        pnr:                    mb.masterPnr ?? mb.masterBookingReference,
        masterBookingReference: mb.masterBookingReference,
        pnrStrategy:            mb.pnrStrategy ?? null,
        isSplitTicket:          mb.isSplitTicket,
        pnrCount:               mb.pnrCount,
        pnrs:                   mb.pnrs.map(p => ({ id: p.id, pnrCode: p.pnrCode, journeyDirection: p.journeyDirection, isPrimary: p.isPrimary, pnrType: p.pnrType })),
        status:                 mb.bookingStatus,
        originAirport:          mb.originAirport,
        destinationAirport:     mb.destinationAirport,
        departureTime:          mb.departureDate,
        totalPrice:             Number(mb.totalAmount),
        currency:               mb.currency,
        cabinClass:             cabin,
        createdAt:              mb.createdAt,
        user: mb.user
          ? { firstName: mb.user.firstName, lastName: mb.user.lastName, email: mb.user.email }
          : { firstName, lastName, email: mb.customerEmail },
        passengers: mb.passengers.map(p => ({ id: p.id, type: p.passengerType.toUpperCase() })),
        payments:   mb.payments.map(p => ({ status: p.status, amount: Number(p.amount) })),
      };
    });

    return NextResponse.json({ bookings, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err: any) {
    console.error('[admin/bookings] GET error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'READ_ONLY');
