// ═══════════════════════════════════════════════════════════════════════════════
// Unified Flight Scoring Engine — Effective Price Service
// ═══════════════════════════════════════════════════════════════════════════════
//
// Calculates effective total price by adding estimated add-on costs
// (checked baggage fees) when the provider doesn't include them in
// the base fare. This prevents cheap "basic economy" fares from
// always beating more complete fares that include checked bags.

import type {
  NormalizedFlightOffer,
  ScoringTripType,
  ScoringUserPreferences,
  ScoringSearchContext,
  EffectivePriceResult,
} from './FlightScoringTypes';
import { ESTIMATED_BAG_COSTS } from './FlightScoringConfig';

/**
 * Calculate the effective total price for a flight offer.
 *
 * Rules:
 * - If the offer already includes checked baggage, no adjustment needed.
 * - If baggage cost is known from provider, add it.
 * - If baggage cost is unknown, use conservative estimates.
 * - If user explicitly says carry-on-only, skip bag cost estimation.
 * - Multiply per-piece cost by passenger count for group pricing.
 */
export function calculateEffectivePrice(
  offer: NormalizedFlightOffer,
  tripType: ScoringTripType,
  userPrefs?: ScoringUserPreferences | null,
  searchContext?: ScoringSearchContext | null,
): EffectivePriceResult {
  let baggageCostApplied = 0;
  let confidence: EffectivePriceResult['confidence'] = 'HIGH';

  // If user only wants carry-on, no bag cost adjustment needed
  if (userPrefs?.carryOnOnly) {
    return {
      effectiveTotalPrice: offer.totalFare,
      estimatedAddOnCost: 0,
      baggageCostApplied: 0,
      confidence: 'HIGH',
    };
  }

  // If checked bags are already included, no adjustment
  if (offer.baggage.checkedBagsIncluded > 0) {
    return {
      effectiveTotalPrice: offer.totalFare,
      estimatedAddOnCost: 0,
      baggageCostApplied: 0,
      confidence: 'HIGH',
    };
  }

  // Checked bags NOT included — estimate cost
  const passengerCount = searchContext?.passengerCount ?? 1;
  const legMultiplier = tripType === 'ROUND_TRIP' ? 2 : 1;

  if (offer.baggage.checkedBagCostKnown && offer.baggage.estimatedCheckedBagCost != null) {
    // Provider gave us the actual cost
    baggageCostApplied = offer.baggage.estimatedCheckedBagCost * passengerCount * legMultiplier;
    confidence = 'HIGH';
  } else {
    // Use our estimates
    const rates = offer.isInternational
      ? ESTIMATED_BAG_COSTS.international
      : ESTIMATED_BAG_COSTS.domestic;

    // Estimate 1 checked bag per passenger
    baggageCostApplied = rates.checkedBagPerPiece * passengerCount * legMultiplier;
    confidence = 'MEDIUM';
  }

  const estimatedAddOnCost = baggageCostApplied;
  const effectiveTotalPrice = offer.totalFare + estimatedAddOnCost;

  return {
    effectiveTotalPrice,
    estimatedAddOnCost,
    baggageCostApplied,
    confidence,
  };
}
