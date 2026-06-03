// ═══════════════════════════════════════════════
// AI Seat Selection Types
// Shared between API route, classifier, and UI
// Provider-agnostic: works with Duffel & Mystifly
// ═══════════════════════════════════════════════

import type { Provider } from '@/lib/types';

// ─── Zone / Type enums ────────────────────────────────────────────────────────

export type CabinZone = 'front' | 'middle' | 'rear';
export type SeatTypeClass = 'window' | 'aisle' | 'middle' | 'unknown';
export type RestroomZone = 'near_restroom' | 'away_restroom' | 'neutral';

// ─── User preference (sent to API) ───────────────────────────────────────────

export interface SeatPreferenceInput {
  cabinZone: CabinZone | 'any';
  restroomPreference: 'near_restroom' | 'away_restroom' | 'neutral';
  seatType: SeatTypeClass | 'any';
}

// ─── Classified seat (from any provider's seat map) ──────────────────────────

export interface ClassifiedSeat {
  seatId: string;
  seatServiceId: string | null;     // Duffel service ID or Mystifly SeatSelectionKey
  seatServiceIds: string[];          // All per-passenger service IDs for multi-pax booking
  seatNumber: string;               // e.g. "24A"
  rowNumber: number;
  column: string;                   // e.g. "A"
  segmentId: string;

  available: boolean;
  occupied: boolean;
  price: number;
  currency: string;

  cabinZone: CabinZone;
  seatType: SeatTypeClass;
  restroomZone: RestroomZone;

  score: number;
  reason: string;

  disclosures: string[];
}

// ─── Recommended seat (scored + ranked) ──────────────────────────────────────

export interface RecommendedSeat extends ClassifiedSeat {
  rank: number;
}

// ─── API request / response ──────────────────────────────────────────────────

export interface SeatRecommendationRequest {
  offerId: string;                  // Duffel offerId or Mystifly FareSourceCode
  provider: Provider;               // 'duffel' | 'mystifly' | 'amadeus'
  preference: SeatPreferenceInput;
  segmentIndex?: number;            // 0 = outbound (default), 1 = return
  excludeSeats?: string[];          // seat numbers to exclude (already selected by other pax)
}

export interface SeatRecommendationResponse {
  recommendedSeats: RecommendedSeat[];
  seats: RecommendedSeat[];         // alias for recommendedSeats
  totalAvailable: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
  consecutive?: boolean;            // true when auto-assigned consecutive seats
  error?: string;
}

// ─── Selected seat (stored in AI booking session) ────────────────────────────

export interface SelectedSeatData {
  seatNumber: string;
  seatServiceId: string | null;
  seatServiceIds: string[];          // All per-passenger service IDs
  segmentId: string;
  rowNumber: number;
  column: string;
  cabinZone: CabinZone;
  seatType: SeatTypeClass;
  restroomZone: RestroomZone;
  price: number;
  currency: string;
  reason: string;
}

// ─── Group seat allocation (multi-pax) ───────────────────────────────────────

export type AreaPreference = CabinZone | 'near_restroom' | 'away_restroom' | 'any';

export interface GroupSeatBlock {
  blockId: string;                   // e.g. "outbound-row-13-A-D"
  seats: ClassifiedSeat[];           // exactly passengerCount seats
  rowNumbers: number[];              // unique rows (usually 1, possibly 2 for split)
  totalPrice: number;
  currency: string;
  cabinZoneSummary: string;          // e.g. "Middle cabin"
  restroomZoneSummary: string;       // e.g. "Away from restroom"
  startsWithSeatType: string;        // e.g. "Window"
  sameRow: boolean;                  // true if all seats in one row
  matchScore: number;                // scoring for ranking
  reason: string;                    // human-readable summary
}

export interface GroupSeatRequest {
  offerId: string;
  provider: Provider;
  segmentIndex: number;
  passengerCount: number;
  areaPreference: AreaPreference;
  seatTypePreference: SeatTypeClass | 'any';
}

export interface GroupSeatResponse {
  options: GroupSeatBlock[];
  totalAvailable: number;
  fallbackLevel: number;             // 0 = exact, 1-4 = relaxed, 5 = individual
  fallbackReason?: string;
  error?: string;
}
