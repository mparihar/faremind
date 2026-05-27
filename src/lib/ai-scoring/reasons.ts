// ─── AI Reason Generation ────────────────────────────────────────────────────
//
// Generates 2-4 short, human-readable explanations for why each
// flight option scored the way it did (spec §15).

import type { NormalizedOption, AiScoreBreakdown, RankingTag, ScoringStats } from './types';

/**
 * Generate 2-4 contextual AI reasons for a scored option.
 */
export function generateReasons(
  norm:      NormalizedOption,
  breakdown: AiScoreBreakdown,
  tags:      RankingTag[],
  stats:     ScoringStats,
): string[] {
  const reasons: string[] = [];

  // ── Price reason ──
  const pctAbove = stats.minPrice > 0
    ? ((norm.price - stats.minPrice) / stats.minPrice) * 100
    : 0;

  if (tags.includes('Cheapest')) {
    // Differentiate: nonstop cheapest vs general cheapest
    if (norm.stops === 0) {
      reasons.push('Lowest price among comparable nonstop options');
    } else {
      reasons.push('Lowest price among available options');
    }
  } else if (stats.minPrice > 0) {
    if (pctAbove <= 3) {
      reasons.push('Price is within 3% of the cheapest option — highly competitive');
    } else if (pctAbove <= 10) {
      // If the flight is refundable and pricier, link price to flexibility
      if (norm.refundable) {
        reasons.push('Slightly higher than the cheapest comparable option');
      } else {
        reasons.push(`Only ${pctAbove.toFixed(0)}% more than the cheapest option`);
      }
    } else if (pctAbove > 20) {
      reasons.push('Higher fare — consider if the features justify the premium');
    }
  }

  // ── Fare flexibility reason — always surface if refundable/changeable ──
  // This is a key differentiator that justifies higher prices.
  if (norm.refundable && norm.changeable) {
    if (pctAbove > 3) {
      reasons.push('Fully refundable & changeable fare — justifies the slightly higher price');
    } else {
      reasons.push('Fully refundable & changeable — maximum booking flexibility');
    }
  } else if (norm.refundable) {
    if (pctAbove > 3) {
      reasons.push('Refundable fare — the higher price includes cancellation protection');
    } else {
      reasons.push('Refundable fare — cancel for a full refund if plans change');
    }
  } else if (norm.changeable) {
    reasons.push('Changeable fare — reschedule flexibility if plans shift');
  } else {
    // Non-refundable AND non-changeable — always mention this trade-off
    if (tags.includes('Cheapest')) {
      reasons.push('Non-refundable & non-changeable — lower price but book only if dates are firm');
    } else {
      reasons.push('Non-refundable & non-changeable — book only if dates are firm');
    }
  }

  // ── Stops reason ──
  if (norm.stops === 0) {
    if (norm.returnDepartureHour != null) {
      reasons.push('Nonstop on both legs — zero connection stress');
    } else {
      reasons.push('Nonstop flight — direct service with no connections');
    }
  } else if (norm.stops === 1) {
    reasons.push('One stop — short connection keeps total time manageable');
  } else if (norm.stops >= 2) {
    reasons.push(`${norm.stops} connections — longer journey with multiple stopovers`);
  }

  // ── Duration reason ──
  if (tags.includes('Fastest')) {
    reasons.push('Fastest total journey time among all options');
  } else if (tags.includes('Near Fastest')) {
    reasons.push('Total travel time is near the fastest available');
  } else if (tags.includes('Long Duration')) {
    reasons.push('Total travel time is significantly longer than faster options');
  }

  // ── Layover reason ──
  if (tags.includes('Long Layover')) {
    const maxLv = Math.max(...norm.layoverMinutes);
    const hrs = Math.floor(maxLv / 60);
    reasons.push(`Includes a ${hrs}+ hour layover — may be less convenient`);
  } else if (tags.includes('Tight Connection')) {
    reasons.push('Has a tight connection — risk of missed transfer');
  }

  // ── Schedule reason ──
  if (breakdown.scheduleScore >= 90) {
    reasons.push('Convenient departure and arrival times');
  } else if (breakdown.scheduleScore < 60) {
    reasons.push('Inconvenient flight times — early morning or late-night segments');
  }

  // ── Baggage reason ──
  if (tags.includes('Baggage Included') && norm.baggageCarryOn > 0) {
    const bags = [];
    if (norm.baggageCarryOn > 0) bags.push(`${norm.baggageCarryOn} carry-on`);
    if (norm.baggageChecked > 0) bags.push(`${norm.baggageChecked} checked bag${norm.baggageChecked > 1 ? 's' : ''}`);
    reasons.push(`${bags.join(' & ')} included — no surprise fees at check-in`);
  } else if (norm.baggageChecked === 0 && norm.isInternational) {
    reasons.push('No checked baggage included — additional fee may apply');
  }

  // ── Best Value summary ──
  if (tags.includes('Best Value')) {
    reasons.push('Excellent overall value — top scores across price, speed, and comfort');
  }

  // Ensure 2-4 reasons
  if (reasons.length < 2) {
    if (breakdown.finalScore >= 85) {
      reasons.push('Strong overall option for this route');
    } else {
      reasons.push('Consider trade-offs before booking');
    }
  }

  return reasons.slice(0, 4);
}

