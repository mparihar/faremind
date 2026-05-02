import { NextRequest, NextResponse } from 'next/server';
import { getBookingById } from '@/lib/db-queries';

/**
 * GET /api/bookings/[id]
 *
 * Get detailed booking info including passengers, segments,
 * price history, alerts, payments, and rebooking records.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: 'Booking ID required' }, { status: 400 });
  }

  try {
    const booking = await getBookingById(id);

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    return NextResponse.json({ booking });
  } catch (error) {
    console.error('[Booking Detail] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch booking' },
      { status: 500 }
    );
  }
}
