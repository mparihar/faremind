// ─── AI Scoring Engine — Public Exports ──────────────────────────────────────

// ── Unified Pipeline (NEW — preferred) ──────────────────────────────────────
export { rankFlightOffers } from './engine';
export { scoreFlightOffer, computeScoringStats } from './FlightScoringEngine';

// ── Backward-compatible exports (LEGACY — use rankFlightOffers instead) ─────
export { aiRank, aiRankOneWay, aiRankRoundTrip } from './engine';

// ── Old types (still used by existing consumers during migration) ────────────
export type {
  AiUserPreferences,
  AiScoredOption,
  AiFilteredOut,
  AiRankResult,
  AiScoreBreakdown,
  AiSortMode,
  RankingTag,
  RankingMetadata,
  WeightPresetName,
} from './types';

// ── New types ────────────────────────────────────────────────────────────────
export type {
  NormalizedFlightOffer,
  ScoringTripType,
  ScoringUserPreferences,
  FlightScoreOutput,
  ScoringFeatures,
  WarningDetail,
  WarningResult,
  ScoreWeights,
  ScoreBreakdownDetail,
  RankedFlightOffer,
  RankingResult,
  RankingMetadataDetail,
  ScoringMode,
  ScoringSearchContext,
} from './FlightScoringTypes';

// ── Adapter functions ────────────────────────────────────────────────────────
export { unifiedFlightToOffer, roundTripOptionToOffer } from './normalize';

// ── Comparable-offer consistency validator ────────────────────────────────────
export { validateComparableOffers } from './FlightComparableValidator';
export type { ComparableCandidate, ComparableAdjustment, ComparableValidationResult } from './FlightComparableValidator';
