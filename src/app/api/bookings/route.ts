import { NextRequest, NextResponse } from 'next/server';
import {
  getBookingsByUserId,
  getDashboardStats,
  getPriceAlerts,
} from '@/lib/db-queries';

/**
 * GET /api/bookings?userId=xxx&status=CONFIRMED
 *
 * Retrieves user bookings with passengers, segments, price history, and alerts.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const status = searchParams.get('status') as 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | undefined;

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  try {
    const [bookings, stats, alerts] = await Promise.all([
      getBookingsByUserId(userId, status || undefined),
      getDashboardStats(userId),
      getPriceAlerts(userId, 'NEW'),
    ]);

    return NextResponse.json({
      bookings,
      stats,
      alerts,
    });
  } catch (error) {
    console.error('Failed to fetch bookings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch bookings' },
      { status: 500 }
    );
  }
}
