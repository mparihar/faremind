import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';
import type { NormalizedOption } from './types';
// Single source of truth for local-hour extraction and international detection.
import { hourFromIso, isInternationalRoute } from './FlightScoringUtils';

// ── One-Way normalizer ───────────────────────────────────────────────────────

export function normalizeOneWay(f: UnifiedFlight): NormalizedOption {
  const layoverMinutes: number[] = [];
  for (let i = 0; i < f.segments.length - 1; i++) {
    const arrMs = flightTimeMs(f.segments[i].arrival.time);
    const depMs = flightTimeMs(f.segments[i + 1].departure.time);
    layoverMinutes.push((depMs - arrMs) / 60_000);
  }

  const departureHour = f.segments.length > 0
    ? hourFromIso(f.segments[0].departure.time)
    : 12;

  const arrivalHour = f.segments.length > 0
    ? hourFromIso(f.segments[f.segments.length - 1].arrival.time)
    : 12;

  const airlineCount = new Set(f.segments.map(s => s.airline.code)).size;

  const depAirport = f.segments[0]?.departure?.airport ?? '';
  const arrAirport = f.segments[f.segments.length - 1]?.arrival?.airport ?? '';

  return {
    id:                   f.id,
    price:                f.totalPrice,
    currency:             f.currency,
    durationMinutes:      f.totalDuration,
    stops:                f.stops,
    airlineCount,
    departureHour,
    arrivalHour,
    returnDepartureHour:  null,
    returnArrivalHour:    null,
    layoverMinutes,
    baggageCarryOn:       f.baggage?.carryOn ?? 0,
    baggageChecked:       f.baggage?.checked ?? 0,
    refundable:           f.fareRules?.refundable ?? false,
    changeable:           f.fareRules?.changeable ?? false,
    providerCode:         f.provider ?? 'unknown',
    isInternational:      isInternationalRoute(depAirport, arrAirport),
  };
}

// ── Round-Trip normalizer ────────────────────────────────────────────────────

