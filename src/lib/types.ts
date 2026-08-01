// ═══════════════════════════════════════════════
// FareMind Core Types
// ═══════════════════════════════════════════════

export type Provider = 'duffel' | 'amadeus' | 'mystifly';
export type CabinClass = 'economy' | 'premium_economy' | 'business' | 'first';

/**
 * Internal fare tier derived from the airline's fare family on the backend.
 * For ranking, filters and analytics only — the customer always sees the
 * airline's own brand. Mirrors backend/src/lib/types.ts.
 */
export type NormalizedFareTier = 'BASIC' | 'STANDARD' | 'FLEX' | 'PREMIUM' | 'BUSINESS' | 'FIRST';
export type TripType = 'one_way' | 'round_trip' | 'multi_city';
export type SortOption = 'price' | 'duration' | 'departure' | 'value';

// ─── Flight Search ───

export interface SearchQuery {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers: {
    adults: number;
    children: number;
    infants: number;
  };
  cabinClass: CabinClass;
  tripType: TripType;
}

export interface Airport {
  code: string;
  name: string;
  city: string;
  state?: string;
  country: string;
}

export interface AirlineInfo {
  code: string;
  name: string;
  logo?: string;
}

// ─── Unified Flight Object ───

export interface FlightSegment {
  id: string;
  departure: {
    airport: string;
    airportName: string;
    city: string;
    time: string; // ISO 8601
    terminal?: string;
    gate?: string;
  };
  arrival: {
    airport: string;
    airportName: string;
    city: string;
    time: string;
    terminal?: string;
    gate?: string;
  };
  airline: AirlineInfo;
  flightNumber: string;
  duration: number; // minutes
  aircraft?: string;
  operatingCarrier?: AirlineInfo;
  amenities?: {
    wifi?: boolean;
    power?: boolean;
    entertainment?: boolean;
  };
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
  cancellationDeadline?: string;
}

export interface BaggageAllowance {
  carryOn: number; // pieces
  checked: number;
  carryOnWeight?: number; // kg
  checkedWeight?: number;
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
  label?: string;  // Human-readable label
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
  currency: string;
  cabinClass: CabinClass;
  fareRules: FareRules;
  baggage: BaggageAllowance;
  totalDuration: number; // minutes
  stops: number;
  valueScore: number; // 0-100, best-value score from scoring engine
  fareClass?: string;
  fareType?: 'lowest' | 'branded';
  fareSource?: 'public' | 'private'; // Mystifly pricing source (Public/Private fare)
  seatsRemaining?: number;

  // ── Fare family (mirrors backend/src/lib/types.ts) ──
  /** The airline's own brand — displayed verbatim, never rewritten. */
  airlineFareFamily?: string;
  /** Internal tier for filters/analytics only. Never render this. */
  normalizedFareTier?: NormalizedFareTier;
  /**
   * Identity of the physical journey. Offers sharing a key are the same flights
   * at different fare families — that set is the fare ladder shown in the panel.
   */
  itineraryKey?: string;
  /** Reservation booking designator (RBD). */
  bookingClass?: string;
  /** Raw provider allowance text, kept verbatim ('15Kg', '0PC', '7KG'). */
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

// ─── Booking ───

export interface Passenger {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: 'male' | 'female' | 'other';
  email: string;
  phone: string;
  passportNumber?: string;
  nationality?: string;
  type: 'adult' | 'child' | 'infant';
}

export interface Booking {
  id: string;
  userId: string;
  flightId: string;
  provider: Provider;
  providerBookingId: string;
  pnr: string;
  status: 'confirmed' | 'pending' | 'cancelled' | 'completed';
  passengers: Passenger[];
  flight: UnifiedFlight;
  totalPaid: number;
  currency: string;
  bookedAt: string;
  priceHistory: PricePoint[];
  priceTracking: boolean;
}

export interface PricePoint {
  timestamp: string;
  price: number;
  currency: string;
}

// ─── User ───

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatar?: string;
  createdAt: string;
}

// ─── Search State ───

export interface SearchFilters {
  maxPrice?: number;
  maxStops?: number;
  airlines?: string[];
  departureTimeRange?: [number, number]; // hours
  providers?: Provider[];
  refundableOnly?: boolean;
}

export interface SearchState {
  query: SearchQuery | null;
  results: UnifiedFlight[];
  filteredResults: UnifiedFlight[];
  filters: SearchFilters;
  sortBy: SortOption;
  loading: boolean;
  error: string | null;
}

// ─── API Responses ───

export interface SearchResponse {
  flights: UnifiedFlight[];
  meta: {
    totalResults: number;
    providers: { provider: Provider; count: number; responseTime: number }[];
    searchId: string;
  };
}

export interface BookingResponse {
  booking: Booking;
  success: boolean;
  message?: string;
}

// ─── Price Tracking ───

export interface PriceAlert {
  id: string;
  bookingId: string;
  currentPrice: number;
  bookedPrice: number;
  savings: number;
  percentDrop: number;
  detectedAt: string;
  status: 'new' | 'notified' | 'acted';
}
