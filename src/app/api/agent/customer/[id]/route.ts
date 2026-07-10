import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Agent Customer API — returns customer profile + booking history
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const customer = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        createdAt: true,
        role: true,
      },
    });

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const bookings = await prisma.masterBooking.findMany({
      where: { userId: id },
      select: {
        id: true,
        masterBookingReference: true,
        bookingStatus: true,
        ticketingStatus: true,
        primaryProvider: true,
        totalAmount: true,
        currency: true,
        createdAt: true,
        originAirport: true,
        destinationAirport: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Normalize for frontend
    const normalized = {
      customer: {
        ...customer,
        name: `${customer.firstName} ${customer.lastName}`,
      },
      bookings: bookings.map(b => ({
        id: b.id,
        bookingReference: b.masterBookingReference,
        status: b.bookingStatus,
        ticketingStatus: b.ticketingStatus,
        primaryProvider: b.primaryProvider,
        totalAmount: Number(b.totalAmount),
        currency: b.currency,
        createdAt: b.createdAt.toISOString(),
        pnrs: [{ originIata: b.originAirport, destinationIata: b.destinationAirport }],
      })),
    };

    return NextResponse.json(normalized);
  } catch (error) {
    console.error('[Agent Customer] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch customer' }, { status: 500 });
  }
}
