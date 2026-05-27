import type { UnifiedFlight } from './types';
import { computeHeuristicScores, type FlightHeuristicScores } from './dynamic-profile';

export interface FareMindFlightCard extends FlightHeuristicScores {
  card_id: string;
  airline: string;
  airline_code: string;
  provider: string;
  price: number;
  currency: string;
  total_duration_minutes: number;
  stops: number;
  layover_minutes: number;
  longest_layover_minutes: number;
  overnight_layover: boolean;
  departure_time_local: string;
  arrival_time_local: string;
  bags_included: boolean;
  checked_bags: number;
  carry_on_bags: number;
  airport_change: boolean;
  route: string;
  segment_count: number;
  connection_airports: string[];
  cabin: string;
  refundable: boolean;
  changeable: boolean;
  is_red_eye: boolean;
  ai_score: number;
}

function isRedEye(timeStr: string): boolean {
  try {
    const h = new Date(timeStr).getHours();
    return h >= 22 || h < 4;
  } catch { return false; }
}

function computeLayovers(flight: UnifiedFlight): {
  total: number;
  longest: number;
  overnight: boolean;
  airportChange: boolean;
  connections: string[];
} {
  const segs = flight.segments;
  if (segs.length <= 1) {
    return { total: 0, longest: 0, overnight: false, airportChange: false, connections: [] };
  }

  let total = 0, longest = 0;
  let overnight = false, airportChange = false;
  const connections: string[] = [];

  for (let i = 0; i < segs.length - 1; i++) {
    const arrMs = new Date(segs[i].arrival.time).getTime();
    const depMs = new Date(segs[i + 1].departure.time).getTime();
    const layover = Math.round((depMs - arrMs) / 60000);
    if (layover > 0) {
      total += layover;
      if (layover > longest) longest = layover;
      const arrH = new Date(segs[i].arrival.time).getHours();
      const depH = new Date(segs[i + 1].departure.time).getHours();
      if (arrH > depH || layover > 360) overnight = true;
    }
    if (segs[i].arrival.airport !== segs[i + 1].departure.airport) airportChange = true;
    connections.push(segs[i].arrival.airport);
  }

  return { total, longest, overnight, airportChange, connections };
}

export function normalizeFlightCard(flight: UnifiedFlight): FareMindFlightCard {
  const first = flight.segments[0];
  const last = flight.segments[flight.segments.length - 1];
  const { total, longest, overnight, airportChange, connections } = computeLayovers(flight);
  const redEye = isRedEye(first.departure.time);

  const heuristics = computeHeuristicScores({
    airlineCode: flight.airline.code,
    stops: flight.stops,
    airportChange,
    overnightLayover: overnight,
    isRedEye: redEye,
    longestLayoverMinutes: longest,
    checkedBags: flight.baggage.checked,
    carryOnBags: flight.baggage.carryOn,
    cabin: flight.cabinClass,
  });

  return {
    card_id: flight.id,
    airline: flight.airline.name,
    airline_code: flight.airline.code,
    provider: flight.provider,
    price: flight.totalPrice,
    currency: flight.currency,
    total_duration_minutes: flight.totalDuration,
    stops: flight.stops,
    layover_minutes: total,
    longest_layover_minutes: longest,
    overnight_layover: overnight,
    departure_time_local: first.departure.time,
    arrival_time_local: last.arrival.time,
    bags_included: flight.baggage.carryOn > 0 || flight.baggage.checked > 0,
    checked_bags: flight.baggage.checked,
    carry_on_bags: flight.baggage.carryOn,
    airport_change: airportChange,
    route: `${first.departure.airport}→${last.arrival.airport}`,
    segment_count: flight.segments.length,
    connection_airports: connections,
    cabin: flight.cabinClass,
    refundable: flight.fareRules.refundable,
    changeable: flight.fareRules.changeable,
    is_red_eye: redEye,
    ai_score: flight.valueScore,
    ...heuristics,
  };
}

export function normalizeFlightCards(flights: UnifiedFlight[]): FareMindFlightCard[] {
  return flights.map(normalizeFlightCard);
}
