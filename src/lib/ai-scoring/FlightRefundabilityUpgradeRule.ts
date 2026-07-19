// ═══════════════════════════════════════════════════════════════════════════════
// Refundability Upgrade Rule — Contextual Scoring Adjustment
// ═══════════════════════════════════════════════════════════════════════════════
//
// Evaluated AFTER the 8-dimension base score and BEFORE warning penalties.
//
// A fully refundable fare receives a score bonus when it costs between 0% and
// 20% more than its nearest comparable changeable fare.
//
// This rule does NOT replace Dimension 7 (Fare Flexibility). Dimension 7 scores
// the intrinsic flexibility of an offer, while this rule evaluates whether full
// refundability is available for a reasonable incremental price.
//
// The bonus is independently capped to prevent excessive double weighting.

import type { ScoringFeatures, FlightScoreOutput } from './FlightScoringTypes';
import type { RefundabilityUpgradeConfig } from './FlightScoringConfig';
import { findNearestChangeableFare, type FareMatchCandidate } from './FlightComparableFareMatcher';

// ── Types ────────────────────────────────────────────────────────────────────

export interface UpgradeCandidate {
  features: ScoringFeatures;
  scoreOutput: FlightScoreOutput;
  cabinClass: string;
  currency: string;
}

export interface UpgradeAdjustment {
  offerId: string;
  bonus: number;
  premiumPct: number;
  baselineOfferId: string;
  baselinePrice: number;
}

export interface UpgradeResult {
  adjustments: UpgradeAdjustment[];
}

// ── Premium to bonus mapping ─────────────────────────────────────────────────

/**
 * Map a refundable premium percentage to a score bonus using configured bands.
 *
 * A cheaper refundable fare (premiumPct <= 0) receives the highest band bonus.
 * Premiums above the last band threshold receive 0.
 */
function premiumToBonus(
  premiumPct: number,
  config: RefundabilityUpgradeConfig,
): number {
  // Cheaper or equal = gets highest bonus
  if (premiumPct <= 0) {
    return Math.min(config.premiumBands[0]?.bonus ?? 0, config.maxBonusCap);
  }

  // Find the applicable band
  for (const band of config.premiumBands) {
    if (premiumPct <= band.maxPct) {
      return Math.min(band.bonus, config.maxBonusCap);
    }
  }

  // Above all bands = no bonus
  return 0;
}

// ── Main rule ────────────────────────────────────────────────────────────────

/**
 * Apply refundability upgrade bonuses to all eligible refundable offers.
 *
 * For each fully refundable offer:
 * 1. Find the nearest comparable changeable, non-refundable fare
 * 2. Calculate the refundable premium percentage
 * 3. Award a bonus if the premium is within configured bands (0–20%)
 * 4. Apply the bonus to scoreOutput (baseScore and finalScore)
 *
 * Mutates scoreOutput fields directly on the candidates.
 */
export function applyRefundabilityUpgrades(
  candidates: UpgradeCandidate[],
  config: RefundabilityUpgradeConfig,
): UpgradeResult {
  const adjustments: UpgradeAdjustment[] = [];

  if (!config.enabled || candidates.length < 2) {
    return { adjustments };
  }

  // Build fare match candidates array (shared across all refundable lookups)
  const matchCandidates: FareMatchCandidate[] = candidates.map(c => ({
    features: c.features,
    cabinClass: c.cabinClass,
    currency: c.currency,
  }));

  for (const candidate of candidates) {
    const f = candidate.features;

    // Only evaluate fully refundable offers
    if (!f.fareFlexibility.refundable) continue;

    // Find nearest comparable changeable fare
    const matchResult = findNearestChangeableFare(
      { features: f, cabinClass: candidate.cabinClass, currency: candidate.currency },
      matchCandidates,
      config,
    );

    if (!matchResult.match) continue;

    const changeablePrice = matchResult.match.features.effectiveTotalPrice;
    const refundablePrice = f.effectiveTotalPrice;

    // Calculate premium percentage
    // A cheaper refundable fare uses effective premium of 0%
    let premiumPct: number;
    if (changeablePrice <= 0) continue; // safety
    if (refundablePrice <= changeablePrice) {
      premiumPct = 0;
    } else {
      premiumPct = ((refundablePrice - changeablePrice) / changeablePrice) * 100;
    }

    // Map to bonus
    const bonus = premiumToBonus(premiumPct, config);
    if (bonus <= 0) continue;

    // Apply bonus — add to baseScore, recompute finalScore
    const so = candidate.scoreOutput;
    so.refundabilityUpgradeBonus = bonus;
    so.refundabilityUpgradeBaselineId = matchResult.match.features.offerId;
    so.baseScore += bonus;
    so.finalScore += bonus;
    so.aiScoreRaw = Math.round(so.finalScore * 100) / 100;
    so.aiScoreDisplay = Math.round(so.finalScore);

    // Update breakdown
    so.scoreBreakdown.refundabilityUpgradeBonus = bonus;
    so.scoreBreakdown.refundabilityUpgradePremiumPct =
      Math.round(premiumPct * 100) / 100;

    adjustments.push({
      offerId: f.offerId,
      bonus,
      premiumPct: Math.round(premiumPct * 100) / 100,
      baselineOfferId: matchResult.match.features.offerId,
      baselinePrice: changeablePrice,
    });
  }

  return { adjustments };
}
