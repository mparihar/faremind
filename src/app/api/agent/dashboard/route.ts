// FILE: src/app/api/agent/dashboard/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAgent } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';

export const GET = withAgent(async (_req: NextRequest, { agent }) => {
  const now = new Date();

  // All counts in parallel
  const [
    totalBookings,
    upcomingTrips,
    pendingUpdates,
    cancellationRequests,
    failedBookings,
    recentBookings,
  ] = await Promise.all([
    // Total bookings by this agent (including self-bookings)
    prisma.masterBooking.count({ where: { OR: [{ agentUserId: agent.id }, { userId: agent.id }] } }),

    // Upcoming trips (departure in the future)
    prisma.masterBooking.count({
      where: {
        OR: [{ agentUserId: agent.id }, { userId: agent.id }],
        departureDate: { gte: now },
        bookingStatus: { in: ['CONFIRMED', 'TICKETED', 'CREATED'] },
      },
    }),

    // Pending passenger updates (no dedicated model yet — use 0)
    0,

    // Cancelled bookings
    prisma.masterBooking.count({
      where: {
        OR: [{ agentUserId: agent.id }, { userId: agent.id }],
        bookingStatus: 'CANCELLED',
      },
    }).catch(() => 0),

    // Failed bookings
    prisma.masterBooking.count({
      where: {
        OR: [{ agentUserId: agent.id }, { userId: agent.id }],
        bookingStatus: 'FAILED',
      },
    }).catch(() => 0),

    // Recent bookings (last 10)
    prisma.masterBooking.findMany({
      where: { OR: [{ agentUserId: agent.id }, { userId: agent.id }] },
      select: {
        id: true,
        masterBookingReference: true,
        masterPnr: true,
        customerName: true,
        customerEmail: true,
        originAirport: true,
        destinationAirport: true,
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
          select: { pnrCode: true, pnrType: true, isPrimary: true },
          orderBy: { isPrimary: 'desc' },
          take: 2,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  return NextResponse.json({
    stats: {
      totalBookings,
      upcomingTrips,
      pendingUpdates,
      cancellationRequests,
      failedBookings,
    },
    recentBookings: recentBookings.map((b) => ({
      ...b,
      totalAmount: Number(b.totalAmount),
    })),
    agent: { id: agent.id, name: agent.name, email: agent.email },
  });
});
