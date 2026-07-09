// ═══════════════════════════════════════════════════════════════════════════════
// Fully Refundable Priority Validator
// ═══════════════════════════════════════════════════════════════════════════════
//
// Post-scoring validation layer (Step 8.58) that ensures fully refundable
// nonstop fares rank above otherwise-comparable changeable-only fares.
//
// Flexibility tiers (highest → lowest):
//   Tier 0: Fully refundable (refundable = true)
//   Tier 1: Changeable only  (changeable = true, refundable = false)
//   Tier 2: Neither          (non-refundable, non-changeable)
//
// Within a comparable nonstop group (same cabin, similar baggage, similar
// duration), a higher-tier offer must rank above a lower-tier offer
// UNLESS exceptions apply.
//
// Active for: AI_PICK, BEST_VALUE modes.
// NOT active for: CHEAPEST (Lowest Price tab), FASTEST, COMFORT.

import type { ScoringFeatures, FlightScoreOutput } from './FlightScoringTypes';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RefundablePriorityCandidate {
  features: ScoringFeatures;
  score: FlightScoreOutput;
  cabinClass: string;
}

export interface RefundableAdjustment {
  offerId: string;
  oldScore: number;
  newScore: number;
  reason: string;
}

export interface RefundablePriorityResult {
  adjustments: RefundableAdjustment[];
}

// ── Flexibility tier ─────────────────────────────────────────────────────────

function getFlexTier(features: ScoringFeatures): number {
  if (features.fareFlexibility.refundable) return 0;    // fully refundable
  if (features.fareFlexibility.changeable) return 1;    // changeable only
  return 2;                                              // neither
}

function tierLabel(tier: number): string {
  switch (tier) {
    case 0: return 'fully refundable';
    case 1: return 'changeable only';
    default: return 'non-refundable/non-changeable';
  }
}

// ── Baggage similarity ───────────────────────────────────────────────────────
// "Same or similar" — we allow minor differences. Group by broad category:
//   checked bags included (yes/no) + carry-on included (yes/no)

function getBroadBaggageKey(features: ScoringFeatures): string {
  const hasChecked = features.baggage.checkedBagsIncluded > 0;
  const hasCarryOn = features.baggage.carryOnIncluded;
  return `${hasChecked ? 'CB' : 'noCB'}_${hasCarryOn ? 'CO' : 'noCO'}`;
}

// ── Comparable group key ─────────────────────────────────────────────────────
// Groups by: nonstop + cabin + broad baggage.
// Flexibility is intentionally EXCLUDED from the key because we want to
// compare across tiers within the same group.

function getRefundableGroupKey(
  features: ScoringFeatures,
  cabinClass: string,
): string | null {
  if (features.totalStops !== 0) return null; // only nonstop
  const cabin = (cabinClass || 'economy').toLowerCase();
  const bagKey = getBroadBaggageKey(features);
  return `${cabin}|${bagKey}`;
}

// ── Duration comparability ───────────────────────────────────────────────────

function isDurationComparable(a: ScoringFeatures, b: ScoringFeatures): boolean {
  const diff = Math.abs(a.totalDurationMinutes - b.totalDurationMinutes);
  const isIntl = a.isInternational || b.isInternational;
  return diff <= (isIntl ? 45 : 25);
}

// ── Exception checks ─────────────────────────────────────────────────────────

function hasMeaningfulDurationAdvantage(
  lower: ScoringFeatures,
  higher: ScoringFeatures,
): boolean {
  // Lower-tier is significantly faster
  const fasterBy = higher.totalDurationMinutes - lower.totalDurationMinutes;
  if (fasterBy <= 0) return false;
  const isIntl = lower.isInternational || higher.isInternational;
  return fasterBy >= (isIntl ? 60 : 30);
}

function hasMeaningfulScheduleAdvantage(
  lowerScore: FlightScoreOutput,
  higherScore: FlightScoreOutput,
): boolean {
  // Lower-tier has much better schedule (20+ points)
  const schedDiff =
    lowerScore.scoreBreakdown.scheduleScore -
    higherScore.scoreBreakdown.scheduleScore;
  return schedDiff >= 20;
}

