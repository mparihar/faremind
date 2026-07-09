// ─── AI Intelligence Ranking Engine ──────────────────────────────────────────
//
// Entry point: aiRank()
// Pipeline: normalize → stats → qualityFilter → score → tags → reasons →
//           tieBreak → scoreSpread → sort
//
// Activates ONLY when caller passes aiIntelligence = true.

import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';
import type {
  AiUserPreferences,
  AiScoredOption,
  AiFilteredOut,
  AiRankResult,
  AiScoreBreakdown,
  AiSortMode,
  AiLabel,
  RankingTag,
  ScoringStats,
  NormalizedOption,
  RankingMetadata,
} from './types';
import { normalizeOneWay, normalizeRoundTrip } from './normalize';
import { qualityFilter } from './quality-filter';
import { computeScore } from './scorer';
import { assignTags } from './tags';
import { generateReasons as generateReasonsLegacy } from './reasons';
import { computeStats } from './stats';

// ── New unified pipeline imports ─────────────────────────────────────────────
import type {
  NormalizedFlightOffer,
  ScoringTripType,
  ScoringUserPreferences,
  ScoringSearchContext,
  FlightScoreOutput,
  ScoringFeatures,
  RankedFlightOffer,
  RankingResult,
  RankingMetadataDetail,
} from './FlightScoringTypes';
import { unifiedFlightToOffer, roundTripOptionToOffer } from './normalize';
import { extractScoringFeatures } from './FlightFeatureExtractor';
import { calculateEffectivePrice } from './FlightEffectivePriceService';
import { scoreFlightOffer, computeScoringStats } from './FlightScoringEngine';
import { tieBreakSort as tieBreakSortNew, applyScoreSpreading as applyScoreSpreadingNew, type TieBreakCandidate } from './FlightTieBreaker';
import { assignBadges as assignBadgesNew, type BadgeCandidate } from './FlightBadgeEngine';
import { generateReasons as generateReasonsNew } from './FlightReasonGenerator';
import { DEFAULT_AI_RECOMMENDATION_LIMIT } from './FlightScoringConfig';
import { validateComparableOffers, type ComparableCandidate } from './FlightComparableValidator';
import { validateComparableNonstops, type NonstopComparableCandidate } from './FlightComparableNonstopValidator';
import { validateRefundablePriority, type RefundablePriorityCandidate } from './FlightRefundablePriorityValidator';
import type { TravelDnaRecommendationContext } from '@/lib/services/travel-dna-service';

// ── Internal intermediate type ────────────────────────────────────────────────

interface Candidate<T> {
  option:        T;
  norm:          NormalizedOption;
  layoverPenalty: number;
}

// ── Tie-Breaking (spec §13) ──────────────────────────────────────────────────

function tieBreakSort<T>(
  scored: Array<{ option: T; norm: NormalizedOption; score: number; breakdown: AiScoreBreakdown }>,
): void {
  scored.sort((a, b) => {
    // Primary: higher score wins
    const scoreDiff = b.score - a.score;
    if (Math.abs(scoreDiff) > 2) return scoreDiff;

    // Tie-break 1: lower total price
    const priceDiff = a.norm.price - b.norm.price;
    if (Math.abs(priceDiff) / Math.max(a.norm.price, 1) > 0.02) return priceDiff;

    // Tie-break 2: shorter total duration
    const durDiff = a.norm.durationMinutes - b.norm.durationMinutes;
    if (Math.abs(durDiff) > 30) return durDiff;

    // Tie-break 3: fewer stops
    if (a.norm.stops !== b.norm.stops) return a.norm.stops - b.norm.stops;

    // Tie-break 4: better baggage
    const bagA = a.norm.baggageCarryOn + a.norm.baggageChecked * 2;
    const bagB = b.norm.baggageCarryOn + b.norm.baggageChecked * 2;
    if (bagA !== bagB) return bagB - bagA;

    // Tie-break 5: better refund/change
    const flexA = (a.norm.refundable ? 2 : 0) + (a.norm.changeable ? 1 : 0);
    const flexB = (b.norm.refundable ? 2 : 0) + (b.norm.changeable ? 1 : 0);
    if (flexA !== flexB) return flexB - flexA;

    // Tie-break 6: provider reliability
    const relDiff = b.breakdown.providerReliabilityScore - a.breakdown.providerReliabilityScore;
    if (relDiff !== 0) return relDiff;

    // Tie-break 7: earliest reasonable departure (6AM-10PM preferred)
    return a.norm.departureHour - b.norm.departureHour;
  });
}

