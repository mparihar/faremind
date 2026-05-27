// ═══════════════════════════════════════════════════════════════════════════════
// Unified Flight Scoring Engine — Comparable Offer Validator
// ═══════════════════════════════════════════════════════════════════════════════
//
// Post-scoring consistency pass that ensures cheaper comparable offers
// rank higher than more expensive ones — unless there is a documented,
// justified reason for the price premium (better baggage, flexibility,
// provider reliability with meaningful risk, etc.).
//
// "Comparable" = same origin/dest, trip type, cabin, stop count,
// baggage coverage, similar duration (≤15 min), similar schedule,
// no critical provider warning, no major fare flexibility difference.

import type { ScoringFeatures, FlightScoreOutput } from './FlightScoringTypes';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ComparableCandidate {
  features: ScoringFeatures;
  score: FlightScoreOutput;
}

export interface ComparableAdjustment {
  offerId: string;
  oldScore: number;
  newScore: number;
  reason: string;
}

export interface ComparableValidationResult {
  adjustments: ComparableAdjustment[];
}

// ── Grouping key ─────────────────────────────────────────────────────────────

function comparableGroupKey(f: ScoringFeatures): string {
  // Group by: trip type, stop count, baggage coverage, departure hour bucket
  const depBucket = Math.floor(f.schedule.outboundDepartureHour / 4); // 4-hour buckets
  const bagKey = `${f.baggage.carryOnPieces}co_${f.baggage.checkedBagsIncluded}cb`;

  return `${f.tripType}|${f.totalStops}stops|${bagKey}|dep${depBucket}`;
}

// ── Duration comparability check ─────────────────────────────────────────────

function isDurationComparable(a: ScoringFeatures, b: ScoringFeatures): boolean {
  return Math.abs(a.totalDurationMinutes - b.totalDurationMinutes) <= 15;
}

// ── Schedule comparability check ─────────────────────────────────────────────

function isScheduleComparable(a: ScoringFeatures, b: ScoringFeatures): boolean {
  // Outbound departure within 2 hours
  if (Math.abs(a.schedule.outboundDepartureHour - b.schedule.outboundDepartureHour) > 2) {
    return false;
  }
  // For round-trip: also check return departure within 2 hours
  if (
    a.schedule.returnDepartureHour != null &&
    b.schedule.returnDepartureHour != null
  ) {
    if (Math.abs(a.schedule.returnDepartureHour - b.schedule.returnDepartureHour) > 2) {
      return false;
    }
  }
  return true;
}

// ── Justified price premium check ────────────────────────────────────────────
//
// Returns a reason string if the more expensive offer has a legitimate
// advantage over the cheaper offer. Returns null if no justification exists.

