// ═══════════════════════════════════════════════════════════════════════════════
// Unified Flight Scoring Engine — Type Definitions
// ═══════════════════════════════════════════════════════════════════════════════
//
// Canonical types for the integrated scoring system that handles ONE_WAY,
// ROUND_TRIP, and future MULTI_CITY through trip-type-specific configuration.

// ── Trip Type ────────────────────────────────────────────────────────────────

export type ScoringTripType = 'ONE_WAY' | 'ROUND_TRIP' | 'MULTI_CITY';

// ── Normalized Flight Offer (provider-neutral input) ─────────────────────────

export interface FlightLeg {
  departureAirport: string;
  arrivalAirport: string;
  departureTime: string;   // ISO 8601
  arrivalTime: string;     // ISO 8601
  durationMinutes: number;
  stops: number;
  layovers: LegLayover[];
  segments: LegSegment[];
}

export interface LegLayover {
  airport: string;
  durationMinutes: number;
  isOvernight?: boolean;
  requiresAirportChange?: boolean;
  isSelfTransfer?: boolean;
}

export interface LegSegment {
  airlineCode: string;
  airlineName: string;
  flightNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
}

export interface BaggageSummary {
  carryOnIncluded: boolean;
  carryOnPieces: number;
  checkedBagsIncluded: number;
  checkedBagCostKnown?: boolean;
  estimatedCheckedBagCost?: number;
  baggageText?: string;
}

export interface FareRuleSummary {
  refundable: boolean;
  changeable: boolean;
  refundPenaltyKnown?: boolean;
  changePenaltyKnown?: boolean;
  rawRulesAvailable?: boolean;
}

export interface ProviderHealthSummary {
  searchSuccessRate?: number;       // 0-100
  revalidationSuccessRate?: number; // 0-100
  bookingSuccessRate?: number;      // 0-100
  apiLatencyMs?: number;
  recentFailures?: number;
}

export interface NormalizedFlightOffer {
  id: string;
  providerCode: string;   // 'duffel' | 'mystifly' | etc.
  providerOfferId?: string;

  tripType: ScoringTripType;

  baseFare: number;
  taxes?: number;
  totalFare: number;
  currency: string;

  effectiveTotalPrice?: number; // computed by EffectivePriceService

  outbound: FlightLeg;
  returnLeg?: FlightLeg;       // present for ROUND_TRIP

  baggage: BaggageSummary;
  fareRules: FareRuleSummary;
  providerHealth?: ProviderHealthSummary;

  cabinClass?: string;
  isInternational: boolean;

  rawProviderOfferJson?: unknown;
}

// ── Scoring Features (extracted, trip-type-aware) ────────────────────────────

export interface ScheduleFeatures {
  outboundDepartureHour: number;  // 0-23
  outboundArrivalHour: number;    // 0-23
  returnDepartureHour?: number;   // round-trip only
  returnArrivalHour?: number;     // round-trip only
}

export interface BaggageFeatures {
  carryOnIncluded: boolean;
  carryOnPieces: number;
  checkedBagsIncluded: number;
  isInternational: boolean;
}

export interface FareFlexibilityFeatures {
  refundable: boolean;
  changeable: boolean;
}

export interface ProviderReliabilityFeatures {
  providerCode: string;
  health?: ProviderHealthSummary;
}

export interface ScoringFeatures {
  offerId: string;
  tripType: ScoringTripType;
  effectiveTotalPrice: number;
  rawTotalPrice: number;           // actual displayed fare (used for Cheapest badge)
  totalDurationMinutes: number;
  totalStops: number;
  outboundStops: number;
  returnStops: number;              // 0 for one-way
  allLayovers: LegLayover[];
  outboundLayovers: LegLayover[];
  returnLayovers: LegLayover[];     // empty for one-way
  schedule: ScheduleFeatures;
  baggage: BaggageFeatures;
  fareFlexibility: FareFlexibilityFeatures;
  providerReliability: ProviderReliabilityFeatures;
  isInternational: boolean;
}

// ── Warning Engine ───────────────────────────────────────────────────────────

export type WarningSeverity = 'MINOR' | 'MEDIUM' | 'MAJOR' | 'CRITICAL';

export interface WarningDetail {
  code: string;
  severity: WarningSeverity;
  points: number;
  message: string;
}

