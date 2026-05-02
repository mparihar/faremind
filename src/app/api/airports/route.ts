import { NextRequest, NextResponse } from 'next/server';
import { searchAirports } from '@/lib/db-queries';

/**
 * GET /api/airports?q=new+york
 *
 * Search airports from the database by IATA code, city, or name.
 * Falls back to returning popular airports if no query.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q') || '';
  const limit = parseInt(searchParams.get('limit') || '10');

  if (!query || query.length < 1) {
    return NextResponse.json({ airports: [] });
  }

  try {
    const airports = await searchAirports(query, Math.min(limit, 25));

    return NextResponse.json({
      airports: airports.map((a) => ({
        code: a.iataCode,
        name: a.name,
        city: a.city,
        country: a.country,
        countryCode: a.countryCode,
      })),
    });
  } catch (error) {
    console.error('Airport search failed:', error);
    return NextResponse.json(
      { error: 'Failed to search airports' },
      { status: 500 }
    );
  }
}