function findJustifiedPremium(
  expensive: ComparableCandidate,
  cheaper: ComparableCandidate,
): string | null {
  const ef = expensive.features;
  const cf = cheaper.features;
  const es = expensive.score.scoreBreakdown;
  const cs = cheaper.score.scoreBreakdown;

  // 1. Better baggage (meaningful difference — not just 1 vs 1)
  const eBagValue = ef.baggage.carryOnPieces + ef.baggage.checkedBagsIncluded * 2;
  const cBagValue = cf.baggage.carryOnPieces + cf.baggage.checkedBagsIncluded * 2;
  if (eBagValue > cBagValue + 1) {
    return `Better baggage coverage (${ef.baggage.checkedBagsIncluded} checked vs ${cf.baggage.checkedBagsIncluded})`;
  }

  // 2. Better fare flexibility (meaningful difference)
  const eFlexScore = (ef.fareFlexibility.refundable ? 2 : 0) + (ef.fareFlexibility.changeable ? 1 : 0);
  const cFlexScore = (cf.fareFlexibility.refundable ? 2 : 0) + (cf.fareFlexibility.changeable ? 1 : 0);
  if (eFlexScore > cFlexScore) {
    if (ef.fareFlexibility.refundable && !cf.fareFlexibility.refundable) {
      return 'Refundable fare vs non-refundable';
    }
    if (ef.fareFlexibility.changeable && !cf.fareFlexibility.changeable) {
      return 'Changeable fare vs non-changeable';
    }
  }

  // 3. Provider reliability — only if there's a MEANINGFUL risk difference (≥15 pts)
  //    The 2-3% weight of providerReliability should NOT overpower price.
  if (es.providerReliabilityScore - cs.providerReliabilityScore >= 15) {
    // Check if the cheaper offer has actual critical provider warnings
    const cheaperHasProviderWarning = cheaper.score.scoreBreakdown.warningDetails.some(
      w => w.code === 'PROVIDER_REVALIDATION_RISK' || w.code === 'SUSPICIOUS_PRICE' || w.code === 'LOW_DATA_CONFIDENCE'
    );
    if (cheaperHasProviderWarning) {
      return 'Better provider reliability — cheaper option has revalidation/pricing risk';
    }
  }

  // 4. Shorter duration (>15 min faster — beyond the comparable threshold)
  if (ef.totalDurationMinutes < cf.totalDurationMinutes - 15) {
    return `Faster by ${Math.round(cf.totalDurationMinutes - ef.totalDurationMinutes)} minutes`;
  }

  // 5. Better schedule (≥15 pts difference)
  if (es.scheduleScore - cs.scheduleScore >= 15) {
    return 'Significantly better departure/arrival times';
  }

  // 6. Fewer stops (shouldn't happen in comparable group, but safety check)
  if (ef.totalStops < cf.totalStops) {
    return `Fewer stops (${ef.totalStops} vs ${cf.totalStops})`;
  }

  // 7. Cheaper offer has critical warnings that expensive doesn't
  const cheaperCritical = cheaper.score.scoreBreakdown.warningDetails.filter(
    w => w.severity === 'CRITICAL'
  );
  const expensiveCritical = expensive.score.scoreBreakdown.warningDetails.filter(
    w => w.severity === 'CRITICAL'
  );
  if (cheaperCritical.length > 0 && expensiveCritical.length === 0) {
    return `Cheaper option has critical risk: ${cheaperCritical[0].message}`;
  }

  // No justified reason found
  return null;
}

// ── Score spreading within comparable groups ─────────────────────────────────

