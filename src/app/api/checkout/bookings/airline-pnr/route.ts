/**
 * POST /api/checkout/bookings/airline-pnr
 *
 * Resolve a booking's AIRLINE record locator, fetching it from the provider if
 * we do not hold it yet.
 *
 * The confirmation screen renders the checkout store's snapshot and never
 * refetches, so a locator the airline publishes moments after we book would
 * never reach the customer — the screen would say "Not Available" for the life
 * of the booking. This endpoint closes that window.
 *
 * Guarded by booking reference + passenger last name, matching the guest
 * manage-booking lookup — a reference alone must not reveal a locator.
 */
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { resolveAirlinePnr } from '@/lib/airline-pnr-resolve';

export async function POST(request: NextRequest) {
  try {
    const { bookingRef, lastName } = await request.json();
    const ref = String(bookingRef ?? '').trim();
    const surname = String(lastName ?? '').trim();
    if (!ref || !surname) {
      return NextResponse.json({ error: 'bookingRef and lastName are required' }, { status: 400 });
    }

    const booking = await prisma.masterBooking.findFirst({
      where: { masterBookingReference: { equals: ref, mode: 'insensitive' } },
      select: { id: true, passengers: { select: { lastName: true } } },
    });

    // Same 404 for "no such booking" and "name does not match", so the endpoint
    // cannot be used to test whether a reference exists.
    const nameMatches = booking?.passengers.some(
      (p) => (p.lastName ?? '').trim().toLowerCase() === surname.toLowerCase(),
    );
    if (!booking || !nameMatches) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    // Single attempt: the browser is polling, so retrying inside the request
    // would just hold a connection open for no benefit.
    const { airlinePnr, source } = await resolveAirlinePnr(booking.id);
    return NextResponse.json({ airlinePnr, source });
  } catch (err: any) {
    console.error('[airline-pnr] lookup failed:', err?.message ?? err);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