// ── Score Spreading (spec §20) ───────────────────────────────────────────────
//
// Only the best offer should get near 100. Near-identical offers should
// spread: 100, 98, 96, 95, etc. rather than all showing 100.

function applyScoreSpreading(
  items: Array<{ scoreRaw: number }>,
): void {
  if (items.length < 2) return;

  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1].scoreRaw;
    const curr = items[i].scoreRaw;

    // If current score is within 1 point of previous, force at least 1 point gap
    if (prev - curr < 1 && prev > curr) {
      items[i].scoreRaw = prev - 1;
    } else if (curr >= prev) {
      // Same or higher than previous (shouldn't happen after sort, but safety)
      items[i].scoreRaw = prev - 1;
    }

    // Floor at 0
    items[i].scoreRaw = Math.max(0, items[i].scoreRaw);
  }
}

// ── Sort by mode ─────────────────────────────────────────────────────────────

function sortByMode<T>(
  scored:  AiScoredOption<T>[],
  toNorm:  (t: T) => NormalizedOption,
  mode:    AiSortMode = 'best_value',
): AiScoredOption<T>[] {
  const copy = [...scored];
  switch (mode) {
    case 'cheapest':
      return copy.sort((a, b) => toNorm(a.option).price - toNorm(b.option).price);
    case 'fastest':
      return copy.sort((a, b) => toNorm(a.option).durationMinutes - toNorm(b.option).durationMinutes);
    case 'fewest_stops':
      return copy.sort((a, b) => {
        const sa = toNorm(a.option), sb = toNorm(b.option);
        return sa.stops !== sb.stops ? sa.stops - sb.stops : sa.price - sb.price;
      });
    default: // best_value / flexible_fare
      return copy.sort((a, b) => b.aiScore - a.aiScore);
  }
}

// ── Core pipeline (generic, works for any T) ─────────────────────────────────