function comparableGroupSpread(
  priceDiffPct: number,
  baseScore: number,
): number {
  // How much lower should this offer score relative to the cheapest comparable?
  if (priceDiffPct <= 3) return Math.min(2, baseScore * 0.02);
  if (priceDiffPct <= 5) return Math.min(4, baseScore * 0.04);
  if (priceDiffPct <= 10) return Math.min(7, baseScore * 0.07);
  return Math.min(10, baseScore * 0.10);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main validation function
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Post-scoring comparable-offer consistency pass.
 *
 * After base scores and warning penalties are calculated, this function
 * groups comparable offers and ensures cheaper offers rank at or above
 * more expensive comparable offers — unless a justified premium exists.
 *
 * Mutates the `score.finalScore`, `score.aiScoreRaw`, `score.aiScoreDisplay`
 * fields on the candidates.
 */
export function validateComparableOffers(
  candidates: ComparableCandidate[],
): ComparableValidationResult {
  const adjustments: ComparableAdjustment[] = [];

  if (candidates.length < 2) return { adjustments };

  // 1. Build coarse groups by grouping key
  const coarseGroups = new Map<string, ComparableCandidate[]>();
  for (const c of candidates) {
    const key = comparableGroupKey(c.features);
    if (!coarseGroups.has(key)) coarseGroups.set(key, []);
    coarseGroups.get(key)!.push(c);
  }

  // 2. For each coarse group, refine into truly comparable sub-groups
  for (const [_, coarseGroup] of coarseGroups) {
    if (coarseGroup.length < 2) continue;

    // Build fine-grained comparable clusters using duration + schedule checks
    const processed = new Set<string>();
    const clusters: ComparableCandidate[][] = [];

    for (let i = 0; i < coarseGroup.length; i++) {
      if (processed.has(coarseGroup[i].features.offerId)) continue;

      const cluster: ComparableCandidate[] = [coarseGroup[i]];
      processed.add(coarseGroup[i].features.offerId);

      for (let j = i + 1; j < coarseGroup.length; j++) {
        if (processed.has(coarseGroup[j].features.offerId)) continue;

        if (
          isDurationComparable(coarseGroup[i].features, coarseGroup[j].features) &&
          isScheduleComparable(coarseGroup[i].features, coarseGroup[j].features)
        ) {
          cluster.push(coarseGroup[j]);
          processed.add(coarseGroup[j].features.offerId);
        }
      }

      if (cluster.length >= 2) {
        clusters.push(cluster);
      }
    }

    // 3. Apply consistency rules to each comparable cluster
    for (const cluster of clusters) {
      applyConsistencyRules(cluster, adjustments);
    }
  }

  return { adjustments };
}

// ── Apply consistency rules within a comparable cluster ──────────────────────

function applyConsistencyRules(
  cluster: ComparableCandidate[],
  adjustments: ComparableAdjustment[],
): void {
  // Sort cluster by effective price ascending
  const sorted = [...cluster].sort(
    (a, b) => a.features.effectiveTotalPrice - b.features.effectiveTotalPrice
  );

  const cheapest = sorted[0];
  const cheapestPrice = cheapest.features.effectiveTotalPrice;
  const cheapestScore = cheapest.score.finalScore;

  // Ensure the cheapest offer has the highest score in this group
  // (or document why it doesn't)
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const currentPrice = current.features.effectiveTotalPrice;
    const priceDiffPct = ((currentPrice - cheapestPrice) / cheapestPrice) * 100;

    if (current.score.finalScore > cheapest.score.finalScore) {
      // More expensive offer ranks higher — check if justified
      const justification = findJustifiedPremium(current, cheapest);

      if (justification) {
        // Justified — add debug info but don't adjust
        // The score difference is documented
        continue;
      }

      // NOT justified — adjust scores
      const oldCheapestScore = cheapest.score.finalScore;
      const oldCurrentScore = current.score.finalScore;

      // Boost the cheaper offer to at least match
      const targetCheapestScore = Math.max(cheapest.score.finalScore, current.score.finalScore);
      cheapest.score.finalScore = targetCheapestScore;
      cheapest.score.aiScoreRaw = targetCheapestScore;
      cheapest.score.aiScoreDisplay = Math.round(targetCheapestScore);
      cheapest.score.comparableAdjustmentReason =
        `Boosted: cheaper than comparable offer ($${currentPrice.toFixed(0)} vs $${cheapestPrice.toFixed(0)}) with no justified premium`;

      adjustments.push({
        offerId: cheapest.features.offerId,
        oldScore: oldCheapestScore,
        newScore: targetCheapestScore,
        reason: cheapest.score.comparableAdjustmentReason,
      });
    }

    // Apply comparable-group score spreading
    // More expensive comparable offers should score appropriately lower
    if (current.score.finalScore >= cheapest.score.finalScore) {
      const justification = findJustifiedPremium(current, cheapest);
      if (!justification) {
        const spread = comparableGroupSpread(priceDiffPct, cheapest.score.finalScore);
        const targetScore = Math.max(0, cheapest.score.finalScore - spread);

        if (current.score.finalScore > targetScore) {
          const oldScore = current.score.finalScore;
          current.score.finalScore = targetScore;
          current.score.aiScoreRaw = targetScore;
          current.score.aiScoreDisplay = Math.round(targetScore);
          current.score.comparableAdjustmentReason =
            `Reduced: ${priceDiffPct.toFixed(1)}% more expensive than cheapest comparable ($${cheapestPrice.toFixed(0)}) with no justified premium`;

          adjustments.push({
            offerId: current.features.offerId,
            oldScore,
            newScore: targetScore,
            reason: current.score.comparableAdjustmentReason,
          });
        }
      }
    }
  }
}
