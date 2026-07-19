// ═══════════════════════════════════════════════════════════════════════════════
// Unified Flight Scoring Engine — Core Scorer
// ═══════════════════════════════════════════════════════════════════════════════
//
// Single entry point: scoreFlightOffer(offer, tripType, userPrefs, searchContext)
// Handles ONE_WAY, ROUND_TRIP, and future MULTI_CITY through config.
//
// 8 scoring dimensions:
//   1. Effective Price (effective fare incl. estimated bag costs)
//   2. Duration
//   3. Stops
//   4. Baggage Value
//   5. Layover Quality
//   6. Schedule Convenience
//   7. Fare Flexibility
//   8. Provider Reliability
//
// + Warning penalties (warningPenalty + compoundWarningPenalty)
// = finalScore

import type {
  NormalizedFlightOffer,
  ScoringTripType,
  ScoringUserPreferences,
  ScoringSearchContext,
  FlightScoreOutput,
  ScoringFeatures,
  ScoreWeights,
} from './FlightScoringTypes';
import { getAdjustedWeights, AI_PICK_MIN_SCORE, FLIGHT_SCORING_CONFIG } from './FlightScoringConfig';
import { extractScoringFeatures } from './FlightFeatureExtractor';
import { calculateEffectivePrice } from './FlightEffectivePriceService';
import { generateWarnings, type WarningSearchStats } from './FlightWarningEngine';
import { getProviderReliabilityScore } from './FlightProviderReliabilityService';
import { clamp, clippedNorm, percentile } from './FlightScoringUtils';

// ── Scoring Stats (computed over all offers in the search) ───────────────────

export interface ScoringStats {
  minPrice: number;
  maxPrice: number;
  minDuration: number;
  maxDuration: number;
  avgDuration: number;
  p5Price: number;
  p95Price: number;
  p5Duration: number;
  p95Duration: number;
  minStops: number;
  hasNonstop: boolean;
}

/**
 * Compute search-level statistics from extracted features.
 */
export function computeScoringStats(allFeatures: ScoringFeatures[]): ScoringStats {
  if (allFeatures.length === 0) {
    return {
      minPrice: 0, maxPrice: 0,
      minDuration: 0, maxDuration: 0, avgDuration: 0,
      p5Price: 0, p95Price: 0,
      p5Duration: 0, p95Duration: 0,
      minStops: 0, hasNonstop: false,
    };
  }

  const prices = allFeatures.map(f => f.effectiveTotalPrice).sort((a, b) => a - b);
  const durations = allFeatures.map(f => f.totalDurationMinutes).sort((a, b) => a - b);
  const stopCounts = allFeatures.map(f => f.totalStops);

  return {
    minPrice:    prices[0],
    maxPrice:    prices[prices.length - 1],
    minDuration: durations[0],
    maxDuration: durations[durations.length - 1],
    avgDuration: durations.reduce((s, d) => s + d, 0) / durations.length,
    p5Price:     percentile(prices, 5),
    p95Price:    percentile(prices, 95),
    p5Duration:  percentile(durations, 5),
    p95Duration: percentile(durations, 95),
    minStops:    Math.min(...stopCounts),
    hasNonstop:  stopCounts.some(s => s === 0),
  };
}

// ─── 1. Effective Price Score ────────────────────────────────────────────────

function scoreEffectivePrice(features: ScoringFeatures, stats: ScoringStats): number {
  let score = clippedNorm(features.effectiveTotalPrice, stats.p5Price, stats.p95Price) * 100;

  // Cheapest → always 100
  if (stats.minPrice > 0 && features.effectiveTotalPrice <= stats.minPrice) {
    score = 100;
  }

  // Guardrails
  if (stats.minPrice > 0) {
    const pctAbove = (features.effectiveTotalPrice - stats.minPrice) / stats.minPrice;
    if (pctAbove <= 0.03) score = Math.max(score, 93);
    else if (pctAbove <= 0.05) score = Math.max(score, 88);
    else if (pctAbove > 0.10 && pctAbove <= 0.20) {
      score = Math.max(0, score - Math.min((pctAbove - 0.10) * 60, 10));
    } else if (pctAbove > 0.20) {
      score = Math.max(0, score - Math.min((pctAbove - 0.20) * 100, 25));
    }
  }

  return clamp(score, 0, 100);
}

