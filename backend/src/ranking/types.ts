/**
 * FareMind Flight Ranking Engine — Type Definitions
 *
 * All types for the unified ranking engine. These are isolated from
 * the existing codebase types and used only within backend/src/ranking/.
 *
 * The engine consumes UnifiedFlight[] from the existing normalizer
 * and produces RankingOutput with full audit data.
 */

// ─── Journey & Trip Types ────────────────────────────────────────────────────

export type JourneyType = 'domestic' | 'international';
export type TripType = 'one_way' | 'round_trip' | 'multi_city';
export type CabinClass = 'economy' | 'premium_economy' | 'business' | 'first';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

// ─── Traveler Profiles ───────────────────────────────────────────────────────

export type TravelerProfile = 'default' | 'business' | 'budget' | 'family' | 'elderly';

// ─── Flexibility Classification ──────────────────────────────────────────────

export type FlexibilityType =
  | 'nonChangeableNonRefundable'
  | 'changeableWithFee'
  | 'changeableNoFee'
  | 'refundableWithFee'
  | 'fullyRefundable';

// ─── Ranking Profile (Configurable) ──────────────────────────────────────────

export interface RankingWeights {
  price: number;
  schedule: number;
  duration: number;
  stops: number;
  baggage: number;
  comfort: number;
  flexibility: number;
  brand: number;
  reliability: number;
  airportExperience: number;
}

export interface FlexibilityThreshold {
  maxPremiumPercent: number;
  valueScore: number;
}

export interface ScheduleBand {
  /** Ideal departure start hour (0-23) */
  idealDepartureStart: number;
  /** Ideal departure end hour (0-23) */
  idealDepartureEnd: number;
  /** Penalty arrival start hour (0-23), e.g. midnight */
  penaltyArrivalStart: number;
  /** Penalty arrival end hour (0-23), e.g. 5am */
  penaltyArrivalEnd: number;
}

export interface LayoverThresholds {
  /** Minutes below which layover is high-risk */
  highRiskMinutes: number;
  /** Good layover range start (minutes) */
  goodRangeStart: number;
  /** Good layover range end (minutes) */
  goodRangeEnd: number;
  /** Acceptable range end (minutes) */
  acceptableRangeEnd: number;
}

export interface RankingProfile {
  profileId: string;
  tripType: JourneyType;
  weights: RankingWeights;
  version: string;
  /** Duration penalty range in minutes */
  durationPenaltyRange: number;
  /** Schedule scoring bands */
  scheduleBand: ScheduleBand;
  /** Layover quality thresholds */
  layoverThresholds: LayoverThresholds;
  /** Flexibility premium thresholds */
  flexibilityThresholds: FlexibilityThreshold[];
  /** Tie-break priority order */
  tieBreakOrder: (keyof RankingWeights)[];
  /** Context rules enable/disable */
  enabledRules: string[];
}

// ─── Search Context (Input) ──────────────────────────────────────────────────

export interface PassengerCount {
  adults: number;
  children: number;
  infants: number;
}

export interface SearchContext {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  tripType: TripType;
  /** Auto-detected or explicit */
  journeyType?: JourneyType;
  cabin: CabinClass;
  currency: string;
  passengers: PassengerCount;
  travelerProfile: TravelerProfile;
}

// ─── Ranking Input ───────────────────────────────────────────────────────────

export interface RankingOfferSegment {
  departureAirport: string;
  arrivalAirport: string;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  airline: string;
  flightNumber: string;
  aircraft?: string;
  departureTerminal?: string;
  arrivalTerminal?: string;
}

export interface RankingOfferBaggage {
  carryOn: number;
  checked: number;
  checkedBagPaidPrice?: number;
}

export interface RankingOfferFareRules {
  refundable: boolean;
  changeable: boolean;
  cancellationFee?: number;
  changeFee?: number;
}

export interface RankingOfferComfort {
  cabinClass: CabinClass;
  fareClassName?: string;
  seatPitch?: number;
  seatSelection?: 'free' | 'fee' | 'not_available';
  wifiAvailable?: boolean;
  mealsIncluded?: boolean;
  entertainmentAvailable?: boolean;
  priorityBoarding?: boolean;
  loungeAccess?: boolean;
}

