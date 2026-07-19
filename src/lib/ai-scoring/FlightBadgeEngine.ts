// ═══════════════════════════════════════════════════════════════════════════════
// Unified Flight Scoring Engine — Badge Engine
// ═══════════════════════════════════════════════════════════════════════════════
//
// Assigns badges AFTER all offers are scored and ranked.
// Badges are based on the full result set, not individual offers.

import type {
  ScoringFeatures,
  FlightScoreOutput,
} from './FlightScoringTypes';

export interface BadgeCandidate {
  features: ScoringFeatures;
  score: FlightScoreOutput;
  rankPosition: number;
}

export interface BadgeResult {
  badges: string[];
  rankingTags: string[];
}

/**
 * Assign badges across all scored offers.
 * Returns a Map of offerId → BadgeResult.
 */
export function assignBadges(
  candidates: BadgeCandidate[],
): Map<string, BadgeResult> {
  const result = new Map<string, BadgeResult>();
  if (candidates.length === 0) return result;

  // Compute set-wide extremes
  const minPrice    = Math.min(...candidates.map(c => c.features.effectiveTotalPrice));
  const minRawPrice = Math.min(...candidates.map(c => c.features.rawTotalPrice));
  const minDuration = Math.min(...candidates.map(c => c.features.totalDurationMinutes));
  const minStops    = Math.min(...candidates.map(c => c.features.totalStops));
  const maxScore    = Math.max(...candidates.map(c => c.score.finalScore));
  const fastestDuration = minDuration;

  let bestRefundableValueAssigned = false;

  for (const { features, score, rankPosition } of candidates) {
    const badges: string[] = [];
    const tags: string[] = [];

    // ── AI Pick: highest score AND eligible AND first among equals ──
    // Only the top-ranked offer with the max score gets AI Pick.
    // This prevents multiple AI Picks on comparable offers.
    if (
      score.finalScore === maxScore &&
      score.aiPickEligible &&
      maxScore > 0 &&
      rankPosition === 0
    ) {
      badges.push('AI Pick');
      tags.push('AI Pick');
    }

    // ── Cheapest: based on actual displayed fare (rawTotalPrice), not AI-adjusted price ──
    // This ensures the badge matches what the customer sees on the card.
    if (minRawPrice > 0 && features.rawTotalPrice <= minRawPrice * 1.01) {
      badges.push('Cheapest');
      tags.push('Cheapest');
    }

    // ── Fastest ──
    if (features.totalDurationMinutes <= minDuration + 5) {
      badges.push('Fastest');
      tags.push('Fastest');
    }

    // ── Fewest Stops ──
    if (features.totalStops === minStops) {
      badges.push('Fewest Stops');
      tags.push('Fewest Stops');
    }

    // ── Nonstop / Direct ──
    if (features.totalStops === 0) {
      badges.push('Nonstop');
      tags.push('Nonstop');
    }

    // ── Best Value ──
    if (
      score.finalScore >= 90 &&
      minPrice > 0 && (features.effectiveTotalPrice - minPrice) / minPrice <= 0.05 &&
      fastestDuration > 0 && (features.totalDurationMinutes - fastestDuration) / fastestDuration <= 0.10
    ) {
      badges.push('Best Value');
      tags.push('Best Value');
    }

    // ── Recommended ──
    if (score.finalScore >= 90 && !badges.includes('Best Value')) {
      tags.push('Recommended');
    }

    // ── Baggage Included ──
    if (features.baggage.checkedBagsIncluded > 0) {
      badges.push('Baggage Included');
      tags.push('Baggage Included');
    }

    // ── Flexible Fare ──
    if (features.fareFlexibility.refundable || features.fareFlexibility.changeable) {
      badges.push('Flexible Fare');
      tags.push('Flexible Fare');
    }

    // ── Best Refundable Value ──
    // Awarded to the highest-scoring refundable offer that received
    // a significant refundability upgrade bonus (≥ 12). Only one per search set.
    if (
      score.refundabilityUpgradeBonus >= 12 &&
      features.fareFlexibility.refundable &&
      !bestRefundableValueAssigned
    ) {
      badges.push('Best Refundable Value');
      tags.push('Best Refundable Value');
      bestRefundableValueAssigned = true;
    }

    // ── Better Schedule ──
    if (score.scoreBreakdown.scheduleScore >= 90) {
      tags.push('Better Schedule');
    }

    // ── Long Layover (warning tag) ──
    if (features.allLayovers.some(l => l.durationMinutes > 300)) {
      tags.push('Long Layover');
    }

    // ── Tight Connection (warning tag) ──
    const tightThreshold = features.isInternational ? 75 : 45;
    if (features.allLayovers.some(l => l.durationMinutes > 0 && l.durationMinutes < tightThreshold)) {
      tags.push('Tight Connection');
    }

    // ── High Price (warning tag) ──
    if (minPrice > 0 && (features.effectiveTotalPrice - minPrice) / minPrice > 0.20) {
      tags.push('High Price');
    }

    // ── Poor Refund Terms (warning tag) ──
    if (!features.fareFlexibility.refundable && !features.fareFlexibility.changeable) {
      tags.push('Poor Refund Terms');
    }

    // ── Long Duration (warning tag) ──
    if (fastestDuration > 0 && (features.totalDurationMinutes - fastestDuration) / fastestDuration > 0.25) {
      tags.push('Long Duration');
    }

    // ── Near Fastest ──
    if (!tags.includes('Fastest') && fastestDuration > 0) {
      const pctAbove = (features.totalDurationMinutes - fastestDuration) / fastestDuration;
      if (pctAbove <= 0.05) tags.push('Near Fastest');
    }

    // ── Avoid (very low score) ──
    if (score.finalScore < 60) {
      tags.push('Avoid');
    }

    // ── Provider Review ──
    if (score.scoreBreakdown.providerReliabilityScore < 70) {
      tags.push('Provider Review');
    }

    result.set(features.offerId, { badges, rankingTags: tags });
  }

  return result;
}
