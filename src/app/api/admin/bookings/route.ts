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
    const paymentStatus   = searchParams.get('paymentStatus') ?? '';
    const ticketingStatus = searchParams.get('ticketingStatus') ?? '';
    const provider        = searchParams.get('provider') ?? '';
    const cabin           = searchParams.get('cabin') ?? '';
    const tripType        = searchParams.get('tripType') ?? '';
    const from   = searchParams.get('from');
    const to     = searchParams.get('to');

    const where: any = {};

    if (status)          where.bookingStatus   = status;
    if (paymentStatus)   where.paymentStatus   = paymentStatus;
    if (ticketingStatus) where.ticketingStatus  = ticketingStatus;
    if (provider)        where.primaryProvider  = { equals: provider, mode: 'insensitive' };
    if (tripType)        where.tripType         = tripType;
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

      // Search by Stripe payment intent ID
      const matchingPayments = await prisma.bookingPayment.findMany({
        where: { stripePaymentIntentId: { contains: search, mode: 'insensitive' } },
        select: { bookingId: true },
      });
      const paymentBookingIds = [...new Set(matchingPayments.map(p => p.bookingId))];

      // Search by provider order ID
      const matchingProviderOrders = await prisma.bookingPnr.findMany({
        where: { providerOrderId: { contains: search, mode: 'insensitive' } },
        select: { bookingId: true },
      });
      const providerOrderBookingIds = [...new Set(matchingProviderOrders.map(p => p.bookingId))];

      const allMatchedIds = [...new Set([...refBookingIds, ...paymentBookingIds, ...providerOrderBookingIds])];

      where.OR = [
        { masterPnr: { contains: search, mode: 'insensitive' } },
        { masterBookingReference: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { originAirport: { contains: search.toUpperCase() } },
        { destinationAirport: { contains: search.toUpperCase() } },
        ...(allMatchedIds.length > 0 ? [{ id: { in: allMatchedIds } }] : []),
      ];
    }

    // Cabin filter: search in journeys
    if (cabin) {
      const matchingJourneys = await prisma.bookingJourney.findMany({
        where: { cabinSummary: { equals: cabin, mode: 'insensitive' } },
        select: { bookingId: true },
      });
      const cabinBookingIds = [...new Set(matchingJourneys.map(j => j.bookingId))];
      if (cabinBookingIds.length > 0) {
        where.id = { ...(where.id ?? {}), in: cabinBookingIds };
      } else {
        // No matching bookings for this cabin — return empty
        return NextResponse.json({ bookings: [], total: 0, page, limit, pages: 0 });
      }
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
          pnrs:       { orderBy: { createdAt: 'asc' }, select: { id: true, pnrCode: true, journeyDirection: true, isPrimary: true, pnrType: true, airlineCode: true, airlineName: true, provider: true } },
          segments:   { take: 1, orderBy: { segmentOrder: 'asc' }, select: { airlineCode: true, airlineName: true } },
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
      const primaryPnr = mb.pnrs.find(p => p.isPrimary) ?? mb.pnrs[0];
      const airlineCode = primaryPnr?.airlineCode ?? mb.segments[0]?.airlineCode ?? null;
      const airlineName = primaryPnr?.airlineName ?? mb.segments[0]?.airlineName ?? null;

      return {
        id:                     mb.id,
        pnr:                    mb.masterPnr ?? mb.masterBookingReference,
        masterBookingReference: mb.masterBookingReference,
        pnrStrategy:            mb.pnrStrategy ?? null,
        isSplitTicket:          mb.isSplitTicket,
        pnrCount:               mb.pnrCount,
        pnrs:                   mb.pnrs.map(p => ({ id: p.id, pnrCode: p.pnrCode, journeyDirection: p.journeyDirection, isPrimary: p.isPrimary, pnrType: p.pnrType, airlineCode: p.airlineCode, airlineName: p.airlineName, provider: p.provider })),
        status:                 mb.bookingStatus,
        paymentStatus:          mb.paymentStatus,
        ticketingStatus:        mb.ticketingStatus,
        provider:               mb.primaryProvider,
        airlineCode,
        airlineName,
        tripType:               mb.tripType,
        originAirport:          mb.originAirport,
        destinationAirport:     mb.destinationAirport,
        departureTime:          mb.departureDate,
        returnDate:             mb.returnDate,
        totalPrice:             Number(mb.totalAmount),
        currency:               mb.currency,
        cabinClass:             cabin,
        customerEmail:          mb.customerEmail,
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
