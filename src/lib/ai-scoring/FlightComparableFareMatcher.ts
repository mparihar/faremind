// ═══════════════════════════════════════════════════════════════════════════════
// Comparable Fare Matcher — Finds the cheapest changeable fare as baseline
// ═══════════════════════════════════════════════════════════════════════════════
//
// Used by the Refundability Upgrade Rule to locate the baseline changeable fare
// against which the refundable premium is measured.
//
// Simple criteria:
//   - Same cabin class
//   - Same currency
//   - Candidate must be changeable but NOT refundable
//   - Select the CHEAPEST changeable fare as baseline

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
  /** Price difference: refundablePrice - changeablePrice (negative = refundable is cheaper) */
  priceDiff: number;
}

// ── Main matcher ─────────────────────────────────────────────────────────────

/**
 * Find the cheapest changeable (but not refundable) fare in the same cabin
 * as the baseline for the refundable premium calculation.
 *
 * Only requires: same cabin class + same currency.
 * Stops, duration, schedule, baggage are scored separately by the 8 dimensions
 * and should NOT block the refundability price comparison.
 */
export function findNearestChangeableFare(
  refundable: FareMatchCandidate,
  allCandidates: FareMatchCandidate[],
  _config: RefundabilityUpgradeConfig,
): FareMatchResult {
  const rf = refundable.features;
  const rCabin = (refundable.cabinClass || 'economy').toLowerCase();

  let bestMatch: FareMatchCandidate | null = null;
  let bestPrice = Infinity;

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

    // Pick the cheapest changeable fare
    if (cf.effectiveTotalPrice < bestPrice) {
      bestPrice = cf.effectiveTotalPrice;
      bestMatch = candidate;
    }
  }

  return {
    match: bestMatch,
    priceDiff: bestMatch ? rf.effectiveTotalPrice - bestPrice : 0,
  };
}