function isExtremePriceDifference(
  higherTierPrice: number,
  lowerTierPrice: number,
): boolean {
  if (lowerTierPrice <= 0) return false;
  // Refundable is > 35% more expensive than changeable
  return (higherTierPrice - lowerTierPrice) / lowerTierPrice > 0.35;
}

// ── Main validator ───────────────────────────────────────────────────────────

/**
 * Scan all scored nonstop offers, group by comparable key (excluding
 * flexibility), and ensure higher-flexibility-tier offers rank above
 * lower-tier ones within each group.
 *
 * Mutates `score` fields directly on the candidates.
 */
export function validateRefundablePriority(
  candidates: RefundablePriorityCandidate[],
): RefundablePriorityResult {
  const adjustments: RefundableAdjustment[] = [];

  if (candidates.length < 2) return { adjustments };

  // ── Group by comparable key (flex-tier excluded) ──
  const groups = new Map<string, number[]>();
  for (let i = 0; i < candidates.length; i++) {
    const key = getRefundableGroupKey(
      candidates[i].features,
      candidates[i].cabinClass,
    );
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }

  // ── Validate each group ──
  const processed = new Set<string>();

  for (const [_key, indices] of groups) {
    if (indices.length < 2) continue;

    // Check all pairs within the group
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        const idxA = indices[i];
        const idxB = indices[j];
        const a = candidates[idxA];
        const b = candidates[idxB];

        const tierA = getFlexTier(a.features);
        const tierB = getFlexTier(b.features);

        // Skip if same tier — handled by nonstop low-fare validator
        if (tierA === tierB) continue;

        // Identify higher-tier (lower number) and lower-tier
        const [higherTier, lowerTier] =
          tierA < tierB ? [a, b] : [b, a];
        const higherTierNum = Math.min(tierA, tierB);
        const lowerTierNum = Math.max(tierA, tierB);

        // Only apply when tiers are adjacent (0 vs 1) or (1 vs 2)
        // For refundable vs changeable: tier 0 vs tier 1
        // Also applies: refundable vs neither (tier 0 vs 2), changeable vs neither (tier 1 vs 2)

        // Duration comparability
        if (!isDurationComparable(higherTier.features, lowerTier.features)) continue;

        // Higher-tier already ranks above → no fix needed
        if (higherTier.score.finalScore >= lowerTier.score.finalScore) continue;

        // Skip if already processed
        if (processed.has(higherTier.features.offerId)) continue;

        // ── Exception checks ──

        // Extreme price difference: refundable is > 35% more expensive
        if (isExtremePriceDifference(
          higherTier.features.effectiveTotalPrice,
          lowerTier.features.effectiveTotalPrice,
        )) continue;

        // Lower-tier has much better schedule
        if (hasMeaningfulScheduleAdvantage(lowerTier.score, higherTier.score)) continue;

        // Lower-tier is significantly faster
        if (hasMeaningfulDurationAdvantage(lowerTier.features, higherTier.features)) continue;

        // ── Boost higher-tier offer ──
        const oldScore = higherTier.score.finalScore;
        const targetScore = Math.max(
          higherTier.score.finalScore,
          lowerTier.score.finalScore + 0.5,
        );

        higherTier.score.finalScore = targetScore;
        higherTier.score.aiScoreRaw = targetScore;
        higherTier.score.aiScoreDisplay = Math.round(targetScore);

        adjustments.push({
          offerId: higherTier.features.offerId,
          oldScore,
          newScore: targetScore,
          reason:
            `Refundable priority: ${tierLabel(higherTierNum)} ` +
            `($${higherTier.features.effectiveTotalPrice.toFixed(0)}) boosted above ` +
            `${tierLabel(lowerTierNum)} ` +
            `($${lowerTier.features.effectiveTotalPrice.toFixed(0)})`,
        });

        processed.add(higherTier.features.offerId);
      }
    }
  }

  return { adjustments };
}
