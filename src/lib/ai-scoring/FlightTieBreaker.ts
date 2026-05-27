// ═══════════════════════════════════════════════════════════════════════════════
// Unified Flight Scoring Engine — Tie Breaker
// ═══════════════════════════════════════════════════════════════════════════════
//
// When two offers are within 2 score points, use structured tie-breaking
// to produce a natural, stable ranking.

import type { ScoringFeatures, FlightScoreOutput } from './FlightScoringTypes';

export interface TieBreakCandidate {
  features: ScoringFeatures;
  score: FlightScoreOutput;
}

/**
 * Compare two scored offers for tie-breaking.
 * Returns negative if `a` should rank higher, positive if `b` should rank higher.
 */
export function tieBreakCompare(a: TieBreakCandidate, b: TieBreakCandidate): number {
  // Primary: higher final score wins
  const scoreDiff = b.score.finalScore - a.score.finalScore;
  if (Math.abs(scoreDiff) > 2) return scoreDiff;

  // 1. Fewer critical warnings wins
  const aCritical = a.score.scoreBreakdown.warningDetails.filter(w => w.severity === 'CRITICAL').length;
  const bCritical = b.score.scoreBreakdown.warningDetails.filter(w => w.severity === 'CRITICAL').length;
  if (aCritical !== bCritical) return aCritical - bCritical;

  // 2. Fewer major warnings wins
  const aMajor = a.score.scoreBreakdown.warningDetails.filter(w => w.severity === 'MAJOR').length;
  const bMajor = b.score.scoreBreakdown.warningDetails.filter(w => w.severity === 'MAJOR').length;
  if (aMajor !== bMajor) return aMajor - bMajor;

  // 3. Lower effective total price wins
  const priceDiff = a.features.effectiveTotalPrice - b.features.effectiveTotalPrice;
  if (Math.abs(priceDiff) / Math.max(a.features.effectiveTotalPrice, 1) > 0.02) return priceDiff;

  // 4. Better baggage included wins
  const bagA = a.features.baggage.carryOnPieces + a.features.baggage.checkedBagsIncluded * 2;
  const bagB = b.features.baggage.carryOnPieces + b.features.baggage.checkedBagsIncluded * 2;
  if (bagA !== bagB) return bagB - bagA;

  // 5. Shorter total duration wins
  const durDiff = a.features.totalDurationMinutes - b.features.totalDurationMinutes;
  if (Math.abs(durDiff) > 30) return durDiff;

  // 6. Fewer stops wins
  if (a.features.totalStops !== b.features.totalStops) return a.features.totalStops - b.features.totalStops;

  // 7. Better fare flexibility wins
  const flexA = (a.features.fareFlexibility.refundable ? 2 : 0) + (a.features.fareFlexibility.changeable ? 1 : 0);
  const flexB = (b.features.fareFlexibility.refundable ? 2 : 0) + (b.features.fareFlexibility.changeable ? 1 : 0);
  if (flexA !== flexB) return flexB - flexA;

  // 8. Better provider reliability wins
  const relA = a.score.scoreBreakdown.providerReliabilityScore;
  const relB = b.score.scoreBreakdown.providerReliabilityScore;
  if (relA !== relB) return relB - relA;

  // 9. Earlier reasonable departure wins
  return a.features.schedule.outboundDepartureHour - b.features.schedule.outboundDepartureHour;
}

/**
 * Sort an array of scored candidates using the tie-breaking comparator.
 */
export function tieBreakSort(candidates: TieBreakCandidate[]): void {
  candidates.sort(tieBreakCompare);
}

/**
 * Apply score spreading so near-identical offers show visual differentiation.
 * Top offer stays at its score; subsequent offers are forced at least 1 point apart.
 */
export function applyScoreSpreading(items: Array<{ finalScore: number }>): void {
  if (items.length < 2) return;

  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1].finalScore;
    const curr = items[i].finalScore;

    if (curr >= prev) {
      items[i].finalScore = Math.max(0, prev - 1);
    } else if (prev - curr < 1) {
      items[i].finalScore = Math.max(0, prev - 1);
    }
  }
}
