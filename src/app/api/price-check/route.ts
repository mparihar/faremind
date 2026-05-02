import { NextRequest, NextResponse } from 'next/server';
import { getPriceHistory, addPriceHistoryEntry } from '@/lib/db-queries';

/**
 * GET /api/price-check?bookingId=xxx
 *
 * Get price history for a booking.
 * In production, this would also trigger a fresh price check
 * against Duffel/Amadeus APIs.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const bookingId = searchParams.get('bookingId');

  if (!bookingId) {
    return NextResponse.json(
      { error: 'bookingId is required' },
      { status: 400 }
    );
  }

  try {
    const history = await getPriceHistory(bookingId);

    return NextResponse.json({
      bookingId,
      history: history.map((h) => ({
        price: Number(h.price),
        currency: h.currency,
        provider: h.provider,
        checkedAt: h.checkedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Failed to fetch price history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch price history' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/price-check
 *
 * Record a new price check (called by the price monitoring cron).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { bookingId, price, currency, provider } = body;

    if (!bookingId || !price || !provider) {
      return NextResponse.json(
        { error: 'bookingId, price, and provider are required' },
        { status: 400 }
      );
    }

    const entry = await addPriceHistoryEntry(
      bookingId,
      price,
      currency || 'USD',
      provider
    );

    return NextResponse.json({ entry, success: true });
  } catch (error) {
    console.error('Failed to add price entry:', error);
    return NextResponse.json(
      { error: 'Failed to add price check entry' },
      { status: 500 }
    );
  }
}
