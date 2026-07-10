import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Agent Ticket Queue API — returns bookings with pending ticketing
 */
export async function GET(request: NextRequest) {
  try {
    const tickets = await prisma.masterBooking.findMany({
      where: {
        OR: [
          { ticketingStatus: 'TICKETING_PENDING' },
          { ticketingStatus: 'IN_PROGRESS' },
          { bookingStatus: 'CONFIRMED', ticketingStatus: { notIn: ['ISSUED', 'VOIDED', 'FAILED'] } },
        ],
      },
      include: {
        passengers: {
          select: { firstName: true, lastName: true },
          take: 5,
        },
        pnrs: {
          select: { pnrCode: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Normalize for frontend
    const normalized = tickets.map(t => ({
      id: t.id,
      bookingReference: t.masterBookingReference,
      mystiflyMfRef: t.mystiflyMfRef,
      status: t.bookingStatus,
      ticketingStatus: t.ticketingStatus,
      primaryProvider: t.primaryProvider,
      totalAmount: Number(t.totalAmount),
      currency: t.currency,
      createdAt: t.createdAt.toISOString(),
      passengers: t.passengers,
      pnrs: t.pnrs.map((p: any) => ({ providerPnr: p.pnrCode })),
    }));

    return NextResponse.json({ tickets: normalized });
  } catch (error) {
    console.error('[Agent Ticket Queue] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch ticket queue' }, { status: 500 });
  }
}