// ─── 2. Duration Score ──────────────────────────────────────────────────────

function scoreDuration(features: ScoringFeatures, stats: ScoringStats): number {
  const score = clippedNorm(features.totalDurationMinutes, stats.p5Duration, stats.p95Duration) * 100;
  return clamp(score, 0, 100);
}

// ─── 3. Stops Score ─────────────────────────────────────────────────────────

function scoreStops(features: ScoringFeatures): number {
  const totalStops = features.totalStops;
  // Unified table per spec §9
  switch (totalStops) {
    case 0:  return 100;
    case 1:  return 85;
    case 2:  return 72;
    case 3:  return 58;
    case 4:  return 45;
    default: return 30;
  }
}

// ─── 4. Baggage Value Score ─────────────────────────────────────────────────

function scoreBaggageValue(
  features: ScoringFeatures,
  prefs?: ScoringUserPreferences | null,
): number {
  const bag = features.baggage;
  let score: number;

  if (bag.checkedBagsIncluded >= 2 && bag.carryOnIncluded) {
    score = 100;
  } else if (bag.checkedBagsIncluded === 1 && bag.carryOnIncluded) {
    score = 90;
  } else if (bag.carryOnIncluded && bag.checkedBagsIncluded === 0) {
    score = 70;
  } else if (!bag.carryOnIncluded && bag.checkedBagsIncluded === 0) {
    score = bag.isInternational ? 42 : 50;
  } else if (bag.checkedBagsIncluded > 0 && !bag.carryOnIncluded) {
    score = 60; // unusual: checked but no carry-on stated
  } else {
    score = 55; // fallback / unclear
  }

  // User preference adjustments
  if (prefs?.carryOnOnly && bag.checkedBagsIncluded === 0) {
    // Reduce checked bag penalty by 50% — user doesn't need checked bags
    score = Math.min(100, score + (100 - score) * 0.5);
  }
  if ((prefs?.familyTravel || prefs?.elderlyTraveler) && bag.checkedBagsIncluded === 0) {
    // Family/elderly need bags more
    score = Math.max(0, score - 10);
  }

  return clamp(score, 0, 100);
}

// ─── 5. Layover Score ───────────────────────────────────────────────────────

function scoreLayover(features: ScoringFeatures): number {
  if (features.allLayovers.length === 0) return 100; // nonstop

  let score = 100;

  for (const lv of features.allLayovers) {
    if (features.isInternational) {
      if (lv.durationMinutes < 75)       score -= 25;
      else if (lv.durationMinutes < 90)  score -= 10;
      else if (lv.durationMinutes > 480) score -= 30;
      else if (lv.durationMinutes > 300) score -= 15;
    } else {
      if (lv.durationMinutes < 45)       score -= 25;
      else if (lv.durationMinutes < 60)  score -= 10;
      else if (lv.durationMinutes > 480) score -= 30;
      else if (lv.durationMinutes > 300) score -= 15;
    }

    // Overnight layover penalty
    if (lv.isOvernight || lv.durationMinutes > 600) score -= 35;

    // Airport change / self-transfer
    if (lv.requiresAirportChange) score -= 30;
    if (lv.isSelfTransfer) score -= 30;
  }

  return clamp(score, 0, 100);
}

// ─── 6. Schedule Score ──────────────────────────────────────────────────────

function isRedEye(depHour: number, arrHour: number): boolean {
  return (depHour >= 21 || depHour < 1) && (arrHour >= 4 && arrHour <= 9);
}

