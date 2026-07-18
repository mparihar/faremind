import { NextRequest, NextResponse } from 'next/server';
import { searchRoundTripFlights } from '@/lib/providers/orchestrator';
import { flexCacheKey, flexCacheGet, flexCacheSet } from '@/lib/flex-search-cache';

function isFutureDate(dateStr: string): boolean {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return new Date(dateStr + 'T00:00:00Z') > today;
}

function pickCheapest(options: any[], cabin: string): any | null {
  const cabinSet = new Set(cabin.split(',').map(c => c.trim()).filter(Boolean));
  const cabinMatches = options.filter(o => cabinSet.has(o.cabinClass));
  // Strictly match cabin — never fall back to a different cabin's price
  const pool = cabinMatches.length > 0 ? cabinMatches : null;
  if (!pool) return null;
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
  const children    = parseInt(searchParams.get('children') || '0');
  const infants     = parseInt(searchParams.get('infants') || '0');
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
    if (!cheapest) {
      return NextResponse.json({ dep, ret, minPrice: null, currency: 'USD', offerId: null, airline: null });
    }
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
      origin, destination, date: dep, returnDate: ret, adults, children, infants, cabin,
    });
    const allOptions = res.options;

    // Cache for future re-use
    if (allOptions.length > 0) {
      flexCacheSet(cKey, allOptions);
    }

    const cheapest = pickCheapest(allOptions, cabin);
    if (!cheapest) {
      return NextResponse.json({ dep, ret, minPrice: null, currency: 'USD', offerId: null, airline: null });
    }

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

