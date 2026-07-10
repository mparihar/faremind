/**
 * FareMind Flight Ranking Engine — Public API
 *
 * All public exports for the ranking engine.
 * Import from 'ranking' or 'ranking/index' to use.
 *
 * Usage:
 *   import { rankFlightOffers, explainRanking } from '../ranking';
 *
 *   const result = rankFlightOffers({ searchContext, offers });
 *   const explanation = await explainRanking(result.rankedOffers[0], searchContext, 'international');
 */

// ── Core ranking function ────────────────────────────────────────────────────
export { rankFlightOffers } from './core/rankOffers';

// ── Explanation layer ────────────────────────────────────────────────────────
export { explainRanking, explainTopOffers } from './explanation/explainRanking';
export { buildExplanationPrompt, buildExplanationMessages } from './explanation/buildExplanationPrompt';

// ── Journey type detection ───────────────────────────────────────────────────
export { detectJourneyType, getAirportCountry } from './core/detectJourneyType';

// ── Individual scorers (for testing and extension) ───────────────────────────
export { computePriceScores, normalizePrice } from './core/normalizePrice';
export { scoreSchedule } from './core/scoreSchedule';
export { scoreDuration, computeDurationScores } from './core/scoreDuration';
export { scoreStops } from './core/scoreStops';
export { scoreBaggage } from './core/scoreBaggage';
export { scoreComfort } from './core/scoreComfort';
export { scoreFlexibility, classifyFlexibility, applyChangeableVsRefundableRule } from './core/scoreFlexibility';
export { scoreBrand } from './core/scoreBrand';
export { scoreReliability } from './core/scoreReliability';
export { scoreAirportExperience } from './core/scoreAirportExperience';

// ── Context rules ────────────────────────────────────────────────────────────
export { applyContextRules } from './core/applyContextRules';

// ── Feature extraction ───────────────────────────────────────────────────────
export { extractFeatures } from './core/extractFeatures';

// ── Machine reasons ──────────────────────────────────────────────────────────
export { generateMachineReasons } from './core/generateMachineReasons';

// ── Types ────────────────────────────────────────────────────────────────────
export type {
  RankingInput,
  RankingOutput,
  RankingOffer,
  RankedOffer,
  ScoreBreakdown,
  RankingProfile,
  RankingWeights,
  SearchContext,
  PassengerCount,
  AppliedRule,
  OfferFeatures,
  JourneyType,
  TravelerProfile,
  ConfidenceLevel,
  FlexibilityType,
  ExplanationInput,
  ExplanationOutput,
  RankingAudit,
  CabinClass,
  TripType,
  BrandScoreEntry,
  ScheduleBand,
  LayoverThresholds,
  FlexibilityThreshold,
  RankingOfferSegment,
  RankingOfferBaggage,
  RankingOfferFareRules,
  RankingOfferComfort,
  RankingOfferAncillaries,
} from './types';

export { RANKING_VERSION } from './types';
