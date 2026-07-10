/**
 * Machine Reasons Generator
 *
 * Produces structured, human-readable machineReasons[] and tradeoffs[]
 * for each ranked offer. These are sent to GPT for explanation generation
 * and also returned directly in the API response.
 *
 * Reasons are comparative — they reference the cheapest, fastest, or
 * best-connected alternatives in the set.
 */

import type { OfferFeatures, ScoreBreakdown, JourneyType } from '../types';

interface ReasonInput {
  offerId: string;
  features: OfferFeatures;
  breakdown: ScoreBreakdown;
  finalScore: number;
  rank: number;
}

interface SetStats {
  cheapestPrice: number;
  cheapestOfferId: string;
  fastestDuration: number;
  fastestOfferId: string;
  minStops: number;
  bestNonstopOfferId: string | null;
  totalOffers: number;
}

/**
 * Generate machine-readable reasons and tradeoffs for a ranked offer.
 */
export function generateMachineReasons(
  offer: ReasonInput,
  stats: SetStats,
  journeyType: JourneyType,
): { machineReasons: string[]; tradeoffs: string[] } {
  const reasons: string[] = [];
  const tradeoffs: string[] = [];

  const { features, breakdown } = offer;

  // ── Price reasons ─────────────────────────────────────────────────────────
  if (features.totalPrice === stats.cheapestPrice) {
    reasons.push('Cheapest option in this search.');
  } else if (stats.cheapestPrice > 0) {
    const premiumPercent = ((features.totalPrice - stats.cheapestPrice) / stats.cheapestPrice) * 100;
    if (premiumPercent <= 5) {
      reasons.push(`Only ${premiumPercent.toFixed(0)}% more than the cheapest option.`);
    } else if (premiumPercent <= 15) {
      reasons.push(`${premiumPercent.toFixed(0)}% more than the cheapest option.`);
    } else {
      tradeoffs.push(`${premiumPercent.toFixed(0)}% more expensive than the cheapest option.`);
    }
  }

  // ── Duration reasons ──────────────────────────────────────────────────────
  if (features.durationMinutes === stats.fastestDuration) {
    reasons.push('Fastest itinerary available.');
  } else if (stats.fastestDuration > 0) {
    const extraMinutes = features.durationMinutes - stats.fastestDuration;
    const extraHours = Math.round(extraMinutes / 60);
    if (extraMinutes <= 30) {
      reasons.push('Nearly the fastest option available.');
    } else if (extraHours >= 2) {
      tradeoffs.push(`${extraHours} hours longer than the fastest option.`);
    }
  }

  // Time savings compared to longer alternatives
  if (breakdown.durationScore >= 85 && features.durationMinutes < stats.fastestDuration + 60) {
    // Check if this offer saves significant time vs average
    reasons.push('Efficient travel time compared to alternatives.');
  }

  // ── Stops reasons ─────────────────────────────────────────────────────────
  if (features.stops === 0) {
    reasons.push('Nonstop flight — no connections needed.');
  } else if (features.stops === 1) {
    if (stats.minStops === 0) {
      tradeoffs.push('One-stop itinerary instead of nonstop.');
    } else {
      reasons.push('One-stop itinerary — fewest connections available.');
    }
  } else {
    tradeoffs.push(`${features.stops}-stop itinerary.`);
  }

  // ── Baggage reasons ───────────────────────────────────────────────────────
  if (journeyType === 'international') {
    if (features.checkedBags >= 2) {
      reasons.push('Includes two checked bags.');
    } else if (features.checkedBags === 1) {
      reasons.push('Includes one checked bag.');
    } else {
      tradeoffs.push('No checked bag included.');
    }
  } else {
    if (features.checkedBags >= 1) {
      reasons.push('Includes checked bag.');
    }
  }

  // ── Flexibility reasons ───────────────────────────────────────────────────
  if (features.refundable && (features.cancellationFee === undefined || features.cancellationFee === 0)) {
    reasons.push('Fully refundable fare.');
  } else if (features.refundable) {
    reasons.push('Refundable with fee.');
  } else if (features.changeable && (features.changeFee === undefined || features.changeFee === 0)) {
    reasons.push('Free changes allowed.');
  } else if (features.changeable) {
    reasons.push('Changes allowed with fee.');
  } else {
    if (breakdown.flexibilityScore < 40) {
      tradeoffs.push('Non-refundable, non-changeable fare.');
    }
  }

  // ── Connection safety reasons ─────────────────────────────────────────────
  if (features.stops > 0 && features.layoverDurations.length > 0) {
    const shortestLayover = Math.min(...features.layoverDurations);
    if (journeyType === 'international' && shortestLayover >= 120) {
      reasons.push('Connection duration is safer for international travel.');
    }
    if (features.hasAirportChange) {
      tradeoffs.push('Requires airport change during connection.');
    }
  }

  // ── Comfort reasons ───────────────────────────────────────────────────────
  if (features.cabinClass === 'business') {
    reasons.push('Business class cabin.');
  } else if (features.cabinClass === 'premium_economy') {
    reasons.push('Premium economy cabin.');
  } else if (features.cabinClass === 'first') {
    reasons.push('First class cabin.');
  }

  if (features.loungeAccess) reasons.push('Lounge access included.');
  if (features.mealsIncluded && journeyType === 'international') reasons.push('Meal service included.');
  if (features.wifiAvailable) reasons.push('WiFi available onboard.');

  // ── Schedule reasons ──────────────────────────────────────────────────────
  if (breakdown.scheduleScore >= 90) {
    reasons.push('Ideal departure and arrival times.');
  } else if (breakdown.scheduleScore < 40) {
    tradeoffs.push('Inconvenient departure or arrival time.');
  }

  // Limit to most impactful reasons
  return {
    machineReasons: reasons.slice(0, 8),
    tradeoffs: tradeoffs.slice(0, 4),
  };
}
