// ═══════════════════════════════════════════════════════════════════════════════
// Comparable Fare Matcher — 2-Level Hierarchy
// ═══════════════════════════════════════════════════════════════════════════════
//
// For every refundable fare, select EXACTLY ONE comparator:
//   Level 1 — Exact: same cabin, currency, stop count
//   Level 2 — Near:  ±1 stop, ≤35% duration difference (only if no L1 match)
//
// Within the highest level: smallest abs(refundable - changeable) price diff.
// No Level 3. No market fallback. No cheapest. No median.

import type { ScoringFeatures } from './FlightScoringTypes';

// ── Types ────────────────────────────────────────────────────────────────────

export interface FareMatchCandidate {
  features: ScoringFeatures;
  cabinClass: string;
  currency: string;
}

export type MatchLevel = 'exact' | 'near';

export interface FareMatchResult {
  match: FareMatchCandidate | null;
  priceDiff: number;
  matchLevel: MatchLevel | null;
  stopDiff: number;
  durationDiffPct: number;
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
 * Select the candidate with the smallest absolute price difference.
 * Tie-breakers: smaller stop diff → shorter duration → lower price → earlier index.
 */
function selectBySmallestAbsPriceDiff(
  refundablePrice: number,
  refundableStops: number,
  refundableDuration: number,
  candidates: FareMatchCandidate[],
): FareMatchCandidate | null {
  if (candidates.length === 0) return null;

  return candidates.reduce((best, c) => {
    const bestDiff = Math.abs(refundablePrice - best.features.effectiveTotalPrice);
    const cDiff = Math.abs(refundablePrice - c.features.effectiveTotalPrice);

    if (cDiff < bestDiff) return c;
    if (cDiff > bestDiff) return best;

    // Tie-break 1: smaller stop-count difference
    const bestStopDiff = Math.abs(refundableStops - best.features.totalStops);
    const cStopDiff = Math.abs(refundableStops - c.features.totalStops);
    if (cStopDiff < bestStopDiff) return c;
    if (cStopDiff > bestStopDiff) return best;

    // Tie-break 2: smaller duration difference
    const bestDurDiff = Math.abs(refundableDuration - best.features.totalDurationMinutes);
    const cDurDiff = Math.abs(refundableDuration - c.features.totalDurationMinutes);
    if (cDurDiff < bestDurDiff) return c;
    if (cDurDiff > bestDurDiff) return best;

    // Tie-break 3: lower effective price
    if (c.features.effectiveTotalPrice < best.features.effectiveTotalPrice) return c;
    return best;
  });
}

// ── Main matcher ─────────────────────────────────────────────────────────────

export function findComparableChangeableFare(
  refundable: FareMatchCandidate,
  allCandidates: FareMatchCandidate[],
  maxDurationDiffPct: number = 35,
): FareMatchResult {
  const rf = refundable.features;
  const empty: FareMatchResult = {
    match: null, priceDiff: 0, matchLevel: null, stopDiff: 0, durationDiffPct: 0,
  };

  // Pre-filter: same cabin, currency, changeable, not refundable, not self
  const base = allCandidates.filter(c =>
    c.features.offerId !== rf.offerId &&
    isChangeableNotRefundable(c.features) &&
    sameCabinAndCurrency(c, refundable)
  );

  if (base.length === 0) return empty;

  // ── Level 1: Exact (same stop count) ──
  const level1 = base.filter(c => c.features.totalStops === rf.totalStops);
  const match1 = selectBySmallestAbsPriceDiff(
    rf.effectiveTotalPrice, rf.totalStops, rf.totalDurationMinutes, level1,
  );
  if (match1) {
    const durDiffPct = Math.abs(rf.totalDurationMinutes - match1.features.totalDurationMinutes)
      / Math.max(match1.features.totalDurationMinutes, 1) * 100;
    return {
      match: match1,
      priceDiff: rf.effectiveTotalPrice - match1.features.effectiveTotalPrice,
      matchLevel: 'exact',
      stopDiff: 0,
      durationDiffPct: Math.round(durDiffPct * 100) / 100,
    };
  }

  // ── Level 2: Near (±1 stop, ≤maxDurationDiffPct duration) ──
  const level2 = base.filter(c => {
    const stopDiff = Math.abs(c.features.totalStops - rf.totalStops);
    if (stopDiff > 1) return false;
    const durDiffPct = Math.abs(rf.totalDurationMinutes - c.features.totalDurationMinutes)
      / Math.max(c.features.totalDurationMinutes, 1) * 100;
    return durDiffPct <= maxDurationDiffPct;
  });
  const match2 = selectBySmallestAbsPriceDiff(
    rf.effectiveTotalPrice, rf.totalStops, rf.totalDurationMinutes, level2,
  );
  if (match2) {
    const durDiffPct = Math.abs(rf.totalDurationMinutes - match2.features.totalDurationMinutes)
      / Math.max(match2.features.totalDurationMinutes, 1) * 100;
    return {
      match: match2,
      priceDiff: rf.effectiveTotalPrice - match2.features.effectiveTotalPrice,
      matchLevel: 'near',
      stopDiff: Math.abs(match2.features.totalStops - rf.totalStops),
      durationDiffPct: Math.round(durDiffPct * 100) / 100,
    };
  }

  return empty;
}
