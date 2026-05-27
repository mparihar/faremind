/**
 * Round-Trip Ranking Engine
 *
 * Delegates to the unified AI scoring pipeline so that
 * option.score and the AI scoreOverride use the SAME formula.
 *
 * This file is kept as the public API surface for server-side ranking
 * (called from /api/search/route.ts). The AI engine in src/lib/ai-scoring/
 * is the single source of truth for all scoring logic.
 */

import type {
  RoundTripOption,
  RoundTripBadge,
  RoundTripScoreBreakdown,
  RoundTripUserPrefs,
} from '@/lib/round-trip-types';
import { normalizeRoundTrip } from '@/lib/ai-scoring/normalize';
import { computeStats } from '@/lib/ai-scoring/stats';
import { computeScore } from '@/lib/ai-scoring/scorer';
import { qualityFilter } from '@/lib/ai-scoring/quality-filter';
import type { AiUserPreferences, NormalizedOption } from '@/lib/ai-scoring/types';

// ── Badge assignment ─────────────────────────────────────────────────────────

function assignBadges(
  options: Array<RoundTripOption & { score: number }>
): Array<RoundTripOption & { score: number; badges: RoundTripBadge[] }> {
  if (options.length === 0) return [];

  const cheapest = Math.min(...options.map(o => o.totalPrice));
  const fastest  = Math.min(...options.map(o => o.totalDurationMinutes));
  const fewest   = Math.min(...options.map(o => o.totalStops));
  const topScore = options[0]?.score ?? 0; // already sorted desc

  return options.map((option, i) => {
    const badges: RoundTripBadge[] = [];

    // Price within 1% of cheapest
    if (cheapest > 0 && (option.totalPrice - cheapest) / cheapest <= 0.01) {
      badges.push('cheapest');
    }
    // Duration within 5 min of fastest
    if (option.totalDurationMinutes - fastest <= 5) {
      badges.push('fastest');
    }
    // Tied fewest stops
    if (option.totalStops === fewest) {
      badges.push('fewest_stops');
    }
    // Best Value: first option with top score
    if (i === 0 && option.score === topScore) {
      badges.push('best_value');
    }
    // Recommended: score ≥ 90
    if (option.score >= 90 && !badges.includes('best_value')) {
      badges.push('recommended');
    }

    return { ...option, badges };
  });
}

// ── Tie-breaking (mirrors the AI engine's tie-breaking logic) ────────────────

function tieBreakCompare(
  a: { score: number; norm: NormalizedOption },
  b: { score: number; norm: NormalizedOption },
): number {
  // Primary: higher score
  const scoreDiff = b.score - a.score;
  if (Math.abs(scoreDiff) > 2) return scoreDiff;

  // Tie-break 1: lower price
  const priceDiff = a.norm.price - b.norm.price;
  if (Math.abs(priceDiff) / Math.max(a.norm.price, 1) > 0.02) return priceDiff;

  // Tie-break 2: shorter duration
  const durDiff = a.norm.durationMinutes - b.norm.durationMinutes;
  if (Math.abs(durDiff) > 30) return durDiff;

  // Tie-break 3: fewer stops
  if (a.norm.stops !== b.norm.stops) return a.norm.stops - b.norm.stops;

  // Tie-break 4: better baggage
  const bagA = a.norm.baggageCarryOn + a.norm.baggageChecked * 2;
  const bagB = b.norm.baggageCarryOn + b.norm.baggageChecked * 2;
  if (bagA !== bagB) return bagB - bagA;

  // Tie-break 5: departure time
  return a.norm.departureHour - b.norm.departureHour;
}

// ── Score spreading ──────────────────────────────────────────────────────────

function spreadScores(items: Array<{ score: number }>): void {
  for (let i = 1; i < items.length; i++) {
    if (items[i].score >= items[i - 1].score) {
      items[i].score = Math.max(0, items[i - 1].score - 1);
    }
  }
}

// ── Public entry point ───────────────────────────────────────────────────────

export function rankRoundTripOptions(
  options: RoundTripOption[],
  prefs: RoundTripUserPrefs = {}
): RoundTripOption[] {
  if (options.length === 0) return [];

  // Step 1: Normalize all options
  const normed = options.map(o => ({
    option: o,
    norm: normalizeRoundTrip(o),
  }));

  // Step 2: Quality filter
  const minDuration = Math.min(...normed.map(n => n.norm.durationMinutes));
  const candidates = normed.filter(({ norm }) => {
    const qr = qualityFilter(norm, minDuration);
    return qr.pass;
  });

  if (candidates.length === 0) {
    // If all filtered, return originals unsorted rather than empty
    return options;
  }

  // Step 3: Compute percentile-clipped stats
  const stats = computeStats(candidates.map(c => c.norm));

  // Step 4: Build AI prefs from RT prefs
  const aiPrefs: AiUserPreferences = {
    stops: prefs.stops,
    departureWindow: prefs.departureWindow,
  };

  // Step 5: Score each candidate using the unified 8-component scorer
  const scored = candidates.map(({ option, norm }) => {
    const breakdown = computeScore(norm, stats, aiPrefs);

    const scoreBreakdown: RoundTripScoreBreakdown = {
      priceScore:               breakdown.priceScore,
      durationScore:            breakdown.durationScore,
      stopsScore:               breakdown.stopsScore,
      layoverScore:             breakdown.layoverScore,
      scheduleScore:            breakdown.scheduleScore,
      baggageScore:             breakdown.baggageScore,
      fareFlexibilityScore:     breakdown.fareFlexibilityScore,
      providerReliabilityScore: breakdown.providerReliabilityScore,
      finalScore:               Math.round(breakdown.finalScore),
    };

    return {
      option,
      norm,
      score: Math.round(breakdown.finalScore),
      scoreBreakdown,
    };
  });

  // Step 6: Sort with tie-breaking
  scored.sort((a, b) => tieBreakCompare(a, b));

  // Step 7: Apply score spreading
  spreadScores(scored);

  // Step 8: Build final options with scores
  const withScores = scored.map(s => ({
    ...s.option,
    score: s.score,
    scoreBreakdown: s.scoreBreakdown,
  }));

  // Step 9: Assign badges
  return assignBadges(withScores);
}
