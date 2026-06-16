/**
 * Mystifly Client — Proxy to Backend
 *
 * The full Mystifly API client (auth, session management, etc.) lives in the
 * backend server. This module proxies search requests through the backend's
 * /api/search endpoint with a provider filter.
 *
 * This keeps Mystifly credentials and session management centralized in the
 * backend, while allowing the frontend orchestrator to fetch Mystifly results.
 */

import type { RoundTripOption } from '@/lib/round-trip-types';
import { normalizeMystiflyRoundTripOffer } from './mystifly-round-trip-normalizer';

/**
 * Search Mystifly for round-trip flights via the backend proxy.
 *
 * The backend calls Mystifly's AirLowFareSearch with AirTripType='Return',
 * which returns PricedItineraries with 2 OriginDestinationOptions.
 */
export async function searchMystiflyRoundTrip(params: {
  origin: string;
  destination: string;
  date: string;
  returnDate: string;
  adults: number;
  children?: number;
  infants?: number;
  cabin?: string;
}): Promise<{
  options: RoundTripOption[];
  responseTimeMs: number;
  error?: string;
}> {
  const start = Date.now();

  let backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  backendUrl = backendUrl.replace(/\/$/, '');

  const searchParams = new URLSearchParams({
    origin: params.origin,
    destination: params.destination,
    date: params.date,
    returnDate: params.returnDate,
    adults: String(params.adults),
    cabin: params.cabin || 'economy',
    providers: 'mystifly', // Only fetch Mystifly results
  });
  if (params.children) searchParams.set('children', String(params.children));
  if (params.infants) searchParams.set('infants', String(params.infants));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000); // 60s timeout

    const res = await fetch(`${backendUrl}/api/search?${searchParams}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const msg = `Backend returned ${res.status}`;
      console.warn(`[Mystifly RT] ${msg}`);
      return { options: [], responseTimeMs: Date.now() - start, error: msg };
    }

    const data = await res.json();

    // The backend returns normalized UnifiedFlight objects.
    // For round-trip, we need to check if the backend returned raw Mystifly
    // itineraries or already-normalized flights. The backend orchestrator
    // returns `flights[]` (UnifiedFlight) — these are one-way-normalized.
    //
    // For proper round-trip support, we need the raw PricedItineraries.
    // Since the backend normalizer converts to UnifiedFlight (one-way shape),
    // we convert those back into RoundTripOption format.
    const flights = data.flights || [];

    // Check if the backend provides raw Mystifly itineraries
    // (via a dedicated round-trip endpoint or raw data field)
    const rawItineraries = data.rawItineraries || data.mystiflyRaw || null;

    let options: RoundTripOption[];

    if (rawItineraries && Array.isArray(rawItineraries)) {
      // Best case: backend provides raw PricedItineraries for round-trip normalization
      options = rawItineraries
        .map((itin: any) => {
          try { return normalizeMystiflyRoundTripOffer(itin); }
          catch (e) { console.warn('[Mystifly RT] normalize failed:', (e as Error).message); return null; }
        })
        .filter((o): o is RoundTripOption => o !== null);
    } else {
      // Fallback: convert UnifiedFlight[] back to RoundTripOption-like structure
      // This is lossy but functional — pairs outbound+return segments
      options = convertUnifiedToRoundTrip(flights);
    }

    console.log(`[Mystifly RT] ${params.origin}⇄${params.destination}: ${options.length} round-trip options in ${Date.now() - start}ms`);

    // ── Diagnostic: dump first itinerary's airline data ──
    if (rawItineraries && rawItineraries.length > 0) {
      const first = rawItineraries[0];
      const segs = first.OriginDestinationOptions?.[0]?.FlightSegments || [];
      console.log(`[Mystifly RT DEBUG] ValidatingAirlineCode: "${first.ValidatingAirlineCode}"`);
      segs.forEach((s: any, i: number) => {
        console.log(`[Mystifly RT DEBUG]   Seg ${i}: MarketingAirlineCode="${s.MarketingAirlineCode}" FlightNumber="${s.FlightNumber}"`);
      });
    }
    if (options.length > 0) {
      const first = options[0];
      console.log(`[Mystifly RT DEBUG] First option airlines: ${JSON.stringify(first.airlines)}, codes: ${JSON.stringify(first.airlineCodes)}, provider: ${first.provider}`);
    }

    return { options, responseTimeMs: Date.now() - start };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.warn('[Mystifly RT] Search failed:', msg);
    return { options: [], responseTimeMs: Date.now() - start, error: msg };
  }
}

// ── Fallback: Convert UnifiedFlight[] to RoundTripOption[] ──

import type { UnifiedFlight, FlightSegment } from '@/lib/types';
import { generateId } from '@/lib/utils';

/**
 * When the backend returns already-normalized UnifiedFlight objects from Mystifly,
 * we group them by their 2-slice structure to create RoundTripOptions.
 *
 * Mystifly round-trip offers have segments split across 2 OriginDestinationOptions.
 * The backend normalizer flattens these into a single segments array. We split them
 * back based on the route turning point.
 */
function convertUnifiedToRoundTrip(flights: UnifiedFlight[]): RoundTripOption[] {
  const options: RoundTripOption[] = [];

  for (const f of flights) {
    if (!f.segments || f.segments.length < 2) continue;

    // Find the turning point: the segment where arrival city matches origin
    // For DFW→LHR round-trip, the turning point is where arrival=DFW (return starts)
    const origin = f.segments[0].departure.airport;
    let splitIdx = -1;
    for (let i = 1; i < f.segments.length; i++) {
      // When arrival matches origin for any segment before the last, that's likely the boundary
      // Or more reliably: when a departure airport matches the destination
      if (f.segments[i].departure.airport === f.segments[0].arrival.airport ||
          f.segments[i - 1].arrival.airport === f.segments[f.segments.length - 1].arrival.airport) {
        // Check if this segment starts the return leg
        const prevArr = f.segments[i - 1].arrival.airport;
        const currDep = f.segments[i].departure.airport;
        if (prevArr !== currDep || currDep === f.segments[f.segments.length - 1].arrival.airport) {
          splitIdx = i;
          break;
        }
      }
    }

    // Heuristic: if segments count is even, split in half
    if (splitIdx === -1) {
      splitIdx = Math.ceil(f.segments.length / 2);
    }

    const outSegs = f.segments.slice(0, splitIdx);
    const retSegs = f.segments.slice(splitIdx);

    if (outSegs.length === 0 || retSegs.length === 0) continue;

    const outbound = segsToJourney(outSegs, 'outbound');
    const ret = segsToJourney(retSegs, 'return');

    const allCodes = [...new Set([...outbound.airlineCodes, ...ret.airlineCodes])];
    const allNames = [...new Set([...outbound.airlineNames, ...ret.airlineNames])];

    options.push({
      id: generateId(),
      providerOfferId: f.providerOfferId,
      provider: 'mystifly',
      outboundJourney: outbound,
      returnJourney: ret,
      totalPrice: f.totalPrice,
      currency: f.currency,
      totalDurationMinutes: outbound.durationMinutes + ret.durationMinutes,
      totalStops: outbound.stops + ret.stops,
      maxStopsOneWay: Math.max(outbound.stops, ret.stops),
      airlines: allNames,
      airlineCodes: allCodes,
      bookingProvider: f.airline.name,
      cabinClass: f.cabinClass,
      fareRules: f.fareRules,
      baggage: f.baggage,
    });
  }

  return options;
}

function segsToJourney(segments: FlightSegment[], direction: 'outbound' | 'return'): import('@/lib/round-trip-types').JourneySegment {
  let durationMinutes = 0;
  if (segments.length > 0) {
    const dep = new Date(segments[0].departure.time).getTime();
    const arr = new Date(segments[segments.length - 1].arrival.time).getTime();
    if (arr > dep) durationMinutes = Math.round((arr - dep) / 60000);
  }
  if (durationMinutes === 0) {
    durationMinutes = segments.reduce((sum, s) => sum + s.duration, 0);
  }

  const layovers = segments.slice(0, -1).map((seg, i) => ({
    airport: seg.arrival.airport,
    airportName: seg.arrival.airportName,
    durationMinutes: Math.max(0, Math.round(
      (new Date(segments[i + 1].departure.time).getTime() - new Date(seg.arrival.time).getTime()) / 60000
    )),
    terminalChange: seg.arrival.terminal !== segments[i + 1].departure.terminal,
  }));

  return {
    direction,
    departureAirport: segments[0]?.departure.airport ?? '',
    arrivalAirport: segments[segments.length - 1]?.arrival.airport ?? '',
    departureTime: segments[0]?.departure.time ?? '',
    arrivalTime: segments[segments.length - 1]?.arrival.time ?? '',
    durationMinutes,
    stops: Math.max(0, segments.length - 1),
    stopAirports: segments.slice(0, -1).map(s => s.arrival.airport),
    airlineCodes: [...new Set(segments.map(s => s.airline.code))],
    airlineNames: [...new Set(segments.map(s => s.airline.name))],
    flightNumbers: segments.map(s => s.flightNumber),
    layovers,
    segments,
  };
}
