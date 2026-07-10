import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Agent Booking Workspace — Lookup API
 *
 * Searches bookings by:
 *   - Master booking reference (FM-xxxx)
 *   - PNR code
 *   - MFRef (Mystifly unique ID)
 *   - Booking ID (UUID/CUID)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim();

  if (!q) {
    return NextResponse.json({ error: 'Missing search query' }, { status: 400 });
  }

  const includeRelations = {
    passengers: true,
    pnrs: true,
    payments: { take: 5, orderBy: { createdAt: 'desc' as const } },
    cancellations: true,
    notes: { take: 10, orderBy: { createdAt: 'desc' as const } },
  };

  try {
    let booking = null;

    // 1. By master booking reference
    booking = await prisma.masterBooking.findFirst({
      where: { masterBookingReference: { equals: q, mode: 'insensitive' } },
      include: includeRelations,
    });

    // 2. By PNR code
    if (!booking) {
      const pnr = await prisma.bookingPnr.findFirst({
        where: { pnrCode: { equals: q, mode: 'insensitive' } },
        select: { bookingId: true },
      });
      if (pnr) {
        booking = await prisma.masterBooking.findUnique({
          where: { id: pnr.bookingId },
          include: includeRelations,
        });
      }
    }

    // 3. By Mystifly MFRef
    if (!booking) {
      booking = await prisma.masterBooking.findFirst({
        where: { mystiflyMfRef: q },
        include: includeRelations,
      });
    }

    // 4. By booking ID (CUID/UUID)
    if (!booking && q.length > 15) {
      booking = await prisma.masterBooking.findUnique({
        where: { id: q },
        include: includeRelations,
      });
    }

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // Normalize for frontend
    const normalized = {
      ...booking,
      bookingReference: booking.masterBookingReference,
      status: booking.bookingStatus,
      totalAmount: Number(booking.totalAmount),
    };

    return NextResponse.json({ booking: normalized });
  } catch (error) {
    console.error('[Agent Workspace] Lookup error:', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