function scoreSchedule(
  features: ScoringFeatures,
  prefs?: ScoringUserPreferences | null,
): number {
  let score = 100;
  const sched = features.schedule;

  // Outbound
  if (isRedEye(sched.outboundDepartureHour, sched.outboundArrivalHour)) {
    score -= prefs?.avoidRedEye ? 15 : 10;
  }
  if (sched.outboundDepartureHour >= 0 && sched.outboundDepartureHour < 6) {
    score -= (prefs?.elderlyTraveler || prefs?.familyTravel) ? 12 : 8;
  }
  if (sched.outboundArrivalHour >= 23) score -= 8;
  if (sched.outboundArrivalHour >= 0 && sched.outboundArrivalHour < 5) {
    score -= features.isInternational ? 6 : 12;
  }

  // Return (if present)
  if (sched.returnDepartureHour != null && sched.returnArrivalHour != null) {
    if (isRedEye(sched.returnDepartureHour, sched.returnArrivalHour)) {
      score -= prefs?.avoidRedEye ? 15 : 10;
    }
    if (sched.returnDepartureHour >= 0 && sched.returnDepartureHour < 6) {
      score -= (prefs?.elderlyTraveler || prefs?.familyTravel) ? 12 : 8;
    }
    if (sched.returnArrivalHour >= 23) score -= 8;
    if (sched.returnArrivalHour >= 0 && sched.returnArrivalHour < 5) {
      score -= features.isInternational ? 6 : 12;
    }
  }

  return clamp(score, 0, 100);
}

// ─── 7. Fare Flexibility Score ──────────────────────────────────────────────

function scoreFareFlexibility(
  features: ScoringFeatures,
  prefs?: ScoringUserPreferences | null,
): number {
  const { refundable, changeable } = features.fareFlexibility;

  let score: number;
  if (refundable && changeable) score = 100;
  else if (!refundable && changeable) score = 75;
  else if (refundable && !changeable) score = 80;
  else if (!refundable && !changeable) score = 40;
  else score = 60; // unknown

  // If user's dates are firm, reduce penalty for non-flexibility
  if (prefs?.firmDates && score < 60) {
    score = Math.min(100, score + 20);
  }

  return clamp(score, 0, 100);
}

// ─── 8. Provider Reliability Score ──────────────────────────────────────────

