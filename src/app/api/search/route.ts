import { NextRequest, NextResponse } from 'next/server';
import { searchFlights, searchRoundTripFlights, getProviderStatus } from '@/lib/providers/orchestrator';
import { logSearch } from '@/lib/db-queries';
import { rankFlights } from '@/lib/flight/score';
import { rankRoundTripOptions } from '@/lib/flight/round-trip-score';
import type { RoundTripUserPrefs } from '@/lib/round-trip-types';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const origin = searchParams.get('origin')?.toUpperCase();
  const destination = searchParams.get('destination')?.toUpperCase();
  const date = searchParams.get('date');
  const returnDate = searchParams.get('returnDate') || undefined;
  const adults = parseInt(searchParams.get('adults') || '1');
  const children = parseInt(searchParams.get('children') || '0');
  const infants = parseInt(searchParams.get('infants') || '0');
  const cabin = searchParams.get('cabin') || 'economy';
  const trip = searchParams.get('trip') || 'one_way';

  if (!origin || !destination || !date) {
    return NextResponse.json({ error: 'Missing required parameters: origin, destination, date' }, { status: 400 });
  }
  if (origin.length !== 3 || destination.length !== 3) {
    return NextResponse.json({ error: 'origin and destination must be 3-letter IATA codes' }, { status: 400 });
  }
  if (origin === destination) {
    return NextResponse.json({ error: 'origin and destination must be different' }, { status: 400 });
  }

  try {
    // ── Round-trip path ──────────────────────────────────────────────────────
    if (trip === 'round_trip' && returnDate) {
      const rtResult = await searchRoundTripFlights({
        origin: origin!, destination: destination!,
        date: date!, returnDate, adults, children, infants, cabin,
      });
      const prefs: RoundTripUserPrefs = {
        stops:           (searchParams.get('stops') as RoundTripUserPrefs['stops']) || undefined,
        departureWindow: (searchParams.get('departure_window') as RoundTripUserPrefs['departureWindow']) || undefined,
      };
      const ranked = rankRoundTripOptions(rtResult.options, prefs);
      logSearch({
        origin: origin!, destination: destination!,
        departureDate: new Date(date!), returnDate: new Date(returnDate),
        adults, children, infants, cabinClass: cabin.toUpperCase() as any,
        tripType: 'ROUND_TRIP', resultsCount: ranked.length,
        lowestPrice: ranked[0]?.totalPrice, currency: ranked[0]?.currency ?? 'USD',
        searchDurationMs: rtResult.totalTimeMs,
      }).catch((e) => console.warn('[RT Search] log failed:', e.message));
      const providerStatus = getProviderStatus();
      return NextResponse.json({
        roundTripOptions: ranked,
        meta: {
          totalResults: ranked.length, searchId: rtResult.searchId,
          totalTimeMs: rtResult.totalTimeMs, usedMockData: rtResult.usedMockData,
          providers: rtResult.providers.map((p) => ({
            provider: p.provider, count: rtResult.options.length,
            responseTimeMs: p.responseTimeMs, error: p.error || null, isMock: p.isMock,
          })),
          providerStatus: {
            duffel: providerStatus.duffel.configured ? 'connected' : 'not_configured',
            amadeus: providerStatus.amadeus.configured ? 'connected' : 'not_configured',
          },
        },
      });
    }

    // ── One-way: single search with NO cabin_class filter ─────────────────────
    // Duffel returns all available cabin classes when cabin_class is omitted.
    // We pass cabin=undefined so the orchestrator omits it from the Duffel body.
    const result = await searchFlights({
      origin: origin!, destination: destination!,
      date: date!, returnDate, adults, children, infants,
      cabin: undefined,
    });

    // Log what cabin classes actually came back
    const cabinBreakdown: Record<string, number> = {};
    result.flights.forEach(f => {
      cabinBreakdown[f.cabinClass] = (cabinBreakdown[f.cabinClass] || 0) + 1;
    });
    console.log(`[Search] ${origin}→${destination} | ${result.flights.length} flights | cabins:`, cabinBreakdown);

    const lowestPrice = result.flights.length > 0
      ? Math.min(...result.flights.map(f => f.totalPrice))
      : undefined;

    logSearch({
      origin: origin!, destination: destination!,
      departureDate: new Date(date!),
      returnDate: returnDate ? new Date(returnDate) : undefined,
      adults, children, infants, cabinClass: cabin.toUpperCase() as any,
      tripType: 'ONE_WAY', resultsCount: result.flights.length,
      lowestPrice, currency: 'USD', searchDurationMs: result.totalTimeMs,
    }).catch((err) => console.warn('[Search] Failed to log search:', err.message));

    const rankedFlights = rankFlights(result.flights);

    // Build class counts for the filter panel
    const classCounts: Record<string, { count: number; minPrice: number }> = {};
    for (const f of rankedFlights) {
      const c = f.cabinClass;
      if (!classCounts[c]) classCounts[c] = { count: 0, minPrice: Infinity };
      classCounts[c].count++;
      if (f.totalPrice < classCounts[c].minPrice) classCounts[c].minPrice = f.totalPrice;
    }

    const providerStatus = getProviderStatus();
    return NextResponse.json({
      flights: rankedFlights,
      meta: {
        totalResults: rankedFlights.length, searchId: result.searchId,
        totalTimeMs: result.totalTimeMs, usedMockData: result.usedMockData,
        providers: result.providers.map((p) => ({
          provider: p.provider, count: p.flights.length,
          responseTimeMs: p.responseTimeMs, error: p.error || null, isMock: p.isMock,
        })),
        providerStatus: {
          duffel: providerStatus.duffel.configured ? 'connected' : 'not_configured',
          amadeus: providerStatus.amadeus.configured ? 'connected' : 'not_configured',
        },
        filters: { classes: classCounts },
      },
    });
  } catch (error) {
    console.error('[Search] Critical error:', error);
    return NextResponse.json({ error: 'Search failed. Please try again.' }, { status: 500 });
  }
}
