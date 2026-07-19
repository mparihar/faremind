// ═══════════════════════════════════════════════════════════════════════════════
// Comparable Fare Matcher — Finds the nearest changeable fare for a refundable offer
// ═══════════════════════════════════════════════════════════════════════════════
//
// Used by the Refundability Upgrade Rule to locate the baseline changeable fare
// against which the refundable premium is measured.
//
// Criteria:
//   - Same cabin class
//   - Same currency
//   - Same stop count
//   - Candidate must be changeable but NOT refundable
//   - Select the one with the SMALLEST positive price difference (nearest by price)

import type { ScoringFeatures } from './FlightScoringTypes';
import type { RefundabilityUpgradeConfig } from './FlightScoringConfig';

// ── Types ────────────────────────────────────────────────────────────────────

export interface FareMatchCandidate {
  features: ScoringFeatures;
  cabinClass: string;
  currency: string;
}

export interface FareMatchResult {
  /** The matched changeable fare, or null if no comparable found */
  match: FareMatchCandidate | null;
  /** Price difference: refundablePrice - changeablePrice */
  priceDiff: number;
}

// ── Main matcher ─────────────────────────────────────────────────────────────

/**
 * Find the nearest comparable changeable (but not refundable) fare
 * for a given fully refundable offer.
 *
 * "Nearest" = smallest positive price difference from the refundable fare.
 * This avoids penalizing refundable fares against cheap outliers while still
 * catching genuinely overpriced ones.
 *
 * Requires: same cabin + same currency + same stop count.
 */
export function findNearestChangeableFare(
  refundable: FareMatchCandidate,
  allCandidates: FareMatchCandidate[],
  _config: RefundabilityUpgradeConfig,
): FareMatchResult {
  const rf = refundable.features;
  const rCabin = (refundable.cabinClass || 'economy').toLowerCase();

  let bestMatch: FareMatchCandidate | null = null;
  let bestPriceDiff = Infinity;

  for (const candidate of allCandidates) {
    const cf = candidate.features;

    // Skip self
    if (cf.offerId === rf.offerId) continue;

    // Must be changeable but NOT refundable
    if (!cf.fareFlexibility.changeable) continue;
    if (cf.fareFlexibility.refundable) continue;

    // Same cabin class
    if ((candidate.cabinClass || 'economy').toLowerCase() !== rCabin) continue;

    // Same currency
    if (candidate.currency !== refundable.currency) continue;

    // Same stop count
    if (cf.totalStops !== rf.totalStops) continue;

    // Calculate price difference (refundable - changeable)
    const priceDiff = rf.effectiveTotalPrice - cf.effectiveTotalPrice;

    // Only consider changeable fares that are cheaper or equal
    if (priceDiff < 0) continue;

    // Select the candidate with the smallest positive price diff (nearest by price)
    if (priceDiff < bestPriceDiff) {
      bestPriceDiff = priceDiff;
      bestMatch = candidate;
    }
  }

  return {
    match: bestMatch,
    priceDiff: bestMatch ? bestPriceDiff : 0,
  };
}
