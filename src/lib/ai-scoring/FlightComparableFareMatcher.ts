// ═══════════════════════════════════════════════════════════════════════════════
// Comparable Fare Matcher — Finds the nearest changeable fare for a refundable offer
// ═══════════════════════════════════════════════════════════════════════════════
//
// Used by the Refundability Upgrade Rule to locate the baseline changeable fare
// against which the refundable premium is measured.
//
// Comparability criteria:
//   - Same cabin class
//   - Same stop count
//   - Similar duration (configurable tolerance)
//   - Similar schedule (departure within configurable hours)
//   - Same broad baggage group
//   - Same currency
//   - Candidate must be changeable but NOT refundable

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

// ── Broad baggage key (same as FlightRefundablePriorityValidator) ─────────────

function getBroadBaggageKey(features: ScoringFeatures): string {
  const hasChecked = features.baggage.checkedBagsIncluded > 0;
  const hasCarryOn = features.baggage.carryOnIncluded;
  return `${hasChecked ? 'CB' : 'noCB'}_${hasCarryOn ? 'CO' : 'noCO'}`;
}

// ── Comparability checks ─────────────────────────────────────────────────────

function isDurationComparable(
  a: ScoringFeatures,
  b: ScoringFeatures,
  config: RefundabilityUpgradeConfig,
): boolean {
  const diff = Math.abs(a.totalDurationMinutes - b.totalDurationMinutes);
  const isIntl = a.isInternational || b.isInternational;
  const tolerance = isIntl
    ? config.comparability.durationToleranceMinutesIntl
    : config.comparability.durationToleranceMinutesDomestic;
  return diff <= tolerance;
}

function isScheduleComparable(
  a: ScoringFeatures,
  b: ScoringFeatures,
  config: RefundabilityUpgradeConfig,
): boolean {
  const depDiff = Math.abs(
    a.schedule.outboundDepartureHour - b.schedule.outboundDepartureHour,
  );
  if (depDiff > config.comparability.scheduleDepartureToleranceHours) return false;

  // For round-trip: also check return departure
  if (
    a.schedule.returnDepartureHour != null &&
    b.schedule.returnDepartureHour != null
  ) {
    const retDiff = Math.abs(
      a.schedule.returnDepartureHour - b.schedule.returnDepartureHour,
    );
    if (retDiff > config.comparability.scheduleDepartureToleranceHours) return false;
  }

  return true;
}

// ── Main matcher ─────────────────────────────────────────────────────────────

/**
 * Find the nearest comparable changeable (but not refundable) fare
 * for a given fully refundable offer.
 *
 * Returns the match with the smallest non-negative price difference,
 * or the match where the refundable fare is cheaper (priceDiff < 0).
 */
export function findNearestChangeableFare(
  refundable: FareMatchCandidate,
  allCandidates: FareMatchCandidate[],
  config: RefundabilityUpgradeConfig,
): FareMatchResult {
  const rf = refundable.features;
  const rBagKey = getBroadBaggageKey(rf);
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

    // Same broad baggage group
    if (getBroadBaggageKey(cf) !== rBagKey) continue;

    // Duration comparable
    if (!isDurationComparable(rf, cf, config)) continue;

    // Schedule comparable
    if (!isScheduleComparable(rf, cf, config)) continue;

    // Calculate price difference
    const priceDiff = rf.effectiveTotalPrice - cf.effectiveTotalPrice;

    // Select the candidate with the smallest non-negative price diff,
    // or most-negative (refundable is cheapest) if all are negative
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