function aiRankCore<T>(
  options: T[],
  toNorm:  (t: T) => NormalizedOption,
  prefs:   AiUserPreferences,
  debug:   boolean,
  tripType: 'one_way' | 'round_trip' = 'round_trip',
): AiRankResult<T> {
  if (!options.length) return { ranked: [], filteredOut: [] };

  const allNormed = options.map(o => ({ option: o, norm: toNorm(o) }));
  const minDurationAll = Math.min(...allNormed.map(n => n.norm.durationMinutes));

  // ── Step 1: Quality filter ───────────────────────────────────────────────
  const candidates: Candidate<T>[] = [];
  const filteredOut: AiFilteredOut<T>[] = [];

  for (const { option, norm } of allNormed) {
    const qr = qualityFilter(norm, minDurationAll);
    if (!qr.pass) {
      filteredOut.push({ option, reason: qr.reason!, filtered: true });
    } else {
      candidates.push({ option, norm, layoverPenalty: qr.layoverPenalty });
    }
  }

  if (!candidates.length) return { ranked: [], filteredOut };

  // ── Step 2: Compute percentile-clipped stats ─────────────────────────────
  const stats = computeStats(candidates.map(c => c.norm));

  // ── Step 3: Score each candidate ─────────────────────────────────────────
  const interims = candidates.map(c => {
    const breakdown = computeScore(c.norm, stats, prefs, tripType);
    return {
      option: c.option,
      norm: c.norm,
      score: breakdown.finalScore,
      scoreRaw: breakdown.finalScore,
      breakdown,
      layoverPenalty: c.layoverPenalty,
    };
  });

  // ── Step 4: Tie-breaking sort ────────────────────────────────────────────
  tieBreakSort(interims);

  // ── Step 5: Score spreading ──────────────────────────────────────────────
  applyScoreSpreading(interims);

  // ── Step 6: Assign tags ──────────────────────────────────────────────────
  const tagInputs = interims.map(i => ({
    norm: i.norm,
    breakdown: i.breakdown,
    score: Math.round(i.scoreRaw),
  }));
  const tagMap = assignTags(tagInputs, stats);

  // ── Step 7: Generate reasons ─────────────────────────────────────────────
  const scored: AiScoredOption<T>[] = interims.map(i => {
    const tagResult = tagMap.get(i.norm.id) ?? { rankingTags: [], labels: [] };
    const reasons = generateReasonsLegacy(i.norm, i.breakdown, tagResult.rankingTags, stats);

    return {
      option:         i.option,
      aiScore:        Math.round(i.scoreRaw),
      aiScoreRaw:     Math.round(i.scoreRaw * 100) / 100,
      labels:         tagResult.labels,
      rankingTags:    tagResult.rankingTags,
      aiReasons:      reasons,
      layoverPenalty: i.layoverPenalty,
      filtered:       false as const,
      scoreBreakdown: debug ? i.breakdown : undefined,
    };
  });

  // ── Step 8: Sort by user mode ────────────────────────────────────────────
  const sorted = sortByMode(scored, toNorm, prefs.sortMode);

  // ── Build metadata ───────────────────────────────────────────────────────
  const providerCodes = new Set(candidates.map(c => c.norm.providerCode));
  const metadata: RankingMetadata = {
    minPrice:          stats.minPrice,
    maxPrice:          stats.maxPrice,
    fastestDuration:   stats.minDuration,
    slowestDuration:   stats.maxDuration,
    providerCount:     providerCodes.size,
    totalOffersRanked: candidates.length,
  };

  return { ranked: sorted, filteredOut, metadata };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function aiRankOneWay(
  flights: UnifiedFlight[],
  prefs:   AiUserPreferences,
  debug =  false,
): AiRankResult<UnifiedFlight> {
  return aiRankCore(flights, normalizeOneWay, prefs, debug, 'one_way');
}

export function aiRankRoundTrip(
  options: RoundTripOption[],
  prefs:   AiUserPreferences,
  debug =  false,
): AiRankResult<RoundTripOption> {
  return aiRankCore(options, normalizeRoundTrip, prefs, debug);
}

/** Unified entry point — dispatches to the correct typed overload. */
export function aiRank(
  options:  UnifiedFlight[],
  prefs:    AiUserPreferences,
  tripType: 'oneway',
  debug?:   boolean,
): AiRankResult<UnifiedFlight>;
export function aiRank(
  options:  RoundTripOption[],
  prefs:    AiUserPreferences,
  tripType: 'roundtrip',
  debug?:   boolean,
): AiRankResult<RoundTripOption>;
export function aiRank(
  options:  UnifiedFlight[] | RoundTripOption[],
  prefs:    AiUserPreferences,
  tripType: 'oneway' | 'roundtrip',
  debug =   false,
): AiRankResult<UnifiedFlight> | AiRankResult<RoundTripOption> {
  return tripType === 'roundtrip'
    ? aiRankRoundTrip(options as RoundTripOption[], prefs, debug)
    : aiRankOneWay(options as UnifiedFlight[], prefs, debug);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Unified Pipeline — rankFlightOffers
// ═══════════════════════════════════════════════════════════════════════════════
//
// New unified entry point that uses the integrated scoring engine.
// Handles both ONE_WAY and ROUND_TRIP through trip-type configuration.



/**
 * Quality filter for the unified pipeline.
 * Removes invalid/extreme offers before scoring.
 */
function qualityFilterOffer(
  offer: NormalizedFlightOffer,
  features: ScoringFeatures,
  minDuration: number,
): { pass: boolean; reason?: string } {
  if (offer.totalFare <= 0 || features.totalDurationMinutes <= 0) {
    return { pass: false, reason: 'Invalid offer (missing price or duration)' };
  }

  // Hard filter: short layovers (< 45 min)
  for (const lv of features.allLayovers) {
    if (lv.durationMinutes < 45) {
      return { pass: false, reason: `Layover too short (${Math.round(lv.durationMinutes)} min)` };
    }
  }

  // Hard filter: duration > 2× fastest
  if (minDuration > 0 && features.totalDurationMinutes > minDuration * 2) {
    return { pass: false, reason: 'Total duration exceeds 2× fastest option' };
  }

  return { pass: true };
}

/**
 * Convert AiUserPreferences (old format) to ScoringUserPreferences (new format).
 */
function convertPrefs(prefs?: AiUserPreferences | null): ScoringUserPreferences | null {
  if (!prefs) return null;
  const modeMap: Record<string, ScoringUserPreferences['mode']> = {
    best_value: 'BEST_VALUE',
    cheapest: 'CHEAPEST',
    fastest: 'FASTEST',
    fewest_stops: 'FEWEST_STOPS',
    flexible_fare: 'FLEXIBLE_FARE',
    best_ai_pick: 'AI_PICK',
  };
  return {
    mode: modeMap[prefs.weightPreset ?? prefs.sortMode ?? 'best_value'] ?? 'AI_PICK',
    budget: prefs.budget ?? null,
    maxDuration: prefs.maxDuration ?? null,
    stops: prefs.stops,
    departureWindow: prefs.departureWindow,
  };
}

/**
 * Unified ranking pipeline for both ONE_WAY and ROUND_TRIP.
 *
 * Accepts the original FareMind types (UnifiedFlight[] or RoundTripOption[])
 * and returns an AiRankResult compatible with the existing frontend.
 *
 * @param selectedCabinClasses — When provided, scoring stats (price percentiles,
 *        duration ranges) are computed only from offers in these cabin classes.
 *        This ensures business class flights are scored against other business
 *        class flights, not penalised relative to economy.
 */
export function rankFlightOffers<T extends UnifiedFlight | RoundTripOption>(
  offers: T[],
  tripType: ScoringTripType,
  prefs?: AiUserPreferences | null,
  debug = false,
  selectedCabinClasses?: Set<string>,
  travelDnaContext?: TravelDnaRecommendationContext | null,
): AiRankResult<T> {
  if (!offers.length) return { ranked: [], filteredOut: [] };

  const scoringPrefs = convertPrefs(prefs);

  // 1. Convert to NormalizedFlightOffer
  const normalizedOffers: Array<{ original: T; normalized: NormalizedFlightOffer }> =
    offers.map(o => ({
      original: o,
      normalized: tripType === 'ROUND_TRIP'
        ? roundTripOptionToOffer(o as unknown as RoundTripOption)
        : unifiedFlightToOffer(o as unknown as UnifiedFlight),
    }));

  // 2. Calculate effective prices
  for (const { normalized } of normalizedOffers) {
    const epResult = calculateEffectivePrice(normalized, tripType, scoringPrefs);
    normalized.effectiveTotalPrice = epResult.effectiveTotalPrice;
  }

  // 3. Extract features for all offers
  const allWithFeatures = normalizedOffers.map(({ original, normalized }) => ({
    original,
    normalized,
    features: extractScoringFeatures(normalized, tripType),
  }));

  // 4. Quality filter
  const minDuration = Math.min(...allWithFeatures.map(a => a.features.totalDurationMinutes));
  const candidates: typeof allWithFeatures = [];
  const filteredOut: AiFilteredOut<T>[] = [];

  for (const item of allWithFeatures) {
    const qr = qualityFilterOffer(item.normalized, item.features, minDuration);
    if (!qr.pass) {
      filteredOut.push({ option: item.original, reason: qr.reason!, filtered: true });
    } else {
      candidates.push(item);
    }
  }

  if (candidates.length === 0) return { ranked: [], filteredOut };

  // 5. Compute search-level stats
  //    When cabin class filters are active, compute stats only from offers in
  //    those classes so price/duration percentiles are cabin-appropriate.
  //    e.g. Business class flights compared against other Business/First class,
  //    not penalised against Economy fares.
  const allFeatures = candidates.map(c => c.features);
  let stats = computeScoringStats(allFeatures);

  if (selectedCabinClasses && selectedCabinClasses.size > 0) {
    const cabinFilteredFeatures = candidates
      .filter(c => c.normalized.cabinClass && selectedCabinClasses.has(c.normalized.cabinClass))
      .map(c => c.features);

    // Only use cabin-filtered stats if we have enough data points (≥ 3)
    // to compute meaningful percentiles. Otherwise fall back to all-candidate stats.
    if (cabinFilteredFeatures.length >= 3) {
      stats = computeScoringStats(cabinFilteredFeatures);
      console.log(
        `[AI Scoring] Cabin-aware stats: ${[...selectedCabinClasses].join(', ')} ` +
        `(${cabinFilteredFeatures.length} of ${allFeatures.length} offers) ` +
        `price range $${stats.minPrice.toFixed(0)}-$${stats.maxPrice.toFixed(0)}`
      );
    }
  }

  // 6. Score every candidate
  const scored = candidates.map(({ original, normalized, features }) => {
    const scoreOutput = scoreFlightOffer(normalized, tripType, scoringPrefs, stats);
    return { original, normalized, features, scoreOutput };
  });

  // 7. Tie-break sort
  const tieBreakCandidates: (TieBreakCandidate & { original: T; normalized: NormalizedFlightOffer })[] =
    scored.map(s => ({
      features: s.features,
      score: s.scoreOutput,
      original: s.original,
      normalized: s.normalized,
    }));

  tieBreakCandidates.sort((a, b) => {
    const scoreDiff = b.score.finalScore - a.score.finalScore;
    if (Math.abs(scoreDiff) > 2) return scoreDiff;
    // Use tie-break logic
    const aCrit = a.score.scoreBreakdown.warningDetails.filter(w => w.severity === 'CRITICAL').length;
    const bCrit = b.score.scoreBreakdown.warningDetails.filter(w => w.severity === 'CRITICAL').length;
    if (aCrit !== bCrit) return aCrit - bCrit;
    const priceDiff = a.features.effectiveTotalPrice - b.features.effectiveTotalPrice;
    if (Math.abs(priceDiff) / Math.max(a.features.effectiveTotalPrice, 1) > 0.02) return priceDiff;
    const durDiff = a.features.totalDurationMinutes - b.features.totalDurationMinutes;
    if (Math.abs(durDiff) > 30) return durDiff;
    if (a.features.totalStops !== b.features.totalStops) return a.features.totalStops - b.features.totalStops;
    return a.features.schedule.outboundDepartureHour - b.features.schedule.outboundDepartureHour;
  });

  // 8. Score spreading (ensures visual differentiation between consecutive offers)
  const spreadable = tieBreakCandidates.map(c => ({ finalScore: c.score.finalScore }));
  applyScoreSpreadingNew(spreadable);
  tieBreakCandidates.forEach((c, i) => {
    c.score.finalScore = spreadable[i].finalScore;
    c.score.aiScoreRaw = spreadable[i].finalScore;
    c.score.aiScoreDisplay = Math.round(spreadable[i].finalScore);
  });

  // 8.5. Comparable-offer consistency pass (runs AFTER spreading so it's the final word)
  //      Ensures cheaper comparable offers rank at or above more expensive ones
  //      unless a justified premium exists (better baggage, flexibility, provider risk).
  const comparableCandidates: ComparableCandidate[] = tieBreakCandidates.map(c => ({
    features: c.features,
    score: c.score,
  }));
  const comparableResult = validateComparableOffers(comparableCandidates);
  if (comparableResult.adjustments.length > 0) {
    console.log(`[AI Scoring] Comparable-offer adjustments: ${comparableResult.adjustments.length}`);
    for (const adj of comparableResult.adjustments) {
      console.log(`  ${adj.offerId}: ${adj.oldScore.toFixed(1)} → ${adj.newScore.toFixed(1)} | ${adj.reason}`);
    }
  }

  // 8.55. Comparable nonstop low-fare validation
  //       Ensures cheaper comparable nonstop flights rank above more expensive
  //       ones when conditions (cabin, refundability, changeability, baggage)
  //       are the same. Only for AI_PICK / BEST_VALUE / CHEAPEST modes.
  const activeMode = scoringPrefs?.mode ?? 'AI_PICK';
  const nonstopValidationModes = new Set(['AI_PICK', 'BEST_VALUE', 'CHEAPEST']);

  if (nonstopValidationModes.has(activeMode)) {
    const nonstopCandidates: NonstopComparableCandidate[] = tieBreakCandidates.map(c => ({
      features: c.features,
      score: c.score,
      cabinClass: c.normalized.cabinClass || 'economy',
    }));

    const nonstopResult = validateComparableNonstops(nonstopCandidates);
    if (nonstopResult.adjustments.length > 0) {
      console.log(`[AI Scoring] Comparable nonstop adjustments: ${nonstopResult.adjustments.length}`);
      for (const adj of nonstopResult.adjustments) {
        console.log(`  ${adj.offerId}: ${adj.oldScore.toFixed(1)} → ${adj.newScore.toFixed(1)} | ${adj.reason}`);
      }
    }
  }

  // 8.58. Fully Refundable Priority Validation
  //       Ensures fully refundable nonstop fares rank above comparable
  //       changeable-only fares. Tier: refundable > changeable > neither.
  //       Only for AI_PICK / BEST_VALUE (NOT CHEAPEST — Lowest Price tab).
  const refundableValidationModes = new Set(['AI_PICK', 'BEST_VALUE']);

  if (refundableValidationModes.has(activeMode)) {
    const refundableCandidates: RefundablePriorityCandidate[] = tieBreakCandidates.map(c => ({
      features: c.features,
      score: c.score,
      cabinClass: c.normalized.cabinClass || 'economy',
    }));

    const refundableResult = validateRefundablePriority(refundableCandidates);
    if (refundableResult.adjustments.length > 0) {
      console.log(`[AI Scoring] Refundable priority adjustments: ${refundableResult.adjustments.length}`);
      for (const adj of refundableResult.adjustments) {
        console.log(`  ${adj.offerId}: ${adj.oldScore.toFixed(1)} → ${adj.newScore.toFixed(1)} | ${adj.reason}`);
      }
    }
  }

  // 8.6. Re-sort after comparable adjustments to reflect corrected ordering
  tieBreakCandidates.sort((a, b) => {
    const scoreDiff = b.score.finalScore - a.score.finalScore;
    if (Math.abs(scoreDiff) > 0.5) return scoreDiff;
    // Within 0.5 points: use price as tiebreaker
    return a.features.effectiveTotalPrice - b.features.effectiveTotalPrice;
  });

  // 8.7. Travel DNA soft bonus (additive only, never subtracts)
  //      Applies small score bonuses when a flight matches the user's
  //      confirmed booking history preferences.
  if (travelDnaContext?.active && travelDnaContext.preferences) {
    const dnaPrefs = travelDnaContext.preferences;
    let dnaAdjustments = 0;

    for (const c of tieBreakCandidates) {
      let dnaBonus = 0;

      // Airline match: +2–5 points based on DNA score
      if (dnaPrefs.airline) {
        const airlineCode = c.normalized.airlineCode || c.normalized.operatingAirlineCode || '';
        const match = dnaPrefs.airline.find(p => p.label === airlineCode || p.label.toLowerCase().includes(airlineCode.toLowerCase()));
        if (match) {
          dnaBonus += Math.round((match.score / 100) * 5); // max +5
        }
      }

      // Cabin match: +1–3 points
      if (dnaPrefs.cabin && c.normalized.cabinClass) {
        const cabinKey = c.normalized.cabinClass.toLowerCase();
        const match = dnaPrefs.cabin.find(p => p.label.toLowerCase() === cabinKey);
        if (match) {
          dnaBonus += Math.round((match.score / 100) * 3); // max +3
        }
      }

      // Stops match: +1–2 points
      if (dnaPrefs.stops) {
        const stopsKey = c.features.totalStops === 0 ? 'Nonstop' : c.features.totalStops === 1 ? '1 Stop' : '2+ Stops';
        const match = dnaPrefs.stops.find(p => p.label === stopsKey);
        if (match) {
          dnaBonus += Math.round((match.score / 100) * 2); // max +2
        }
      }

      if (dnaBonus > 0) {
        c.score.finalScore += dnaBonus;
        c.score.aiScoreRaw += dnaBonus;
        c.score.aiScoreDisplay = Math.round(c.score.finalScore);
        dnaAdjustments++;
      }
    }

    if (dnaAdjustments > 0) {
      console.log(`[AI Scoring] Travel DNA applied ${dnaAdjustments} bonuses`);
      // Re-sort after DNA bonuses
      tieBreakCandidates.sort((a, b) => {
        const scoreDiff = b.score.finalScore - a.score.finalScore;
        if (Math.abs(scoreDiff) > 0.5) return scoreDiff;
        return a.features.effectiveTotalPrice - b.features.effectiveTotalPrice;
      });
    }
  }

  // 9. Assign badges
  const badgeCandidates: BadgeCandidate[] = tieBreakCandidates.map((c, i) => ({
    features: c.features,
    score: c.score,
    rankPosition: i,
  }));
  const badgeMap = assignBadgesNew(badgeCandidates);

  // 10. Generate reasons + Build final output
  const ranked: AiScoredOption<T>[] = tieBreakCandidates.map((c, i) => {
    const badgeResult = badgeMap.get(c.features.offerId);

    // Generate reasons
    const reasonResult = generateReasonsNew(c.features, c.score, stats);

    // Apply reasons and tags back to score output
    c.score.positiveReasons = reasonResult.positiveReasons;
    c.score.negativeWarnings = reasonResult.negativeWarnings;
    c.score.compactReason = reasonResult.compactReason;
    c.score.rankingTags = badgeResult?.rankingTags ?? [];

    // Build combined aiReasons for backward compatibility
    // Ensure negative warnings (esp. non-refundable) are ALWAYS visible.
    // Strategy: take up to 3 positives, then append all negatives, cap at 5.
    const positives = reasonResult.positiveReasons;
    const negatives = reasonResult.negativeWarnings;
    const maxPositives = negatives.length > 0 ? 3 : 4;
    const aiReasons = [
      ...positives.slice(0, maxPositives),
      ...negatives,
    ].slice(0, 5);

    // Build legacy labels
    const labels: AiLabel[] = [];
    if (badgeResult?.badges.includes('AI Pick')) labels.push('✨ AI Pick');
    if (badgeResult?.badges.includes('Cheapest')) labels.push('Best Price');
    if (badgeResult?.badges.includes('Fastest')) labels.push('Fastest');

    return {
      option: c.original,
      aiScore: c.score.aiScoreDisplay,
      aiScoreRaw: c.score.aiScoreRaw,
      labels,
      rankingTags: (badgeResult?.rankingTags ?? []) as RankingTag[],
      aiReasons,
      layoverPenalty: 0,
      filtered: false as const,
      scoreBreakdown: debug ? {
        priceScore: c.score.scoreBreakdown.effectivePriceScore,
        durationScore: c.score.scoreBreakdown.durationScore,
        stopsScore: c.score.scoreBreakdown.stopsScore,
        layoverScore: c.score.scoreBreakdown.layoverScore,
        scheduleScore: c.score.scoreBreakdown.scheduleScore,
        baggageScore: c.score.scoreBreakdown.baggageValueScore,
        fareFlexibilityScore: c.score.scoreBreakdown.fareFlexibilityScore,
        providerReliabilityScore: c.score.scoreBreakdown.providerReliabilityScore,
        finalScore: c.score.finalScore,
        weights: {
          price: c.score.scoreBreakdown.weights.effectivePriceScore,
          duration: c.score.scoreBreakdown.weights.durationScore,
          stops: c.score.scoreBreakdown.weights.stopsScore,
          layover: c.score.scoreBreakdown.weights.layoverScore,
          schedule: c.score.scoreBreakdown.weights.scheduleScore,
          baggage: c.score.scoreBreakdown.weights.baggageValueScore,
          fareFlexibility: c.score.scoreBreakdown.weights.fareFlexibilityScore,
          providerReliability: c.score.scoreBreakdown.weights.providerReliabilityScore,
        },
        // Extended breakdown fields
        warningPenalty: c.score.warningPenalty,
        compoundWarningPenalty: c.score.compoundWarningPenalty,
        baseScore: c.score.baseScore,
        positiveReasons: reasonResult.positiveReasons,
        negativeWarnings: reasonResult.negativeWarnings,
        warningDetails: c.score.scoreBreakdown.warningDetails,
        comparableAdjustmentReason: c.score.comparableAdjustmentReason,
      } as any : undefined,
    };
  });

  // Build metadata
  const providerCodes = new Set(candidates.map(c => c.normalized.providerCode));
  const metadata: RankingMetadata = {
    minPrice: stats.minPrice,
    maxPrice: stats.maxPrice,
    fastestDuration: stats.minDuration,
    slowestDuration: stats.maxDuration,
    providerCount: providerCodes.size,
    totalOffersRanked: candidates.length,
  };

  // Sort by user mode if not default
  const sortMode = prefs?.sortMode;
  let sorted = ranked;
  if (sortMode === 'cheapest') {
    sorted = [...ranked].sort((a, b) => {
      const pa = (a.option as any).totalPrice ?? 0;
      const pb = (b.option as any).totalPrice ?? 0;
      return pa - pb;
    });
  } else if (sortMode === 'fastest') {
    sorted = [...ranked].sort((a, b) => {
      const da = (a.option as any).totalDuration ?? (a.option as any).totalDurationMinutes ?? 0;
      const db = (b.option as any).totalDuration ?? (b.option as any).totalDurationMinutes ?? 0;
      return da - db;
    });
  }

  return { ranked: sorted, filteredOut, metadata };
}
