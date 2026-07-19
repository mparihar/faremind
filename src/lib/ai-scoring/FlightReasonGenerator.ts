// ═══════════════════════════════════════════════════════════════════════════════
// Unified Flight Scoring Engine — Reason Generator
// ═══════════════════════════════════════════════════════════════════════════════
//
// Generates separated positive reasons (green ✓) and negative warnings (amber ✗)
// for each scored flight offer.

import type {
  ScoringFeatures,
  FlightScoreOutput,
} from './FlightScoringTypes';
import type { ScoringStats } from './FlightScoringEngine';

export interface ReasonGeneratorResult {
  positiveReasons: string[];
  negativeWarnings: string[];
  compactReason: string;
}

/**
 * Generate human-readable reasons for a scored offer.
 * Positive reasons explain value; negative warnings flag trade-offs.
 */
export function generateReasons(
  features: ScoringFeatures,
  scoreOutput: FlightScoreOutput,
  stats: ScoringStats,
): ReasonGeneratorResult {
  const positiveReasons: string[] = [];
  const negativeWarnings: string[] = [];

  const bd = scoreOutput.scoreBreakdown;

  // ── Price reasons ──
  if (stats.minPrice > 0) {
    const pctAbove = ((features.effectiveTotalPrice - stats.minPrice) / stats.minPrice) * 100;
    const stopsLabel = features.totalStops === 0 ? 'nonstop' : features.totalStops === 1 ? 'direct' : '';

    if (pctAbove <= 1) {
      if (stopsLabel) {
        positiveReasons.push(`Lowest price among comparable ${stopsLabel} options`);
      } else {
        positiveReasons.push('Lowest price among available options');
      }
    } else if (pctAbove <= 3) {
      if (stopsLabel) {
        positiveReasons.push(`Lowest price among comparable ${stopsLabel} options`);
      } else {
        positiveReasons.push('Price is within 3% of the cheapest option — highly competitive');
      }
    } else if (pctAbove <= 10) {
      positiveReasons.push('Slightly higher than the cheapest comparable option');
    } else if (pctAbove > 20) {
      // Higher priced — explain value if score is still good
      if (scoreOutput.finalScore >= 75) {
        if (features.baggage.checkedBagsIncluded > 0) {
          positiveReasons.push('Better total value with checked baggage included');
        }
        if (features.totalDurationMinutes < stats.avgDuration * 0.9) {
          positiveReasons.push('Shorter total journey than cheaper alternatives');
        }
        if (features.totalStops < stats.minStops + 1) {
          positiveReasons.push('Fewer stops than lower-priced alternatives');
        }
        // Fare flexibility justifies premium pricing
        if (features.fareFlexibility.refundable && features.fareFlexibility.changeable) {
          positiveReasons.push('Fully refundable & changeable — the premium includes full booking flexibility');
        } else if (features.fareFlexibility.refundable) {
          positiveReasons.push('Refundable fare — the higher price includes cancellation protection');
        } else if (features.fareFlexibility.changeable) {
          positiveReasons.push('Changeable fare — the premium includes reschedule flexibility');
        }
      }
    }
  }

  // ── Fare flexibility reasons (high priority — show early) ──
  // Flexibility is a key differentiator; surface it before stops/duration.
  // Skip if the price-justification section above already added one.
  const hasFlex = features.fareFlexibility.refundable || features.fareFlexibility.changeable;
  const alreadyHasFlexReason = positiveReasons.some(r =>
    r.includes('refundable') || r.includes('Refundable') ||
    r.includes('changeable') || r.includes('Changeable')
  );
  if (hasFlex && !alreadyHasFlexReason) {
    if (features.fareFlexibility.refundable && features.fareFlexibility.changeable) {
      positiveReasons.push('Fully refundable & changeable — maximum booking flexibility');
    } else if (features.fareFlexibility.refundable) {
      positiveReasons.push('Refundable fare — cancel for a full refund if plans change');
    } else if (features.fareFlexibility.changeable) {
      positiveReasons.push('Changeable fare — schedule flexibility if plans shift');
    }
  }

  // ── Refundability Upgrade Value reason ──
  // When the upgrade rule awarded a bonus, explain why refundability is good value.
  // When a penalty was applied, warn about the overpriced refundable fare.
  if (scoreOutput.refundabilityUpgradeBonus > 0) {
    const premiumPct = scoreOutput.scoreBreakdown.refundabilityUpgradePremiumPct ?? 0;
    const alreadyHasRefundReason = positiveReasons.some(r =>
      r.includes('refundable') || r.includes('Refundable')
    );
    if (!alreadyHasRefundReason) {
      if (premiumPct <= 0) {
        positiveReasons.push('Cheaper than comparable changeable fares — and fully refundable');
      } else if (premiumPct <= 5) {
        positiveReasons.push(`Fully refundable for only ${Math.round(premiumPct)}% more than comparable changeable fare`);
      } else if (premiumPct <= 10) {
        positiveReasons.push(`Full refundability for just ${Math.round(premiumPct)}% above the nearest changeable option`);
      } else {
        positiveReasons.push('Refundable fare at a competitive premium over changeable alternatives');
      }
    }
  } else if (scoreOutput.refundabilityUpgradeBonus < 0) {
    const premiumPct = scoreOutput.scoreBreakdown.refundabilityUpgradePremiumPct ?? 0;
    negativeWarnings.push(
      `Refundability premium is ${Math.round(premiumPct)}% above comparable changeable fares — consider if the extra cost is justified`
    );
  }

  // ── Baggage reasons (HIGH PRIORITY — show early) ──
  // Baggage is a key decision factor, especially for international flights.
  if (features.baggage.checkedBagsIncluded > 0 && features.baggage.carryOnIncluded) {
    const bags: string[] = [];
    if (features.baggage.carryOnPieces > 0) bags.push(`${features.baggage.carryOnPieces} carry-on`);
    if (features.baggage.checkedBagsIncluded > 0) {
      bags.push(`${features.baggage.checkedBagsIncluded} checked bag${features.baggage.checkedBagsIncluded > 1 ? 's' : ''}`);
    }
    positiveReasons.push(`${bags.join(' & ')} included — no surprise fees at check-in`);
  } else if (features.baggage.checkedBagsIncluded > 0) {
    positiveReasons.push(`${features.baggage.checkedBagsIncluded} checked bag${features.baggage.checkedBagsIncluded > 1 ? 's' : ''} included`);
  } else if (features.baggage.carryOnIncluded && features.baggage.checkedBagsIncluded === 0) {
    negativeWarnings.push('Carry-on only — no checked baggage included');
  } else if (features.baggage.checkedBagsIncluded === 0) {
    negativeWarnings.push('No checked baggage included — additional fee may apply');
  }

  // ── Stops reasons ──
  if (features.totalStops === 0) {
    if (features.tripType === 'ROUND_TRIP') {
      positiveReasons.push('Nonstop on both legs — zero connection stress');
    } else {
      positiveReasons.push('Nonstop flight — direct service with no connections');
    }
  } else if (features.totalStops === 1) {
    positiveReasons.push('One stop — short connection keeps total time manageable');
  } else if (features.totalStops >= 3) {
    negativeWarnings.push(`${features.totalStops} connections — longer journey with multiple stopovers`);
  } else if (features.totalStops === 2) {
    if (features.tripType === 'ROUND_TRIP' && features.outboundStops <= 1 && features.returnStops <= 1) {
      positiveReasons.push('One stop each way — standard for this route');
    } else {
      negativeWarnings.push('Two connections may make the journey less convenient');
    }
  }

  // ── Duration reasons ──
  if (stats.minDuration > 0) {
    const pctAbove = ((features.totalDurationMinutes - stats.minDuration) / stats.minDuration) * 100;
    if (pctAbove <= 5) {
      positiveReasons.push('Fastest total journey time among all options');
    } else if (pctAbove <= 10) {
      positiveReasons.push('Total travel time is near the fastest available');
    } else if (pctAbove > 40) {
      negativeWarnings.push('Total travel time is significantly longer than faster options');
    }
  }

  // ── Layover reasons ──
  const longLayover = features.allLayovers.find(l => l.durationMinutes > 300);
  const tightLayover = features.allLayovers.find(l => {
    const threshold = features.isInternational ? 75 : 45;
    return l.durationMinutes > 0 && l.durationMinutes < threshold;
  });
  const selfTransfer = features.allLayovers.find(l => l.isSelfTransfer);
  const airportChange = features.allLayovers.find(l => l.requiresAirportChange);

  if (selfTransfer) {
    negativeWarnings.push('Self-transfer required — collect and recheck baggage');
  }
  if (airportChange) {
    negativeWarnings.push('Airport change required during connection');
  }
  if (tightLayover) {
    negativeWarnings.push(`Tight connection (${Math.round(tightLayover.durationMinutes)} min) — risk of missed transfer`);
  }
  if (longLayover && !selfTransfer && !airportChange) {
    const hrs = Math.floor(longLayover.durationMinutes / 60);
    negativeWarnings.push(`Includes a ${hrs}+ hour layover — may be less convenient`);
  }

  // ── Schedule reasons ──
  if (bd.scheduleScore >= 90) {
    positiveReasons.push('Convenient departure and arrival times');
  } else if (bd.scheduleScore < 60) {
    negativeWarnings.push('Inconvenient flight times — early morning or late-night segments');
  }



  // ── Non-flexible warning (only if fare has zero flexibility) ──
  if (!hasFlex) {
    negativeWarnings.push('Non-refundable and non-changeable — book only if dates are firm');
  }

  // ── Best overall ──
  if (scoreOutput.finalScore >= 90 && scoreOutput.aiPickEligible) {
    positiveReasons.push('Excellent overall value — top scores across price, speed, and comfort');
  }

  // Ensure at least 2 reasons total
  const total = positiveReasons.length + negativeWarnings.length;
  if (total < 2) {
    if (scoreOutput.finalScore >= 85) {
      positiveReasons.push('Strong overall option for this route');
    } else {
      positiveReasons.push('Consider trade-offs before booking');
    }
  }

  // Limit to 4 each
  const finalPositive = positiveReasons.slice(0, 4);
  const finalNegative = negativeWarnings.slice(0, 4);

  // Compact reason — single-line summary
  const compactReason = finalPositive.length > 0
    ? finalPositive[0]
    : (finalNegative.length > 0 ? finalNegative[0] : 'Scored option');

  return {
    positiveReasons: finalPositive,
    negativeWarnings: finalNegative,
    compactReason,
  };
}
