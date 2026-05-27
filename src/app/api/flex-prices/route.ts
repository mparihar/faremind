import { NextRequest, NextResponse } from 'next/server';
import { searchRoundTripFlights } from '@/lib/providers/orchestrator';
import { flexCacheKey, flexCacheGet, flexCacheSet } from '@/lib/flex-search-cache';

function isFutureDate(dateStr: string): boolean {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return new Date(dateStr + 'T00:00:00Z') > today;
}

// Single-tile endpoint — frontend calls this once per tile, staggered.
// Accepts: origin, destination, dep (departure date), ret (return date), adults, cabin
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin      = searchParams.get('origin')?.toUpperCase();
  const destination = searchParams.get('destination')?.toUpperCase();
  const dep         = searchParams.get('dep');
  const ret         = searchParams.get('ret');
  const adults      = parseInt(searchParams.get('adults') || '1');
  const cabin       = searchParams.get('cabin') || 'economy';

  if (!origin || !destination || !dep || !ret) {
    return NextResponse.json({ error: 'Missing required params: origin, destination, dep, ret' }, { status: 400 });
  }

  if (!isFutureDate(dep)) {
    // Past/same-day departure — Duffel returns 422, skip immediately
    return NextResponse.json({ dep, ret, minPrice: null, currency: 'USD', offerId: null, airline: null });
  }

  try {
    // Cache key is cabin-agnostic because searchRoundTripFlights now fetches
    // all 4 cabin classes in parallel. This avoids redundant Duffel calls when
    // the same route+dates are requested for different cabins.
    const cacheKey = flexCacheKey(origin, destination, dep, ret, adults);
    const cached = flexCacheGet(cacheKey);

    let allOptions = cached && cached.length > 0 ? cached : null;

    if (!allOptions) {
      const res = await searchRoundTripFlights({
        origin, destination, date: dep, returnDate: ret, adults, cabin,
      });
      allOptions = res.options;
      // Cache the full multi-cabin option set so /api/search can reuse it
      if (allOptions.length > 0) flexCacheSet(cacheKey, allOptions);
    }

    if (allOptions.length === 0) {
      return NextResponse.json({ dep, ret, minPrice: null, currency: 'USD', offerId: null, airline: null });
    }

    // `cabin` can be a single class or comma-separated list (e.g. "premium_economy,business")
    // when the user has multiple classes selected in the filter panel.
    const cabinSet = new Set(cabin.split(',').map(c => c.trim()).filter(Boolean));
    const cabinMatches = allOptions.filter(o => cabinSet.has(o.cabinClass));
    // Fall back to all cabins only if none of the selected classes have options
    const pool = cabinMatches.length > 0 ? cabinMatches : allOptions;
    const cheapest = pool.reduce((min, o) => o.totalPrice < min.totalPrice ? o : min);

    return NextResponse.json({
      dep,
      ret,
      minPrice: cheapest.totalPrice,
      currency: cheapest.currency,
      offerId: cheapest.providerOfferId,
      airline: cheapest.airlineCodes[0] ?? null,
    });
  } catch (err) {
    console.warn(`[flex-prices] ${dep}→${ret} failed:`, (err as Error).message);
    return NextResponse.json({ dep, ret, minPrice: null, currency: 'USD', offerId: null, airline: null });
  }
}
