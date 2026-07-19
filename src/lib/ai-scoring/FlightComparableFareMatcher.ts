// ═══════════════════════════════════════════════════════════════════════════════
// Comparable Fare Matcher — 3-Level Hierarchy
// ═══════════════════════════════════════════════════════════════════════════════
//
// Finds the nearest changeable fare for a refundable offer using a tiered
// matching strategy that balances precision with coverage:
//
//   Level 1 — Exact Comparable:   same cabin, currency, stop count
//   Level 2 — Near Comparable:    ±1 stop, ≤35% duration difference
//   Level 3 — Market Comparable:  same cabin + currency only (any stops)
//
// Within each level, selects the fare with the smallest positive price diff.
// Falls through to the next level only when no match is found.

import type { ScoringFeatures } from './FlightScoringTypes';
import type { RefundabilityUpgradeConfig } from './FlightScoringConfig';

// ── Types ────────────────────────────────────────────────────────────────────

export interface FareMatchCandidate {
  features: ScoringFeatures;
  cabinClass: string;
  currency: string;
}

export type MatchLevel = 'exact' | 'near' | 'market';

export interface FareMatchResult {
  /** The matched changeable fare, or null if no comparable found */
  match: FareMatchCandidate | null;
  /** Price difference: refundablePrice - changeablePrice */
  priceDiff: number;
  /** Which matching level was used */
  matchLevel: MatchLevel | null;
  /** Stop count difference between refundable and matched changeable */
  stopDiff: number;
  /** Duration ratio: refundable / changeable (for comparability factor) */
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

interface NearestResult {
  match: FareMatchCandidate | null;
  priceDiff: number;
}

/** Among filtered candidates, find the one with smallest positive price diff */
function findNearest(
  refundablePrice: number,
  candidates: FareMatchCandidate[],
): NearestResult {
  let best: FareMatchCandidate | null = null;
  let bestDiff = Infinity;

  for (const c of candidates) {
    const diff = refundablePrice - c.features.effectiveTotalPrice;
    if (diff < 0) continue; // only consider cheaper-or-equal changeable fares
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }

  return { match: best, priceDiff: best ? bestDiff : 0 };
}

// ── Main matcher ─────────────────────────────────────────────────────────────

/**
 * 3-level hierarchical matcher.
 *
 * Level 1 — Exact: same cabin, currency, stop count
 * Level 2 — Near:  ±1 stop, ≤35% duration difference
 * Level 3 — Market: same cabin + currency, any stops (closest by price)
 *
 * Falls through only when no match found at the current level.
 */
export function findNearestChangeableFare(
  refundable: FareMatchCandidate,
  allCandidates: FareMatchCandidate[],
  _config: RefundabilityUpgradeConfig,
): FareMatchResult {
  const rf = refundable.features;

  // Pre-filter: same cabin, same currency, changeable, not refundable, not self
  const base = allCandidates.filter(c =>
    c.features.offerId !== rf.offerId &&
    isChangeableNotRefundable(c.features) &&
    sameCabinAndCurrency(c, refundable)
  );

  if (base.length === 0) {
    return { match: null, priceDiff: 0, matchLevel: null, stopDiff: 0, durationRatio: 1 };
  }

  // ── Level 1: Exact Comparable (same stop count) ──
  const level1 = base.filter(c => c.features.totalStops === rf.totalStops);
  const r1 = findNearest(rf.effectiveTotalPrice, level1);
  if (r1.match) {
    return {
      ...r1,
      matchLevel: 'exact',
      stopDiff: 0,
      durationRatio: rf.totalDurationMinutes / Math.max(r1.match.features.totalDurationMinutes, 1),
    };
  }

  // ── Level 2: Near Comparable (±1 stop, ≤35% duration diff) ──
  const level2 = base.filter(c => {
    const stopDiff = Math.abs(c.features.totalStops - rf.totalStops);
    if (stopDiff > 1) return false;
    const durRatio = rf.totalDurationMinutes / Math.max(c.features.totalDurationMinutes, 1);
    return durRatio >= 0.65 && durRatio <= 1.35; // within 35%
  });
  const r2 = findNearest(rf.effectiveTotalPrice, level2);
  if (r2.match) {
    return {
      ...r2,
      matchLevel: 'near',
      stopDiff: Math.abs(r2.match.features.totalStops - rf.totalStops),
      durationRatio: rf.totalDurationMinutes / Math.max(r2.match.features.totalDurationMinutes, 1),
    };
  }

  // ── Level 3: Market Comparable (any stop count, closest by price) ──
  const r3 = findNearest(rf.effectiveTotalPrice, base);
  if (r3.match) {
    return {
      ...r3,
      matchLevel: 'market',
      stopDiff: Math.abs(r3.match.features.totalStops - rf.totalStops),
      durationRatio: rf.totalDurationMinutes / Math.max(r3.match.features.totalDurationMinutes, 1),
    };
  }

  return { match: null, priceDiff: 0, matchLevel: null, stopDiff: 0, durationRatio: 1 };
}

// ── Comparability Factor ─────────────────────────────────────────────────────

/**
 * Reduce the refundability bonus based on itinerary similarity.
 *
 * | Match                                    | Factor |
 * |------------------------------------------|--------|
 * | Exact comparable                         | 1.00   |
 * | +1 stop, similar duration (≤15% longer)  | 0.80   |
 * | +1 stop, moderately longer (>15%)        | 0.65   |
 * | 2+ additional stops                      | 0.00   |
 */
export function getComparabilityFactor(
  matchLevel: MatchLevel | null,
  stopDiff: number,
  durationRatio: number,
): number {
  if (!matchLevel) return 0;

  // Exact comparable — full factor
  if (matchLevel === 'exact') return 1.0;

  // 2+ stop difference — not comparable
  if (stopDiff >= 2) return 0;

  // ±1 stop: check duration ratio
  if (durationRatio <= 1.15) {
    // Similar duration (within 15% longer)
    return 0.80;
  }
  // Moderately longer itinerary
  return 0.65;
}
