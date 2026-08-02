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
      options = convertUnifiedToRoundTrip(flights, params.destination);
    }

    // ── Diagnostic: dump first itinerary's airline data ──
    if (rawItineraries && rawItineraries.length > 0) {
      const first = rawItineraries[0];
      const segs = first.OriginDestinationOptions?.[0]?.FlightSegments || [];
      segs.forEach((s: any, i: number) => {
      });
    }
    if (options.length > 0) {
      const first = options[0];
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
/**
 * Where the outbound ends and the return begins, in a flat list of segments.
 *
 * The backend returns round trips as one-way-normalised UnifiedFlights — every
 * segment of both legs in a single array — so the boundary has to be recovered
 * here. The old rule compared airport codes and matched
 * `segments[i].departure === segments[0].arrival`, which on booking FMM1FLR7
 * (AA, DEL-YYZ: DEL→JFK, LGA→YYZ, YYZ→LGA, JFK→DEL) matched the FINAL segment
 * because it departs JFK and the first one arrives JFK. It split 3 + 1, so the
 * customer's outbound read DEL→LGA across 23 days with a 529-hour "layover",
 * and the trip was labelled DEL⇄LGA instead of DEL⇄YYZ.
 *
 * Two robust signals, in order:
 *
 *   1. The searched destination. The return leg departs from it by definition,
 *      so the first segment after position 0 that departs there is the boundary.
 *   2. The destination stay. Failing that, the largest gap between segments —
 *      nobody waits 22 days at a connecting airport, so the longest gap is the
 *      trip itself, not a layover.
 *
 * Only if neither applies does it fall back to splitting down the middle.
 */
const MIN_STAY_HOURS = 12;

function findReturnLegStart(segments: UnifiedFlight['segments'], destination?: string): number {
  // 1 — the leg that departs the place the customer flew to.
  if (destination) {
    for (let i = 1; i < segments.length; i++) {
      if (segments[i].departure.airport === destination) return i;
    }
  }

  // 2 — the longest gap, when it is long enough to be a stay rather than a wait.
  let bestIdx = -1;
  let bestGapH = 0;
  for (let i = 1; i < segments.length; i++) {
    const arrive = new Date(segments[i - 1].arrival.time).getTime();
    const depart = new Date(segments[i].departure.time).getTime();
    if (!Number.isFinite(arrive) || !Number.isFinite(depart)) continue;
    const gapH = (depart - arrive) / 3_600_000;
    if (gapH > bestGapH) { bestGapH = gapH; bestIdx = i; }
  }
  if (bestIdx > 0 && bestGapH >= MIN_STAY_HOURS) return bestIdx;

  // 3 — nothing to go on. Split evenly.
  return Math.ceil(segments.length / 2);
}

function convertUnifiedToRoundTrip(flights: UnifiedFlight[], destination?: string): RoundTripOption[] {
  const options: RoundTripOption[] = [];

  for (const f of flights) {
    if (!f.segments || f.segments.length < 2) continue;

    const splitIdx = findReturnLegStart(f.segments, destination);

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
      baseFare: f.baseFare,
      taxAmount: f.taxAmount,
      taxBreakdown: f.taxBreakdown,
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

      // Fare family must survive this conversion. Without these the fare panel
      // had no brand to show and fell back to the bare cabin name — every card
      // rendered as "Economy" — and no itineraryKey to group siblings by, so a
      // real fare ladder could not be assembled.
      airlineFareFamily: f.airlineFareFamily,
      normalizedFareTier: f.normalizedFareTier,
      itineraryKey: f.itineraryKey,
      bookingClass: f.bookingClass,
      checkedBaggageAllowance: f.checkedBaggageAllowance,
      cabinBaggageAllowance: f.cabinBaggageAllowance,
      seatsRemaining: f.seatsRemaining,
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

/** Exported for src/lib/providers/__tests__/rt-flat-split.test.ts. */
export const __testing = { findReturnLegStart };