function scoreProviderReliability(features: ScoringFeatures): number {
  return getProviderReliabilityScore(
    features.providerReliability.providerCode,
    features.providerReliability.health,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// scoreFlightOffer — The unified entry point
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Score a single flight offer using the unified 8-dimension scoring engine.
 *
 * This is the canonical scoring function for FareMind.
 * It handles ONE_WAY, ROUND_TRIP, and future MULTI_CITY by loading
 * trip-type-specific configuration.
 *
 * @param offer       - Normalized flight offer (provider-neutral)
 * @param tripType    - Trip type for config selection
 * @param prefs       - User preferences (optional)
 * @param stats       - Search-level statistics for normalization
 * @param searchContext - Optional search context
 */
export function scoreFlightOffer(
  offer: NormalizedFlightOffer,
  tripType: ScoringTripType,
  prefs: ScoringUserPreferences | null | undefined,
  stats: ScoringStats,
  searchContext?: ScoringSearchContext,
): FlightScoreOutput {
  // 1. Calculate effective price
  const effectivePriceResult = calculateEffectivePrice(offer, tripType, prefs, searchContext);
  offer.effectiveTotalPrice = effectivePriceResult.effectiveTotalPrice;

  // 2. Extract features
  const features = extractScoringFeatures(offer, tripType, searchContext);

  // 3. Get adjusted weights
  const weights = getAdjustedWeights(tripType, prefs, offer.isInternational);

  // 4. Score all 8 dimensions
  const effectivePriceScoreVal      = scoreEffectivePrice(features, stats);
  const durationScoreVal            = scoreDuration(features, stats);
  const stopsScoreVal               = scoreStops(features);
  const baggageValueScoreVal        = scoreBaggageValue(features, prefs);
  const layoverScoreVal             = scoreLayover(features);
  const scheduleScoreVal            = scoreSchedule(features, prefs);
  const fareFlexibilityScoreVal     = scoreFareFlexibility(features, prefs);
  const providerReliabilityScoreVal = scoreProviderReliability(features);

  // 5. Weighted composite
  let baseScore =
    effectivePriceScoreVal      * weights.effectivePriceScore +
    durationScoreVal            * weights.durationScore +
    stopsScoreVal               * weights.stopsScore +
    baggageValueScoreVal        * weights.baggageValueScore +
    layoverScoreVal             * weights.layoverScore +
    scheduleScoreVal            * weights.scheduleScore +
    fareFlexibilityScoreVal     * weights.fareFlexibilityScore +
    providerReliabilityScoreVal * weights.providerReliabilityScore;

  // Soft constraints
  if (prefs?.budget && prefs.budget > 0 && features.effectiveTotalPrice > prefs.budget) {
    const overPct = (features.effectiveTotalPrice - prefs.budget) / prefs.budget;
    baseScore = Math.max(0, baseScore - Math.min(overPct * 30, 25));
  }
  if (prefs?.maxDuration && prefs.maxDuration > 0 && features.totalDurationMinutes > prefs.maxDuration) {
    const overPct = (features.totalDurationMinutes - prefs.maxDuration) / prefs.maxDuration;
    baseScore = Math.max(0, baseScore - Math.min(overPct * 25, 20));
  }
  if (prefs?.stops === 'nonstop' && features.totalStops > 0) {
    baseScore *= 0.6;
  } else if (prefs?.stops === '1stop' && features.totalStops > 1) {
    baseScore *= 0.75;
  } else if (prefs?.stops === '2stop' && features.totalStops > 2) {
    baseScore *= 0.80;
  }

  baseScore = clamp(baseScore, 0, 100);

  // 6. Generate warnings
  const warningStats: WarningSearchStats = {
    minPrice: stats.minPrice,
    maxPrice: stats.maxPrice,
    minDuration: stats.minDuration,
    maxDuration: stats.maxDuration,
    minStops: stats.minStops,
    hasNonstop: stats.hasNonstop,
  };
  const warningResult = generateWarnings(features, tripType, warningStats, prefs);

  // 7. Final score = base - penalties
  const finalScore = clamp(
    baseScore - warningResult.warningPenalty - warningResult.compoundWarningPenalty,
    0,
    100,
  );

  // 8. AI Pick eligibility
  const aiPickEligible = !warningResult.aiPickBlocked && finalScore >= AI_PICK_MIN_SCORE;

  return {
    offerId: offer.id,
    providerCode: offer.providerCode,
    tripType,
    aiScoreRaw: Math.round(finalScore * 100) / 100,
    aiScoreDisplay: Math.round(finalScore),
    baseScore: Math.round(baseScore * 100) / 100,
    finalScore: Math.round(finalScore * 100) / 100,
    warningPenalty: warningResult.warningPenalty,
    compoundWarningPenalty: warningResult.compoundWarningPenalty,
    positiveReasons: [],  // filled by ReasonGenerator in pipeline
    negativeWarnings: [], // filled by ReasonGenerator in pipeline
    compactReason: '',    // filled by ReasonGenerator in pipeline
    rankingTags: [],      // filled by BadgeEngine in pipeline
    aiPickEligible,
    refundabilityUpgradeBonus: 0, // set by RefundabilityUpgradeRule in pipeline
    scoreBreakdown: {
      effectivePriceScore:      Math.round(effectivePriceScoreVal),
      durationScore:            Math.round(durationScoreVal),
      stopsScore:               Math.round(stopsScoreVal),
      baggageValueScore:        Math.round(baggageValueScoreVal),
      layoverScore:             Math.round(layoverScoreVal),
      scheduleScore:            Math.round(scheduleScoreVal),
      fareFlexibilityScore:     Math.round(fareFlexibilityScoreVal),
      providerReliabilityScore: Math.round(providerReliabilityScoreVal),
      weights,
      effectiveTotalPrice: features.effectiveTotalPrice,
      totalDurationMinutes: features.totalDurationMinutes,
      totalStops: features.totalStops,
      warningDetails: warningResult.warnings,
    },
  };
}
