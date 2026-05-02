import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';
import type { NormalizedOption } from './types';

export function normalizeOneWay(f: UnifiedFlight): NormalizedOption {
  // Layover = gap between consecutive segments
  const layoverMinutes: number[] = [];
  for (let i = 0; i < f.segments.length - 1; i++) {
    const arrMs  = new Date(f.segments[i].arrival.time).getTime();
    const depMs  = new Date(f.segments[i + 1].departure.time).getTime();
    layoverMinutes.push((depMs - arrMs) / 60_000);
  }

  const departureHour = f.segments.length > 0
    ? new Date(f.segments[0].departure.time).getHours()
    : 12;

  const airlineCount = new Set(f.segments.map(s => s.airline.code)).size;

  return {
    id:              f.id,
    price:           f.totalPrice,
    currency:        f.currency,
    durationMinutes: f.totalDuration,
    stops:           f.stops,
    airlineCount,
    departureHour,
    layoverMinutes,
  };
}

export function normalizeRoundTrip(o: RoundTripOption): NormalizedOption {
  const layoverMinutes = [
    ...o.outboundJourney.layovers.map(l => l.durationMinutes),
    ...o.returnJourney.layovers.map(l => l.durationMinutes),
  ];

  const departureHour = o.outboundJourney.departureTime
    ? new Date(o.outboundJourney.departureTime).getHours()
    : 12;

  return {
    id:              o.id,
    price:           o.totalPrice,
    currency:        o.currency,
    durationMinutes: o.totalDurationMinutes,
    stops:           o.totalStops,
    airlineCount:    o.airlineCodes.length,
    departureHour,
    layoverMinutes,
  };
}