export interface WarningResult {
  warnings: WarningDetail[];
  warningPenalty: number;
  compoundWarningPenalty: number;
  totalPenalty: number;
  aiPickBlocked: boolean;
  aiPickBlockReason?: string;
}

// ── Score Breakdown ──────────────────────────────────────────────────────────

export interface ScoreWeights {
  effectivePriceScore: number;
  durationScore: number;
  stopsScore: number;
  baggageValueScore: number;
  layoverScore: number;
  scheduleScore: number;
  fareFlexibilityScore: number;
  providerReliabilityScore: number;
}

export interface ScoreBreakdownDetail {
  effectivePriceScore: number;       // 0-100
  durationScore: number;             // 0-100
  stopsScore: number;                // 0-100
  baggageValueScore: number;         // 0-100
  layoverScore: number;              // 0-100
  scheduleScore: number;             // 0-100
  fareFlexibilityScore: number;      // 0-100
  providerReliabilityScore: number;  // 0-100

  weights: ScoreWeights;

  effectiveTotalPrice: number;
  totalDurationMinutes: number;
  totalStops: number;

  warningDetails: WarningDetail[];

  /** Refundability upgrade bonus details */
  refundabilityUpgradeBonus?: number;
  refundabilityUpgradePremiumPct?: number;
}

// ── Score Output ─────────────────────────────────────────────────────────────

export interface FlightScoreOutput {
  offerId: string;
  providerCode: string;
  tripType: ScoringTripType;

  aiScoreRaw: number;       // decimal
  aiScoreDisplay: number;   // rounded integer

  baseScore: number;
  finalScore: number;

  warningPenalty: number;
  compoundWarningPenalty: number;

  positiveReasons: string[];
  negativeWarnings: string[];
  compactReason: string;

  rankingTags: string[];
  aiPickEligible: boolean;

  /** If set, describes the comparable-offer consistency adjustment applied. */
  comparableAdjustmentReason?: string;

  scoreBreakdown: ScoreBreakdownDetail;

  /** Refundability upgrade bonus (0 if not applicable) */
  refundabilityUpgradeBonus: number;
  /** ID of the nearest comparable changeable fare used for the upgrade calculation */
  refundabilityUpgradeBaselineId?: string;
}

// ── Ranked Result ────────────────────────────────────────────────────────────

export interface RankedFlightOffer<T = NormalizedFlightOffer> {
  offer: T;
  score: FlightScoreOutput;
  rankPosition: number;
  badges: string[];
}

export interface RankingResult<T = NormalizedFlightOffer> {
  ranked: RankedFlightOffer<T>[];
  filteredOut: Array<{ offer: T; reason: string }>;
  metadata: RankingMetadataDetail;
}

export interface RankingMetadataDetail {
  minPrice: number;
  maxPrice: number;
  fastestDuration: number;
  slowestDuration: number;
  providerCount: number;
  totalOffersRanked: number;
  totalOffersFiltered: number;
  aiPickId?: string;
  cheapestId?: string;
  fastestId?: string;
}

// ── User Preferences ─────────────────────────────────────────────────────────

export type ScoringMode =
  | 'AI_PICK'
  | 'CHEAPEST'
  | 'FASTEST'
  | 'FEWEST_STOPS'
  | 'COMFORT'
  | 'FAMILY'
  | 'ELDERLY'
  | 'FLEXIBLE_FARE'
  | 'BEST_VALUE';

export interface ScoringUserPreferences {
  mode?: ScoringMode;
  budget?: number | null;
  maxDuration?: number | null;         // minutes
  stops?: 'nonstop' | '1stop' | '2stop' | 'any';
  departureWindow?: 'morning' | 'afternoon' | 'evening' | 'night' | null;

  // Traveler context
  carryOnOnly?: boolean;
  needsCheckedBags?: boolean;
  preferNonstop?: boolean;
  avoidRedEye?: boolean;
  avoidTightConnections?: boolean;
  elderlyTraveler?: boolean;
  familyTravel?: boolean;
  firmDates?: boolean;
}

// ── Search Context ───────────────────────────────────────────────────────────

export interface ScoringSearchContext {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengerCount: number;
  cabinClass: string;
  currency: string;
  tripType: ScoringTripType;
}

// ── Effective Price Result ───────────────────────────────────────────────────

export type PriceConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface EffectivePriceResult {
  effectiveTotalPrice: number;
  estimatedAddOnCost: number;
  baggageCostApplied: number;
  confidence: PriceConfidence;
}
