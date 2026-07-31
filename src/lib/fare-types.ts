import type { CabinClass } from '@/lib/types';

// ─── Cabin tier ──────────────────────────────────────────────────────────────

export type FareCabin = CabinClass; // 'economy' | 'premium_economy' | 'business' | 'first'

/**
 * Internal fare tier, derived from the airline's fare family on the backend.
 * Use it for filters, sorting and analytics — never render it. The customer
 * always sees the airline's own brand (`FareOption.name`).
 */
export type NormalizedFareTier = 'BASIC' | 'STANDARD' | 'FLEX' | 'PREMIUM' | 'BUSINESS' | 'FIRST';

/**
 * Comparable benefits, normalized across carriers. `null` means the provider
 * did not tell us — render it as "—" or omit the row, never as a "no".
 */
export interface FareBenefits {
  carryOnAllowance: string | null;    // provider text, e.g. '7KG'
  carryOnWeightKg: number | null;
  checkedAllowance: string | null;    // provider text, e.g. '15Kg', '0PC'
  checkedPieces: number | null;
  checkedWeightKg: number | null;
  refundable: boolean | null;
  refundFeeUsd: number | null;
  changeable: boolean | null;
  changeFeeUsd: number | null;
  seatSelection: 'free' | 'fee' | 'not_available' | null;
  bookingClass: string | null;        // RBD
}

// ─── Baggage ─────────────────────────────────────────────────────────────────

export interface FareBaggage {
  carryOn: boolean;
  carryOnPieces: number;
  carryOnWeightKg: number | null;
  checked: number;        // pieces included
  checkedWeightKg: number | null;
  extraBagFeeUsd: number | null;
}

// ─── Policies ────────────────────────────────────────────────────────────────

/**
 * `null` on any field means the provider did not state it. These used to be
 * filled in from FareMind's own fare-tier templates, which asserted lounge
 * access and miles earning we had no source for.
 */
export interface FarePolicy {
  refundable: boolean | null;
  refundFeeUsd: number | null;
  changeable: boolean | null;
  changeFeeUsd: number | null;
  seatSelection: 'free' | 'fee' | 'not_available' | null;
  seatSelectionFeeUsd: number | null;
  upgradeable: boolean | null;
  loungeAccess: boolean | null;
  priorityBoarding: boolean | null;
  milesEarning: 'full' | 'reduced' | 'none' | null;
}

// ─── Individual fare option ───────────────────────────────────────────────────

export type AiBadge =
  | 'cheapest'
  | 'best_value'
  | 'most_flexible'
  | 'premium_upgrade'
  | 'ai_pick'
  | 'best_comfort';

export interface FareOption {
  id: string;
  offerId: string;           // provider offer id — distinct per fare in the ladder
  cabin: FareCabin;
  /**
   * The airline's own fare family, verbatim: "ECO VALUE", "DELTA MAIN BASIC",
   * "INDIGO UPFRONT". Falls back to the plain cabin name when the airline files
   * no brand. FareMind never substitutes a name of its own.
   */
  name: string;
  /** Raw provider value; null when the airline filed no brand. */
  airlineFareFamily?: string | null;
  /** Internal tier — filters/analytics only, never rendered. */
  normalizedFareTier?: NormalizedFareTier;
  basePrice: number;
  totalPrice: number;
  currency: string;
  benefits?: FareBenefits;
  baggage: FareBaggage;
  policy: FarePolicy;
  aiScore: number;           // 0–100
  aiBadges: AiBadge[];
  aiExplanation: string;     // 1-line human-readable reason
  duffelFareId?: string;
  /** Real provider availability; null when the provider did not say. */
  seatsRemaining?: number | null;
  popular?: boolean;
}

// ─── Grouped by cabin ────────────────────────────────────────────────────────

export interface FareGroup {
  cabin: FareCabin;
  label: string;             // "Economy", "Premium Economy", etc.
  fares: FareOption[];
}

// ─── AI Recommendations block ─────────────────────────────────────────────────

export interface AiRecommendation {
  badge: AiBadge;
  fareId: string;
  headline: string;          // short label, e.g. "Best Value Pick"
  reason: string;            // 1-sentence explanation
}

export interface AiRecommendations {
  /** null when the flight has no fares to rank. */
  topPick: AiRecommendation | null;
  others: AiRecommendation[];
}

// ─── Price Drop Protection quote ─────────────────────────────────────────────

export interface PriceProtectionQuote {
  fareId: string;
  protectionFeeUsd: number;
  coveragePct: number;       // e.g. 80 = covers 80% of price drop
  maxRefundUsd: number;
  validHours: number;
}

// ─── Full fare-selection API response ────────────────────────────────────────

export interface FareSelectionPayload {
  offerId: string;
  destinationCity: string;
  journeySummary: string;    // e.g. "LHR → JFK · 7h 35m · Non-stop"
  fareGroups: FareGroup[];
  aiRecommendations: AiRecommendations;
  currency: string;
  baseCurrency: string;
}

// ─── Selected fare (written to booking session) ───────────────────────────────

export interface SelectedFare {
  fareId: string;
  offerId: string;
  cabin: FareCabin;
  /** Airline fare family — carried unchanged into checkout, ticket and servicing. */
  name: string;
  airlineFareFamily?: string | null;
  normalizedFareTier?: NormalizedFareTier;
  basePrice: number;
  totalPrice: number;
  priceProtection: boolean;
  protectionFee: number;
  grandTotal: number;
  currency: string;
  policy?: FarePolicy;
  benefits?: FareBenefits;
}
