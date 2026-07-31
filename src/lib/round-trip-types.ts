import type { CabinClass, Provider, BaggageAllowance } from '@/lib/types';

// ─── Journey leg (one direction of a round trip) ───────────────────────────

export interface Layover {
  airport: string;
  airportName: string;
  durationMinutes: number;
  terminalChange?: boolean;
}

export interface JourneySegment {
  direction: 'outbound' | 'return';
  departureAirport: string;
  arrivalAirport: string;
  departureTime: string;  // ISO 8601
  arrivalTime: string;    // ISO 8601
  durationMinutes: number;
  stops: number;
  stopAirports: string[];
  airlineNames: string[];
  airlineCodes: string[];
  flightNumbers: string[];   // e.g. ['BA1087', 'AA1067']
  layovers: Layover[];
  segments: import('@/lib/types').FlightSegment[];
}

// ─── Score breakdown (debug only, not exposed to end users) ─────────────────

export interface RoundTripScoreBreakdown {
  priceScore: number;
  durationScore: number;
  stopsScore: number;
  layoverScore: number;
  scheduleScore: number;
  baggageScore: number;
  fareFlexibilityScore: number;
  providerReliabilityScore: number;
  finalScore: number;
}

// ─── Badges ─────────────────────────────────────────────────────────────────

export type RoundTripBadge = 'cheapest' | 'fastest' | 'fewest_stops' | 'best_value' | 'recommended' | 'better_schedule';

// ─── Complete round-trip option (one card on the UI) ────────────────────────

export interface RoundTripOption {
  id: string;
  providerOfferId: string;
  provider: Provider;

  outboundJourney: JourneySegment;
  returnJourney: JourneySegment;

  totalPrice: number;
  baseFare?: number;
  taxAmount?: number;
  taxBreakdown?: Array<{ code: string; amount: number; label?: string }>;
  currency: string;
  totalDurationMinutes: number;
  totalStops: number;
  maxStopsOneWay: number;

  airlines: string[];       // display names, deduplicated
  airlineCodes: string[];   // IATA codes, deduplicated

  bookingProvider: string;
  cabinClass: CabinClass;

  // ── Fare family ──
  /** The airline's own brand, verbatim — displayed, never rewritten. */
  airlineFareFamily?: string;
  /** Internal tier for filters/analytics only. Never render this. */
  normalizedFareTier?: import('@/lib/types').NormalizedFareTier;
  /** Same metal at a different fare shares this key — the fare ladder. */
  itineraryKey?: string;
  /** Reservation booking designator (RBD). */
  bookingClass?: string;
  /** Raw provider allowance text, kept verbatim. */
  checkedBaggageAllowance?: string;
  cabinBaggageAllowance?: string;
  seatsRemaining?: number;

  fareRules: {
    refundable: boolean;
    changeable: boolean;
    cancellationFee?: number;
    changeFee?: number;
  };
  baggage: BaggageAllowance;

  promotionText?: string;

  score?: number;
  badges?: RoundTripBadge[];
  scoreBreakdown?: RoundTripScoreBreakdown; // debug only
  offerExpiresAt?: string; // ISO 8601 — provider offer expiry timestamp
  providerTotalFare?: number; // Raw provider fare (same as totalPrice)
}

// ─── User preferences fed into the ranker ───────────────────────────────────

export interface RoundTripUserPrefs {
  stops?: 'nonstop' | '1stop' | 'any';
  departureWindow?: 'morning' | 'afternoon' | 'evening' | 'night' | null;
}

// ─── Sort modes supported on the UI ─────────────────────────────────────────

export type RoundTripSortMode =
  | 'cheapest'
  | 'fastest'
  | 'fewest_stops'
  | 'earliest_dep'
  | 'latest_dep'
  | 'earliest_arr'
  | 'latest_arr';
