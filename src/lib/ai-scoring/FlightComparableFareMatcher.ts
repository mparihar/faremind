// ═══════════════════════════════════════════════════════════════════════════════
// Comparable Fare Matcher — 3-Level Hierarchy with Cheapest Reference
// ═══════════════════════════════════════════════════════════════════════════════
//
// Finds the best-value changeable fare as the reference for premium calculation.
//
// CRITICAL: The reference fare must be the CHEAPEST comparable changeable fare
// (or median of 3 cheapest), NOT the nearest by price. Using nearest-by-price
// lets expensive refundable fares ($1,111) compare against expensive changeable
// fares ($957) instead of the market reference ($791).
//
// 3-Level Hierarchy:
//   Level 1 — Exact:  same cabin, currency, stop count
//   Level 2 — Near:   ±1 stop, ≤35% duration difference
//   Level 3 — Market: same cabin + currency (any stops)
//
// Within each level: median of 3 cheapest comparable changeable fares.

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
  match: FareMatchCandidate | null;
  priceDiff: number;
  matchLevel: MatchLevel | null;
  stopDiff: number;
  durationRatio: number;
  /** Debug: how many comparable fares were in the group */
  groupSize: number;
  /** Debug: the reference price used (median of 3 cheapest) */
  referencePrice: number;
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
 * From a group of comparable fares, select the reference fare.
 *
 * Strategy: median of the 3 cheapest fares.
 * - If 3+ fares: use median (index 1) to exclude potential outlier
 * - If 2 fares: use the cheaper one
 * - If 1 fare: use it directly
 *
 * This avoids using an extreme outlier while still anchoring to
 * the best-value available in the market.
 */
function selectReferenceFare(
  candidates: FareMatchCandidate[],
): { reference: FareMatchCandidate; referencePrice: number } | null {
  if (candidates.length === 0) return null;

  // Sort by effective price ascending
  const sorted = [...candidates].sort(
    (a, b) => a.features.effectiveTotalPrice - b.features.effectiveTotalPrice,
  );

  // Take cheapest 3
  const top3 = sorted.slice(0, 3);

  // Median: middle element (index 1 for 3 items, index 0 for 1-2 items)
  const medianIdx = top3.length >= 3 ? 1 : 0;
  const ref = top3[medianIdx];

  return { reference: ref, referencePrice: ref.features.effectiveTotalPrice };
}

// ── Main matcher ─────────────────────────────────────────────────────────────

export function findNearestChangeableFare(
  refundable: FareMatchCandidate,
  allCandidates: FareMatchCandidate[],
  _config: RefundabilityUpgradeConfig,
): FareMatchResult {
  const rf = refundable.features;
  const empty: FareMatchResult = {
    match: null, priceDiff: 0, matchLevel: null,
    stopDiff: 0, durationRatio: 1, groupSize: 0, referencePrice: 0,
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
  const ref1 = selectReferenceFare(level1);
  if (ref1) {
    const priceDiff = rf.effectiveTotalPrice - ref1.referencePrice;
    return {
      match: ref1.reference,
      priceDiff,
      matchLevel: 'exact',
      stopDiff: 0,
      durationRatio: rf.totalDurationMinutes / Math.max(ref1.reference.features.totalDurationMinutes, 1),
      groupSize: level1.length,
      referencePrice: ref1.referencePrice,
    };
  }

  // ── Level 2: Near Comparable (±1 stop, ≤35% duration diff) ──
  const level2 = base.filter(c => {
    const stopDiff = Math.abs(c.features.totalStops - rf.totalStops);
    if (stopDiff > 1) return false;
    const durRatio = rf.totalDurationMinutes / Math.max(c.features.totalDurationMinutes, 1);
    return durRatio >= 0.65 && durRatio <= 1.35;
  });
  const ref2 = selectReferenceFare(level2);
  if (ref2) {
    const priceDiff = rf.effectiveTotalPrice - ref2.referencePrice;
    return {
      match: ref2.reference,
      priceDiff,
      matchLevel: 'near',
      stopDiff: Math.abs(ref2.reference.features.totalStops - rf.totalStops),
      durationRatio: rf.totalDurationMinutes / Math.max(ref2.reference.features.totalDurationMinutes, 1),
      groupSize: level2.length,
      referencePrice: ref2.referencePrice,
    };
  }

  // ── Level 3: Market Comparable (any stops, cheapest reference) ──
  const ref3 = selectReferenceFare(base);
  if (ref3) {
    const priceDiff = rf.effectiveTotalPrice - ref3.referencePrice;
    return {
      match: ref3.reference,
      priceDiff,
      matchLevel: 'market',
      stopDiff: Math.abs(ref3.reference.features.totalStops - rf.totalStops),
      durationRatio: rf.totalDurationMinutes / Math.max(ref3.reference.features.totalDurationMinutes, 1),
      groupSize: base.length,
      referencePrice: ref3.referencePrice,
    };
  }

  return empty;
}

// ── Comparability Factor ─────────────────────────────────────────────────────

/**
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
  if (matchLevel === 'exact') return 1.0;
  if (stopDiff >= 2) return 0;
  if (durationRatio <= 1.15) return 0.80;
  return 0.65;
}
