/**
 * FareMind Backend Types
 * Mirrors the frontend types for the unified flight schema.
 */

export type Provider = 'duffel' | 'amadeus' | 'mystifly';
export type CabinClass = 'economy' | 'premium_economy' | 'business' | 'first';

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
}

export interface FareRules {
  refundable: boolean;
  changeable: boolean;
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
  currency: string;
  cabinClass: CabinClass;
  fareRules: FareRules;
  baggage: BaggageAllowance;
  totalDuration: number;
  stops: number;
  valueScore: number;
  fareClass?: string;
  fareType?: 'lowest' | 'branded';
  seatsRemaining?: number;
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
