// FILE: src/app/api/agent/bookings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAgentServicing } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';

export const GET = withAgentServicing(async (req: NextRequest, { agent }) => {
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
  const search = url.searchParams.get('search')?.trim() || '';
  const status = url.searchParams.get('status')?.trim() || '';
  // 'asc' | 'desc'; anything else is newest first.
  const sortOrder: 'asc' | 'desc' =
    (url.searchParams.get('order') ?? '').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const skip = (page - 1) * limit;

  // Show bookings where the user is the agent OR the customer (self-bookings)
  const ownershipFilter: any = {
    OR: [
      { agentUserId: agent.id },
      { userId: agent.id },
    ],
  };

  // Exclude over-limit bookings — those are de-attributed from the agent and
  // visible to Admin/Support only.
  const where: any = { ...ownershipFilter, walletOverLimit: false };

  if (search) {
    where.AND = [
      {
        OR: [
          { masterBookingReference: { contains: search, mode: 'insensitive' } },
          // The AIRLINE's locator — what a customer quotes on the phone.
          { airlinePnr: { contains: search, mode: 'insensitive' } },
          // Mystifly's reference, for agents pasting from provider tooling.
          { masterPnr: { contains: search, mode: 'insensitive' } },
          { mystiflyMfRef: { contains: search, mode: 'insensitive' } },
          { customerName: { contains: search, mode: 'insensitive' } },
          { customerEmail: { contains: search, mode: 'insensitive' } },
        ],
      },
    ];
  }

  if (status) {
    where.bookingStatus = status;
  }

  const [total, bookings] = await Promise.all([
    prisma.masterBooking.count({ where }),
    prisma.masterBooking.findMany({
      where,
      select: {
        id: true,
        masterBookingReference: true,
        masterPnr: true,
        // The two locators, kept apart: the airline's is what a passenger quotes,
        // mystiflyMfRef is ours and internal.
        airlinePnr: true,
        mystiflyMfRef: true,
        customerName: true,
        customerEmail: true,
        originAirport: true,
        originCity: true,
        destinationAirport: true,
        destinationCity: true,
        departureDate: true,
        returnDate: true,
        tripType: true,
        bookingStatus: true,
        paymentStatus: true,
        ticketingStatus: true,
        totalAmount: true,
        currency: true,
        primaryProvider: true,
        createdAt: true,
        pnrs: {
          select: { pnrCode: true, pnrType: true, isPrimary: true, airlineCode: true, airlinePnr: true },
          orderBy: { isPrimary: 'desc' },
          take: 3,
        },
      },
      // Booking date, newest first by default, direction from ?order=.
      // Ties break on id so paging cannot repeat or skip a row.
      orderBy: [{ createdAt: sortOrder }, { id: sortOrder }],
      skip,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    bookings: bookings.map((b) => ({ ...b, totalAmount: Number(b.totalAmount) })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});
