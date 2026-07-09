// ═══════════════════════════════════════════════════════════════════════════════
// Comparable Nonstop Low-Fare Validator
// ═══════════════════════════════════════════════════════════════════════════════
//
// Post-scoring validation layer (Step 8.55) that ensures cheaper nonstop
// flights are not ranked below more expensive nonstop flights when the
// important user-facing conditions are the same or materially similar.
//
// Comparable conditions (ALL must be true):
//   1. Both flights are nonstop (totalStops === 0)
//   2. Same cabin class
//   3. Same refundability category
//   4. Same changeability category
//   5. Same baggage category (carry-on/checked)
//   6. Duration difference ≤ 25 min domestic / ≤ 45 min international
//   7. No major schedule penalty difference
//
// Only active for: AI_PICK, BEST_VALUE, CHEAPEST modes.
// Does NOT apply to: FASTEST, COMFORT, user-filtered results.

import type { ScoringFeatures, FlightScoreOutput } from './FlightScoringTypes';

// ── Types ────────────────────────────────────────────────────────────────────

export interface NonstopComparableCandidate {
  features: ScoringFeatures;
  score: FlightScoreOutput;
  cabinClass: string;
}

export interface NonstopAdjustment {
  offerId: string;
  oldScore: number;
  newScore: number;
  boostTarget: string;   // offerId of the expensive offer that triggered the boost
  reason: string;
}

export interface NonstopValidationResult {
  adjustments: NonstopAdjustment[];
}

// ── Baggage category ─────────────────────────────────────────────────────────

function getBaggageCategory(features: ScoringFeatures): string {
  const bag = features.baggage;
  if (bag.checkedBagsIncluded > 0 && bag.carryOnIncluded) return 'checked+carryon';
  if (bag.checkedBagsIncluded > 0 && !bag.carryOnIncluded) return 'checked_only';
  if (bag.carryOnIncluded && bag.checkedBagsIncluded === 0) return 'carryon_only';
  return 'none';
}

// ── Comparable group key ─────────────────────────────────────────────────────

function getNonstopComparableKey(
  features: ScoringFeatures,
  cabinClass: string,
): string | null {
  // Only nonstop flights
  if (features.totalStops !== 0) return null;

  const cabin = (cabinClass || 'economy').toLowerCase();
  const refundable = features.fareFlexibility.refundable ? 'R' : 'NR';
  const changeable = features.fareFlexibility.changeable ? 'C' : 'NC';
  const bagCat = getBaggageCategory(features);

  return `${cabin}|${refundable}|${changeable}|${bagCat}`;
}

// ── Duration comparability ───────────────────────────────────────────────────

function isNonstopDurationComparable(
  a: ScoringFeatures,
  b: ScoringFeatures,
): boolean {
  const diff = Math.abs(a.totalDurationMinutes - b.totalDurationMinutes);
  const isIntl = a.isInternational || b.isInternational;
  const threshold = isIntl ? 45 : 25;
  return diff <= threshold;
}

// ── Meaningful advantage checks ──────────────────────────────────────────────
// An expensive offer may rank above a cheaper comparable only if it has a
// documented, material advantage.

function hasMeaningfulDurationAdvantage(
  expensive: ScoringFeatures,
  cheaper: ScoringFeatures,
): boolean {
  // Expensive must be faster by a significant margin
  const fasterBy = cheaper.totalDurationMinutes - expensive.totalDurationMinutes;
  if (fasterBy <= 0) return false; // expensive is not faster
  const isIntl = expensive.isInternational || cheaper.isInternational;
  const threshold = isIntl ? 60 : 30;
  return fasterBy >= threshold;
}

function hasMeaningfulScheduleAdvantage(
  expensiveScore: FlightScoreOutput,
  cheaperScore: FlightScoreOutput,
): boolean {
  // Schedule score gap ≥ 20 points indicates meaningfully better times
  // e.g. daytime departure vs red-eye / very early morning
  const schedDiff =
    expensiveScore.scoreBreakdown.scheduleScore -
    cheaperScore.scoreBreakdown.scheduleScore;
  return schedDiff >= 20;
}

// ── Main validator ───────────────────────────────────────────────────────────

/**
 * Scan all scored nonstop offers, group by comparable key, and ensure
 * cheaper offers within each group are not ranked below more expensive ones.
 *
 * Mutates `score` fields directly on the candidates when an adjustment
 * is needed (same pattern as FlightComparableValidator).
 */
export function validateComparableNonstops(
  candidates: NonstopComparableCandidate[],
): NonstopValidationResult {
  const adjustments: NonstopAdjustment[] = [];

  if (candidates.length < 2) return { adjustments };

  // ── Group by comparable key ──
  const groups = new Map<string, number[]>();
  for (let i = 0; i < candidates.length; i++) {
    const key = getNonstopComparableKey(
      candidates[i].features,
      candidates[i].cabinClass,
    );
    if (!key) continue; // not nonstop — skip
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }

  // ── Validate each group ──
  const processed = new Set<string>();

  for (const [_key, indices] of groups) {
    if (indices.length < 2) continue;

    // Sort indices within group by effective price ascending
    const sorted = [...indices].sort(
      (a, b) =>
        candidates[a].features.effectiveTotalPrice -
        candidates[b].features.effectiveTotalPrice,
    );

    // Walk price-ascending: ensure each cheaper offer ranks ≥ all more expensive ones
    for (let i = 0; i < sorted.length; i++) {
      const cheaperIdx = sorted[i];
      const cheaper = candidates[cheaperIdx];

      for (let j = i + 1; j < sorted.length; j++) {
        const expensiveIdx = sorted[j];
        const expensive = candidates[expensiveIdx];

        // Skip if already adjusted this cheaper offer
        if (processed.has(cheaper.features.offerId)) continue;

        // Duration comparability within the group
        if (!isNonstopDurationComparable(cheaper.features, expensive.features)) {
          continue;
        }

        // Cheaper already ranks higher — no fix needed
        if (cheaper.score.finalScore >= expensive.score.finalScore) continue;

        // Check if the expensive offer has a meaningful advantage
        if (hasMeaningfulDurationAdvantage(expensive.features, cheaper.features)) {
          continue;
        }
        if (hasMeaningfulScheduleAdvantage(expensive.score, cheaper.score)) {
          continue;
        }

        // ── Boost cheaper offer ──
        const oldScore = cheaper.score.finalScore;
        const targetScore = Math.max(
          cheaper.score.finalScore,
          expensive.score.finalScore + 0.5,
        );

        cheaper.score.finalScore = targetScore;
        cheaper.score.aiScoreRaw = targetScore;
        cheaper.score.aiScoreDisplay = Math.round(targetScore);

        const priceDiff =
          expensive.features.effectiveTotalPrice -
          cheaper.features.effectiveTotalPrice;
        const pctCheaper =
          ((priceDiff / expensive.features.effectiveTotalPrice) * 100).toFixed(1);

        adjustments.push({
          offerId: cheaper.features.offerId,
          oldScore,
          newScore: targetScore,
          boostTarget: expensive.features.offerId,
          reason:
            `Comparable nonstop: $${cheaper.features.effectiveTotalPrice.toFixed(0)} ` +
            `vs $${expensive.features.effectiveTotalPrice.toFixed(0)} ` +
            `(${pctCheaper}% cheaper, same conditions)`,
        });

        processed.add(cheaper.features.offerId);
      }
    }
  }

  return { adjustments };
}
