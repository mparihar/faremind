// FILE: src/app/api/agent/bookings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAgent } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';

export const GET = withAgent(async (req: NextRequest, { agent }) => {
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
  const search = url.searchParams.get('search')?.trim() || '';
  const status = url.searchParams.get('status')?.trim() || '';
  const skip = (page - 1) * limit;

  const where: any = { agentUserId: agent.id };

  if (search) {
    where.OR = [
      { masterBookingReference: { contains: search, mode: 'insensitive' } },
      { masterPnr: { contains: search, mode: 'insensitive' } },
      { customerName: { contains: search, mode: 'insensitive' } },
      { customerEmail: { contains: search, mode: 'insensitive' } },
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
        totalAmount: true,
        currency: true,
        primaryProvider: true,
        createdAt: true,
        pnrs: {
          select: { pnrCode: true, pnrType: true, isPrimary: true, airlineCode: true },
          orderBy: { isPrimary: 'desc' },
          take: 3,
        },
      },
      orderBy: { createdAt: 'desc' },
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
