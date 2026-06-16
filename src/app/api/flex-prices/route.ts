import { NextRequest, NextResponse } from 'next/server';
import { searchRoundTripFlights } from '@/lib/providers/orchestrator';
import { applyMarkupToRoundTripOptions } from '@/lib/services/markup-service';
import { flexCacheKey, flexCacheGet, flexCacheSet } from '@/lib/flex-search-cache';

function isFutureDate(dateStr: string): boolean {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return new Date(dateStr + 'T00:00:00Z') > today;
}

function pickCheapest(options: any[], cabin: string) {
  const cabinSet = new Set(cabin.split(',').map(c => c.trim()).filter(Boolean));
  const cabinMatches = options.filter(o => cabinSet.has(o.cabinClass));
  const pool = cabinMatches.length > 0 ? cabinMatches : options;
  return pool.reduce((min, o) => o.totalPrice < min.totalPrice ? o : min);
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
    return NextResponse.json({ dep, ret, minPrice: null, currency: 'USD', offerId: null, airline: null });
  }

  // ── Check in-memory cache first (shared with /api/search) ──────────────
  const cKey = flexCacheKey(origin, destination, dep, ret, adults, cabin);
  const cached = flexCacheGet(cKey);
  if (cached && cached.length > 0) {
    const cheapest = pickCheapest(cached, cabin);
    return NextResponse.json({
      dep, ret,
      minPrice: cheapest.totalPrice,
      currency: cheapest.currency,
      offerId: cheapest.providerOfferId,
      airline: cheapest.airlineCodes[0] ?? null,
    });
  }

  try {
    const res = await searchRoundTripFlights({
      origin, destination, date: dep, returnDate: ret, adults, cabin,
    });
    const allOptions = res.options;

    // Apply FareMind markup so tile prices match what /api/search shows
    await applyMarkupToRoundTripOptions(allOptions);

    // Cache for future re-use (e.g. user clicks tile → search reuses)
    if (allOptions.length > 0) {
      flexCacheSet(cKey, allOptions);
    }

    if (allOptions.length === 0) {
      return NextResponse.json({ dep, ret, minPrice: null, currency: 'USD', offerId: null, airline: null });
    }

    const cheapest = pickCheapest(allOptions, cabin);

    return NextResponse.json({
      dep, ret,
      minPrice: cheapest.totalPrice,
      currency: cheapest.currency,
      offerId: cheapest.providerOfferId,
      airline: cheapest.airlineCodes[0] ?? null,
    });
  } catch (err) {
    return NextResponse.json({ dep, ret, minPrice: null, currency: 'USD', offerId: null, airline: null });
  }
}

