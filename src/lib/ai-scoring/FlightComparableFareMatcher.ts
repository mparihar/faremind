// ═══════════════════════════════════════════════════════════════════════════════
// Comparable Fare Matcher — 2-Level Hierarchy, Nearest by Absolute Price Diff
// ═══════════════════════════════════════════════════════════════════════════════
//
// For every refundable fare, find the nearest valid comparable changeable fare.
//
// CRITICAL RULE:
//   "Nearest" = smallest absolute price difference: abs(refundable - changeable)
//   NOT cheapest. NOT median. NOT nearest-positive-only.
//   If $791 is closer to $861 than $599, the comparator is $791.
//
// Level 1 — Exact: same cabin, currency, stop count
// Level 2 — Near:  ±1 stop, ≤35% duration difference (only if no Level-1 match)
// No Level 3 — if no comparable exists, no bonus/penalty applied.

import type { ScoringFeatures } from './FlightScoringTypes';
import type { RefundabilityUpgradeConfig } from './FlightScoringConfig';

// ── Types ────────────────────────────────────────────────────────────────────

export interface FareMatchCandidate {
  features: ScoringFeatures;
  cabinClass: string;
  currency: string;
}

export type MatchLevel = 'exact' | 'near';

export interface FareMatchResult {
  /** The matched changeable fare, or null if no comparable found */
  match: FareMatchCandidate | null;
  /** Price difference: refundablePrice - changeablePrice */
  priceDiff: number;
  /** Which matching level was used */
  matchLevel: MatchLevel | null;
  /** Stop count difference between refundable and matched changeable */
  stopDiff: number;
  /** Duration ratio: refundable / changeable */
  durationRatio: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isChangeableNotRefundable(cf: ScoringFeatures): boolean {
  return cf.fareFlexibility.changeable && !cf.fareFlexibility.refundable;
}

function sameCabinAndCurrency(
  candidate: FareMatchCandidate,
  refundable: FareMatchCandidate,
): boolean {
  const cCabin = (candidate.cabinClass || 'economy').toLowerCase();
  const rCabin = (refundable.cabinClass || 'economy').toLowerCase();
  return cCabin === rCabin && candidate.currency === refundable.currency;
}

/**
 * From a filtered group, select the candidate with the smallest
 * ABSOLUTE price difference from the refundable fare.
 *
 * abs(refundableFare - changeableFare) — not just positive diffs,
 * not the cheapest, not a median.
 */
function selectNearestByAbsolutePriceDiff(
  refundablePrice: number,
  candidates: FareMatchCandidate[],
): FareMatchCandidate | null {
  if (candidates.length === 0) return null;

  let best: FareMatchCandidate | null = null;
  let bestAbsDiff = Infinity;

  for (const c of candidates) {
    const absDiff = Math.abs(refundablePrice - c.features.effectiveTotalPrice);
    if (absDiff < bestAbsDiff) {
      bestAbsDiff = absDiff;
      best = c;
    }
  }

  return best;
}

// ── Main matcher ─────────────────────────────────────────────────────────────

/**
 * 2-level hierarchical matcher.
 *
 * Level 1 — Exact: same cabin, currency, stop count
 * Level 2 — Near:  ±1 stop, ≤configurable duration tolerance
 *
 * Within each level: smallest absolute price difference.
 * Falls through to Level 2 ONLY when no Level-1 match exists.
 * No Level 3 — if no comparable exists, returns null.
 */
export function findNearestChangeableFare(
  refundable: FareMatchCandidate,
  allCandidates: FareMatchCandidate[],
  config: RefundabilityUpgradeConfig,
): FareMatchResult {
  const rf = refundable.features;
  const empty: FareMatchResult = {
    match: null, priceDiff: 0, matchLevel: null, stopDiff: 0, durationRatio: 1,
  };

  // Pre-filter: same cabin, same currency, changeable, not refundable, not self
  const base = allCandidates.filter(c =>
    c.features.offerId !== rf.offerId &&
    isChangeableNotRefundable(c.features) &&
    sameCabinAndCurrency(c, refundable)
  );

  if (base.length === 0) return empty;

  // ── Level 1: Exact Comparable (same stop count) ──
  const level1 = base.filter(c => c.features.totalStops === rf.totalStops);
  const match1 = selectNearestByAbsolutePriceDiff(rf.effectiveTotalPrice, level1);
  if (match1) {
    const priceDiff = rf.effectiveTotalPrice - match1.features.effectiveTotalPrice;
    return {
      match: match1,
      priceDiff,
      matchLevel: 'exact',
      stopDiff: 0,
      durationRatio: rf.totalDurationMinutes / Math.max(match1.features.totalDurationMinutes, 1),
    };
  }

  // ── Level 2: Near Comparable (±1 stop, ≤35% duration diff) ──
  const durTolerancePct = config.comparability?.durationTolerancePct ?? 35;
  const durLow = 1 - durTolerancePct / 100;  // 0.65
  const durHigh = 1 + durTolerancePct / 100;  // 1.35

  const level2 = base.filter(c => {
    const stopDiff = Math.abs(c.features.totalStops - rf.totalStops);
    if (stopDiff > 1) return false;
    const durRatio = rf.totalDurationMinutes / Math.max(c.features.totalDurationMinutes, 1);
    return durRatio >= durLow && durRatio <= durHigh;
  });
  const match2 = selectNearestByAbsolutePriceDiff(rf.effectiveTotalPrice, level2);
  if (match2) {
    const priceDiff = rf.effectiveTotalPrice - match2.features.effectiveTotalPrice;
    return {
      match: match2,
      priceDiff,
      matchLevel: 'near',
      stopDiff: Math.abs(match2.features.totalStops - rf.totalStops),
      durationRatio: rf.totalDurationMinutes / Math.max(match2.features.totalDurationMinutes, 1),
    };
  }

  // No comparable found — no bonus, no penalty
  return empty;
}

// ── Comparability Factor ─────────────────────────────────────────────────────

/**
 * | Match                                    | Factor |
 * |------------------------------------------|--------|
 * | Exact comparable (Level 1)               | 1.00   |
 * | +1 stop, similar duration (≤15% longer)  | 0.80   |
 * | +1 stop, moderately longer (>15%)        | 0.65   |
 */
export function getComparabilityFactor(
  matchLevel: MatchLevel | null,
  stopDiff: number,
  durationRatio: number,
): number {
  if (!matchLevel) return 0;
  if (matchLevel === 'exact') return 1.0;
  // Level 2 — near comparable
  if (durationRatio <= 1.15) return 0.80;
  return 0.65;
}