export interface RankingOfferAncillaries {
  seatSelectionAvailable?: boolean;
  familySeatingAvailable?: boolean;
  mealService?: boolean;
  wifi?: boolean;
  lounge?: boolean;
}

export interface RankingOffer {
  offerId: string;
  provider: string;
  airline: string;
  airlineCode: string;
  totalPrice: number;
  currency: string;
  durationMinutes: number;
  segments: RankingOfferSegment[];
  baggage: RankingOfferBaggage;
  fareRules: RankingOfferFareRules;
  comfort: RankingOfferComfort;
  ancillaries: RankingOfferAncillaries;
  /** Number of stops */
  stops: number;
  /** Seats remaining if known */
  seatsRemaining?: number;
}

export interface RankingInput {
  searchContext: SearchContext;
  offers: RankingOffer[];
}

// ─── Score Breakdown (Output) ────────────────────────────────────────────────

export interface ScoreBreakdown {
  priceScore: number;
  scheduleScore: number;
  durationScore: number;
  stopsScore: number;
  baggageScore: number;
  comfortScore: number;
  flexibilityScore: number;
  brandScore: number;
  reliabilityScore: number;
  airportExperienceScore: number;
}

// ─── Applied Rule ────────────────────────────────────────────────────────────

export interface AppliedRule {
  ruleId: string;
  impact: number;
  reason: string;
}

// ─── Ranked Offer (Output) ───────────────────────────────────────────────────

export interface RankedOffer {
  rank: number;
  offerId: string;
  provider: string;
  airline: string;
  finalScore: number;
  scoreBreakdown: ScoreBreakdown;
  appliedRules: AppliedRule[];
  machineReasons: string[];
  tradeoffs: string[];
  confidence: ConfidenceLevel;
}

// ─── Ranking Output ──────────────────────────────────────────────────────────

export interface RankingOutput {
  rankingVersion: string;
  profileId: string;
  searchContext: SearchContext;
  rankedOffers: RankedOffer[];
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Audit metadata */
  audit: RankingAudit;
}

export interface RankingAudit {
  rankingVersion: string;
  profileId: string;
  configVersion: string;
  inputOfferIds: string[];
  totalOffers: number;
  journeyType: JourneyType;
  currency: string;
  timestamp: string;
  weightsUsed: RankingWeights;
}

// ─── Extracted Features (Internal) ───────────────────────────────────────────

export interface OfferFeatures {
  offerId: string;
  totalPrice: number;
  durationMinutes: number;
  stops: number;
  departureHour: number;
  departureMinute: number;
  arrivalHour: number;
  arrivalMinute: number;
  layoverDurations: number[];
  hasTerminalChange: boolean;
  hasAirportChange: boolean;
  requiresImmigration: boolean;
  longestSegmentMinutes: number;
  cabinClass: CabinClass;
  fareClassName: string;
  checkedBags: number;
  carryOn: number;
  checkedBagPaidPrice?: number;
  refundable: boolean;
  changeable: boolean;
  cancellationFee?: number;
  changeFee?: number;
  seatPitch?: number;
  seatSelection?: 'free' | 'fee' | 'not_available';
  wifiAvailable: boolean;
  mealsIncluded: boolean;
  entertainmentAvailable: boolean;
  priorityBoarding: boolean;
  loungeAccess: boolean;
  familySeatingAvailable: boolean;
  seatSelectionAvailable: boolean;
  airlineCode: string;
  provider: string;
  seatsRemaining?: number;
}

// ─── GPT Explanation ─────────────────────────────────────────────────────────

export interface ExplanationInput {
  rankedOffer: RankedOffer;
  searchContext: SearchContext;
  journeyType: JourneyType;
}

export interface ExplanationOutput {
  headline: string;
  bullets: string[];
  tradeoffSentence?: string;
}

// ─── Brand Score Entry ───────────────────────────────────────────────────────

export interface BrandScoreEntry {
  airlineCode: string;
  airlineName: string;
  score: number;
  tier: 'premium' | 'preferred' | 'standard' | 'low_confidence' | 'unknown';
}

// ─── RANKING_VERSION constant ────────────────────────────────────────────────

export const RANKING_VERSION = 'faremind-ranking-v1.0.0';
