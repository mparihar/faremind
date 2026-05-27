// ─── AI Scoring Engine — Types ────────────────────────────────────────────────

// ── Sort / preset names ──────────────────────────────────────────────────────

export type AiSortMode = 'best_value' | 'cheapest' | 'fastest' | 'fewest_stops' | 'flexible_fare';

export type WeightPresetName =
  | 'best_ai_pick'
  | 'cheapest'
  | 'fastest'
  | 'fewest_stops'
  | 'flexible_fare'
  | 'best_value';

// ── Weight preset ────────────────────────────────────────────────────────────

export interface WeightPreset {
  price:               number; // default 0.35
  duration:            number; // default 0.22
  stops:               number; // default 0.15
  layover:             number; // default 0.10
  schedule:            number; // default 0.08
  baggage:             number; // default 0.04
  fareFlexibility:     number; // default 0.03
  providerReliability: number; // default 0.03
}

// ── Tags & labels ────────────────────────────────────────────────────────────

export type RankingTag =
  | 'AI Pick'
  | 'Cheapest'
  | 'Fastest'
  | 'Fewest Stops'
  | 'Best Value'
  | 'Recommended'
  | 'Better Schedule'
  | 'Long Layover'
  | 'Tight Connection'
  | 'High Price'
  | 'Poor Refund Terms'
  | 'Baggage Included'
  | 'Flexible Fare'
  | 'Provider Review'
  | 'Avoid'
  | 'Near Fastest'
  | 'Long Duration'
  | 'Nonstop';

// Legacy labels — kept for backwards compat with existing badge display
export type AiLabel = '✨ AI Pick' | 'Best Price' | 'Fastest';

// ── User preferences ─────────────────────────────────────────────────────────

export interface AiUserPreferences {
  budget?:          number | null;
  maxDuration?:     number | null; // minutes
  stops?:           'nonstop' | '1stop' | '2stop' | 'any';
  departureWindow?: 'morning' | 'afternoon' | 'evening' | 'night' | null;
  sortMode?:        AiSortMode;
  weightPreset?:    WeightPresetName;
}

// ── Normalised option (internal representation for scoring) ──────────────────

export interface NormalizedOption {
  id:                   string;
  price:                number;
  currency:             string;
  durationMinutes:      number;
  stops:                number;
  airlineCount:         number;
  departureHour:        number;   // 0-23, outbound departure
  arrivalHour:          number;   // 0-23, outbound arrival
  returnDepartureHour:  number | null; // round-trip only
  returnArrivalHour:    number | null; // round-trip only
  layoverMinutes:       number[];
  baggageCarryOn:       number;   // pieces
  baggageChecked:       number;   // pieces
  refundable:           boolean;
  changeable:           boolean;
  providerCode:         string;   // 'duffel' | 'mystifly' | unknown
  isInternational:      boolean;
}

// ── Scoring stats (computed over candidates for normalization) ────────────────

export interface ScoringStats {
  minPrice:     number;
  maxPrice:     number;
  minDuration:  number;
  maxDuration:  number;
  avgDuration:  number;
  p5Price:      number;   // 5th percentile
  p95Price:     number;   // 95th percentile
  p5Duration:   number;   // 5th percentile
  p95Duration:  number;   // 95th percentile
}

// ── Score breakdown (all 8 components, 0-100 scale) ──────────────────────────

export interface AiScoreBreakdown {
  priceScore:               number; // 0-100
  durationScore:            number;
  stopsScore:               number;
  layoverScore:             number;
  scheduleScore:            number;
  baggageScore:             number;
  fareFlexibilityScore:     number;
  providerReliabilityScore: number;
  finalScore:               number; // 0-100 weighted composite
  weights:                  WeightPreset;
}

// ── Scored option (output of the ranking pipeline) ───────────────────────────

export interface AiScoredOption<T> {
  option:          T;
  aiScore:         number;        // 0-100 (rounded display score)
  aiScoreRaw:      number;        // decimal before rounding
  labels:          AiLabel[];     // legacy badge labels
  rankingTags:     RankingTag[];  // rich tags per spec
  aiReasons:       string[];      // 2-4 human-readable reasons
  layoverPenalty:  number;        // 0-1
  filtered:        false;
  scoreBreakdown?: AiScoreBreakdown; // debug / admin only
}

// ── Filtered-out option ──────────────────────────────────────────────────────

export interface AiFilteredOut<T> {
  option:   T;
  reason:   string;
  filtered: true;
}

// ── Ranking result (returned by aiRank*) ─────────────────────────────────────

export interface RankingMetadata {
  minPrice:          number;
  maxPrice:          number;
  fastestDuration:   number;
  slowestDuration:   number;
  providerCount:     number;
  totalOffersRanked: number;
}

export interface AiRankResult<T> {
  ranked:      AiScoredOption<T>[];
  filteredOut: AiFilteredOut<T>[];
  metadata?:   RankingMetadata;
}
