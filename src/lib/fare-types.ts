import type { CabinClass } from '@/lib/types';

// ─── Cabin tier ──────────────────────────────────────────────────────────────

export type FareCabin = CabinClass; // 'economy' | 'premium_economy' | 'business' | 'first'

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

export interface FarePolicy {
  refundable: boolean;
  refundFeeUsd: number | null;      // null = non-refundable
  changeable: boolean;
  changeFeeUsd: number | null;
  seatSelection: 'free' | 'fee' | 'not_available';
  seatSelectionFeeUsd: number | null;
  upgradeable: boolean;
  loungeAccess: boolean;
  priorityBoarding: boolean;
  milesEarning: 'full' | 'reduced' | 'none';
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
  offerId: string;           // provider offer id
  cabin: FareCabin;
  name: string;              // e.g. "Economy Basic", "Business Extra"
  basePrice: number;
  totalPrice: number;
  currency: string;
  baggage: FareBaggage;
  policy: FarePolicy;
  aiScore: number;           // 0–100
  aiBadges: AiBadge[];
  aiExplanation: string;     // 1-line human-readable reason
  duffelFareId?: string;
  seatsRemaining?: number;
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
  topPick: AiRecommendation;
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
  name: string;
  basePrice: number;
  totalPrice: number;
  priceProtection: boolean;
  protectionFee: number;
  grandTotal: number;
  currency: string;
}
