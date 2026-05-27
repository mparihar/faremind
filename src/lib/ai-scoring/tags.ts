// ─── Tag Assignment ──────────────────────────────────────────────────────────
//
// Assigns rich ranking tags to each scored option based on attributes
// and relative position in the result set (spec §14).

import type { NormalizedOption, AiScoreBreakdown, RankingTag, ScoringStats, AiLabel } from './types';

interface TagInput {
  norm:      NormalizedOption;
  breakdown: AiScoreBreakdown;
  score:     number; // final score
}

export interface TagResult {
  rankingTags: RankingTag[];
  labels:      AiLabel[];    // legacy badge labels for existing UI
}

export function assignTags(
  inputs:  TagInput[],
  stats:   ScoringStats,
): Map<string, TagResult> {
  const result = new Map<string, TagResult>();
  if (inputs.length === 0) return result;

  // Compute set-wide mins/maxes
  const minPrice    = Math.min(...inputs.map(i => i.norm.price));
  const minDuration = Math.min(...inputs.map(i => i.norm.durationMinutes));
  const minStops    = Math.min(...inputs.map(i => i.norm.stops));
  const maxScore    = Math.max(...inputs.map(i => i.score));
  const fastestDuration = minDuration;

  for (const { norm, breakdown, score } of inputs) {
    const tags: RankingTag[] = [];

    // ── AI Pick: highest score ──
    if (score === maxScore && maxScore > 0) {
      tags.push('AI Pick');
    }

    // ── Cheapest ──
    if (minPrice > 0 && norm.price <= minPrice * 1.01) {
      tags.push('Cheapest');
    }

    // ── Fastest ──
    if (norm.durationMinutes <= minDuration + 5) {
      tags.push('Fastest');
    }

    // ── Near Fastest (within 5%) ──
    if (!tags.includes('Fastest') && fastestDuration > 0) {
      const pctAbove = (norm.durationMinutes - fastestDuration) / fastestDuration;
      if (pctAbove <= 0.05) tags.push('Near Fastest');
    }

    // ── Fewest Stops ──
    if (norm.stops === minStops) {
      tags.push('Fewest Stops');
    }

    // ── Nonstop ──
    if (norm.stops === 0) {
      tags.push('Nonstop');
    }

    // ── Best Value: score ≥ 90 AND price within 5% of cheapest AND duration within 10% of fastest ──
    if (
      score >= 90 &&
      minPrice > 0 && (norm.price - minPrice) / minPrice <= 0.05 &&
      fastestDuration > 0 && (norm.durationMinutes - fastestDuration) / fastestDuration <= 0.10
    ) {
      tags.push('Best Value');
    }

    // ── Recommended: score ≥ 90 ──
    if (score >= 90 && !tags.includes('Best Value')) {
      tags.push('Recommended');
    }

    // ── Better Schedule ──
    if (breakdown.scheduleScore >= 90) {
      tags.push('Better Schedule');
    }

    // ── Long Layover ──
    if (norm.layoverMinutes.some(lv => lv > 300)) {
      tags.push('Long Layover');
    }

    // ── Tight Connection ──
    const tightThreshold = norm.isInternational ? 75 : 45;
    if (norm.layoverMinutes.some(lv => lv > 0 && lv < tightThreshold)) {
      tags.push('Tight Connection');
    }

    // ── High Price: > 20% above cheapest ──
    if (minPrice > 0 && (norm.price - minPrice) / minPrice > 0.20) {
      tags.push('High Price');
    }

    // ── Baggage Included ──
    if (norm.baggageChecked > 0) {
      tags.push('Baggage Included');
    }

    // ── Flexible Fare ──
    if (norm.refundable || norm.changeable) {
      tags.push('Flexible Fare');
    }

    // ── Poor Refund Terms ──
    if (!norm.refundable && !norm.changeable) {
      tags.push('Poor Refund Terms');
    }

    // ── Long Duration: > 25% longer than fastest ──
    if (fastestDuration > 0 && (norm.durationMinutes - fastestDuration) / fastestDuration > 0.25) {
      tags.push('Long Duration');
    }

    // ── Avoid: score < 60 ──
    if (score < 60) {
      tags.push('Avoid');
    }

    // ── Provider Review: reliability < 70 ──
    if (breakdown.providerReliabilityScore < 70) {
      tags.push('Provider Review');
    }

    // ── Build legacy labels for existing badge UI ──
    const labels: AiLabel[] = [];
    if (tags.includes('AI Pick'))  labels.push('✨ AI Pick');
    if (tags.includes('Cheapest')) labels.push('Best Price');
    if (tags.includes('Fastest'))  labels.push('Fastest');

    result.set(norm.id, { rankingTags: tags, labels });
  }

  return result;
}