export function normalizeRoundTrip(o: RoundTripOption): NormalizedOption {
  const layoverMinutes = [
    ...o.outboundJourney.layovers.map(l => l.durationMinutes),
    ...o.returnJourney.layovers.map(l => l.durationMinutes),
  ];

  const departureHour = o.outboundJourney.departureTime
    ? hourFromIso(o.outboundJourney.departureTime)
    : 12;

  const arrivalHour = o.outboundJourney.arrivalTime
    ? hourFromIso(o.outboundJourney.arrivalTime)
    : 12;

  const returnDepartureHour = o.returnJourney.departureTime
    ? hourFromIso(o.returnJourney.departureTime)
    : null;

  const returnArrivalHour = o.returnJourney.arrivalTime
    ? hourFromIso(o.returnJourney.arrivalTime)
    : null;

  const depAirport = o.outboundJourney.departureAirport ?? '';
  const arrAirport = o.outboundJourney.arrivalAirport ?? '';

  return {
    id:                   o.id,
    price:                o.totalPrice,
    currency:             o.currency,
    durationMinutes:      o.totalDurationMinutes,
    stops:                o.totalStops,
    airlineCount:         o.airlineCodes.length,
    departureHour,
    arrivalHour,
    returnDepartureHour,
    returnArrivalHour,
    layoverMinutes,
    baggageCarryOn:       o.baggage?.carryOn ?? 0,
    baggageChecked:       o.baggage?.checked ?? 0,
    refundable:           o.fareRules?.refundable ?? false,
    changeable:           o.fareRules?.changeable ?? false,
    providerCode:         o.provider ?? 'unknown',
    isInternational:      isInternationalRoute(depAirport, arrAirport),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Adapter functions: Convert existing FareMind types → NormalizedFlightOffer
// ═══════════════════════════════════════════════════════════════════════════════

import type { NormalizedFlightOffer, FlightLeg, LegLayover, LegSegment } from './FlightScoringTypes';
import { flightTimeMs } from '../provider-time';

function buildLayoversFromSegments(
  segments: import('@/lib/types').FlightSegment[],
): LegLayover[] {
  const layovers: LegLayover[] = [];
  if (segments.length < 2) return layovers;

  // Compute total elapsed time from first departure to last arrival (UTC)
  const firstDepMs = flightTimeMs(segments[0].departure.time);
  const lastArrMs = flightTimeMs(segments[segments.length - 1].arrival.time);
  const totalElapsedMinutes = Math.max(0, (lastArrMs - firstDepMs) / 60_000);

  // Sum all segment flight durations
  const totalFlightMinutes = segments.reduce((sum, s) => sum + (s.duration || 0), 0);

  for (let i = 0; i < segments.length - 1; i++) {
    const arrMs = flightTimeMs(segments[i].arrival.time);
    const depMs = flightTimeMs(segments[i + 1].departure.time);
    let durationMinutes = (depMs - arrMs) / 60_000;

    // Sanity check: layover cannot exceed 80% of total elapsed time
    // This catches timezone parsing bugs (e.g., non-UTC local times)
    if (totalElapsedMinutes > 0 && durationMinutes > totalElapsedMinutes * 0.8) {
      console.warn(
        `[LayoverSanity] Implausible layover: ${Math.round(durationMinutes)} min ` +
        `(${Math.round(durationMinutes / 60)}h) exceeds 80% of total elapsed ` +
        `${Math.round(totalElapsedMinutes)} min. ` +
        `Segments: ${segments[i].arrival.airport} → ${segments[i + 1].departure.airport}. ` +
        `Capping to estimated: totalElapsed - flightTime = ${Math.round(totalElapsedMinutes - totalFlightMinutes)} min.`
      );
      // Estimate the correct layover: total elapsed - total flight time
      durationMinutes = Math.max(0, totalElapsedMinutes - totalFlightMinutes);
    }

    // Negative layover = data error (segments overlap)
    if (durationMinutes < 0) {
      console.warn(
        `[LayoverSanity] Negative layover: ${Math.round(durationMinutes)} min. ` +
        `Setting to 0.`
      );
      durationMinutes = 0;
    }

    // Land at one airport, leave from another — the JFK-in, LGA-out case. This
    // was hard-coded false, so the AIRPORT_CHANGE warning, the AI-Pick block and
    // the 30-point penalty that all depend on it could never fire for any
    // itinerary. The test is simply whether the two airports differ.
    const arrivesAt = segments[i].arrival.airport;
    const leavesFrom = segments[i + 1].departure.airport;
    const requiresAirportChange = !!arrivesAt && !!leavesFrom && arrivesAt !== leavesFrom;

    // Same airport, different terminal. Worth saying, not worth blocking on.
    const arrTerminal = (segments[i].arrival as any)?.terminal;
    const depTerminal = (segments[i + 1].departure as any)?.terminal;
    const requiresTerminalChange = !requiresAirportChange &&
      !!arrTerminal && !!depTerminal && String(arrTerminal) !== String(depTerminal);

    layovers.push({
      airport: arrivesAt,
      durationMinutes,
      isOvernight: durationMinutes > 600,
      requiresAirportChange,
      requiresTerminalChange,
      isSelfTransfer: false,
    });
  }
  return layovers;
}

function buildLegSegments(
  segments: import('@/lib/types').FlightSegment[],
): LegSegment[] {
  return segments.map(s => ({
    airlineCode:      s.airline.code,
    airlineName:      s.airline.name,
    flightNumber:     s.flightNumber,
    departureAirport: s.departure.airport,
    arrivalAirport:   s.arrival.airport,
    departureTime:    s.departure.time,
    arrivalTime:      s.arrival.time,
    durationMinutes:  s.duration,
  }));
}

/**
 * Convert a UnifiedFlight (one-way) to a NormalizedFlightOffer.
 */
export function unifiedFlightToOffer(f: UnifiedFlight): NormalizedFlightOffer {
  const depAirport = f.segments[0]?.departure?.airport ?? '';
  const arrAirport = f.segments[f.segments.length - 1]?.arrival?.airport ?? '';

  const outbound: FlightLeg = {
    departureAirport: depAirport,
    arrivalAirport:   arrAirport,
    departureTime:    f.segments[0]?.departure?.time ?? '',
    arrivalTime:      f.segments[f.segments.length - 1]?.arrival?.time ?? '',
    durationMinutes:  f.totalDuration,
    stops:            f.stops,
    layovers:         buildLayoversFromSegments(f.segments),
    segments:         buildLegSegments(f.segments),
  };

  return {
    id:              f.id,
    providerCode:    f.provider ?? 'unknown',
    providerOfferId: (f as any).providerOfferId,
    tripType:        'ONE_WAY',
    baseFare:        f.totalPrice,
    totalFare:       f.totalPrice,
    currency:        f.currency,
    outbound,
    baggage: {
      carryOnIncluded:     (f.baggage?.carryOn ?? 0) > 0,
      carryOnPieces:       f.baggage?.carryOn ?? 0,
      checkedBagsIncluded: f.baggage?.checked ?? 0,
    },
    fareRules: {
      refundable: f.fareRules?.refundable ?? false,
      changeable: f.fareRules?.changeable ?? false,
    },
    cabinClass:     f.cabinClass,
    isInternational: isInternationalRoute(depAirport, arrAirport),
  };
}

/**
 * Convert a RoundTripOption to a NormalizedFlightOffer.
 */
export function roundTripOptionToOffer(o: RoundTripOption): NormalizedFlightOffer {
  const depAirport = o.outboundJourney.departureAirport ?? '';
  const arrAirport = o.outboundJourney.arrivalAirport ?? '';

  function journeyToLeg(j: import('@/lib/round-trip-types').JourneySegment): FlightLeg {
    return {
      departureAirport: j.departureAirport,
      arrivalAirport:   j.arrivalAirport,
      departureTime:    j.departureTime,
      arrivalTime:      j.arrivalTime,
      durationMinutes:  j.durationMinutes,
      stops:            j.stops,
      // The journey's Layover carries only one airport, so the change is derived
      // from the segments either side of it. Reading l.terminalChange as an
      // airport change — which is what this did — both over-warns on a terminal
      // walk and misses a real airport change entirely.
      layovers: j.layovers.map((l, li) => {
        const arrivesAt = j.segments?.[li]?.arrival?.airport ?? l.airport;
        const leavesFrom = j.segments?.[li + 1]?.departure?.airport ?? l.airport;
        const requiresAirportChange = !!arrivesAt && !!leavesFrom && arrivesAt !== leavesFrom;
        return {
          airport:         l.airport,
          durationMinutes: l.durationMinutes,
          isOvernight:     l.durationMinutes > 600,
          requiresAirportChange,
          requiresTerminalChange: !requiresAirportChange && (l.terminalChange ?? false),
          isSelfTransfer: false,
        };
      }),
      segments: buildLegSegments(j.segments),
    };
  }

  return {
    id:              o.id,
    providerCode:    o.provider ?? 'unknown',
    providerOfferId: o.providerOfferId,
    tripType:        'ROUND_TRIP',
    baseFare:        o.totalPrice,
    totalFare:       o.totalPrice,
    currency:        o.currency,
    outbound:        journeyToLeg(o.outboundJourney),
    returnLeg:       journeyToLeg(o.returnJourney),
    baggage: {
      carryOnIncluded:     (o.baggage?.carryOn ?? 0) > 0,
      carryOnPieces:       o.baggage?.carryOn ?? 0,
      checkedBagsIncluded: o.baggage?.checked ?? 0,
    },
    fareRules: {
      refundable: o.fareRules?.refundable ?? false,
      changeable: o.fareRules?.changeable ?? false,
    },
    cabinClass:     o.cabinClass,
    isInternational: isInternationalRoute(depAirport, arrAirport),
  };
}
