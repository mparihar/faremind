/**
 * FareMind Backend Types
 * Mirrors the frontend types for the unified flight schema.
 */

export type Provider = 'duffel' | 'amadeus' | 'mystifly';
export type CabinClass = 'economy' | 'premium_economy' | 'business' | 'first';

/**
 * Internal fare tier. Derived from the airline's fare family for ranking,
 * filters and analytics — never shown to a customer. See services/fare-family.ts.
 */
export type NormalizedFareTier = 'BASIC' | 'STANDARD' | 'FLEX' | 'PREMIUM' | 'BUSINESS' | 'FIRST';

export interface AirlineInfo {
  code: string;
  name: string;
  logo?: string;
}

export interface FlightSegment {
  id: string;
  departure: {
    airport: string;
    airportName: string;
    city: string;
    time: string;
    terminal?: string;
  };
  arrival: {
    airport: string;
    airportName: string;
    city: string;
    time: string;
    terminal?: string;
  };
  airline: AirlineInfo;
  flightNumber: string;
  duration: number;
  aircraft?: string;
  operatingCarrier?: AirlineInfo;

  // ── Per-segment fare signals ──
  // Both reach the orchestrator from ItineraryReferenceList and were dropped
  // here. They are the 2nd and 4th inputs to cabin classification, and they are
  // PER SEGMENT — an itinerary can mix cabins, which a single offer-level field
  // cannot express.
  /** Provider cabin code for this segment: 'Y' | 'S' | 'C' | 'J' | 'F' | 'P'. */
  cabinClassCode?: string;
  /** Airline fare basis for this segment, e.g. 'QL7XLGY1'. */
  fareBasisCode?: string;
}

/**
 * Fare conditions as the PROVIDER stated them.
 *
 * `null` means the provider did not tell us — distinct from `false`, which
 * means it explicitly said no. Mystifly's v2.2 PenaltiesInfoList is a shared
 * reference list, and the bulk of offers point at an entirely EMPTY record
 * (both flags false, fee strings "", currency ""). Reading that as a firm
 * "non-refundable" printed a restriction the airline never stated — and
 * TripDetails for those same fares reports refundable=Yes with a real fee.
 * Render null as "Contact airline", never as a denial.
 */
export interface FareRules {
  refundable: boolean | null;
  changeable: boolean | null;
  cancellationFee?: number;
  changeFee?: number;
}

export interface BaggageAllowance {
  carryOn: number;
  checked: number;
}

export interface ScoreBreakdown {
  priceScore: number;
  durationScore: number;
  stopsScore: number;
}

export type FlightTag = 'best_value' | 'cheapest' | 'fastest';

export interface TaxBreakdownItem {
  code: string;    // Tax code (e.g. 'YRI', 'US2', 'IN')
  amount: number;  // Tax amount
  label?: string;  // Human-readable label (e.g. 'Carrier-Imposed Fuel Surcharge')
}

export interface UnifiedFlight {
  id: string;
  provider: Provider;
  providerOfferId: string;
  airline: AirlineInfo;
  segments: FlightSegment[];
  totalPrice: number;
  baseFare?: number;         // Provider base fare (before taxes)
  taxAmount?: number;        // Provider total tax amount
  taxBreakdown?: TaxBreakdownItem[]; // Detailed tax line items from provider
  providerTotalFare?: number; // Raw provider fare (same as totalPrice — no markup)
  fareMindMarkupAmount?: number; // FareMind margin added on top of provider fare (set by markup-service)
  markupRuleId?: string;         // ID of the markup rule that was applied
  currency: string;
  cabinClass: CabinClass;
  fareRules: FareRules;
  baggage: BaggageAllowance;
  totalDuration: number;
  stops: number;
  valueScore: number;
  fareClass?: string;
  fareType?: 'lowest' | 'branded';
  fareSource?: 'public' | 'private'; // Mystifly pricing source (Public/Private fare)
  seatsRemaining?: number;

  // ── Fare family ──
  // The airline's own brand ("ECO VALUE", "DELTA MAIN BASIC", "INDIGO UPFRONT").
  // This is the customer-facing label and is never rewritten by FareMind.
  airlineFareFamily?: string;
  // Internal tier for ranking/filters/analytics only — never displayed.
  normalizedFareTier?: NormalizedFareTier;
  // Identity of the physical journey. Offers sharing a key are the same metal
  // at different fare families — the set the fare panel shows.
  itineraryKey?: string;
  // Reservation booking designator (RBD) — 'Y', 'N', 'Z', …
  bookingClass?: string;
  // Raw provider allowance strings, kept verbatim for display ('15Kg', '0PC').
  checkedBaggageAllowance?: string;
  cabinBaggageAllowance?: string;
  tags?: FlightTag[];
  breakdown?: ScoreBreakdown;
  offerExpiresAt?: string;

  // ── Provider aggregation metadata (admin/debug only) ──
  aggregationMeta?: AggregationMeta;
}

export interface AggregationMeta {
  duplicateKey: string;
  selectedProvider: string;
  duplicateProviders: string[];
  selectionReason: string;
  duplicateOfferIds: string[];
  selectedProviderFare: number;
  duplicateProviderFares: Record<string, number>;
}
