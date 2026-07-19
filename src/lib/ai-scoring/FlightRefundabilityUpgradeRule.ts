// ═══════════════════════════════════════════════════════════════════════════════
// Refundability Upgrade Rule — Contextual Scoring Adjustment
// ═══════════════════════════════════════════════════════════════════════════════
//
// Evaluated AFTER the 8-dimension base score and BEFORE warning penalties.
//
// A fully refundable fare receives a score bonus when it costs between 0% and
// 20% more than its nearest comparable changeable fare (weighted by
// comparability factor for non-exact matches).
//
// Fares with premium >20% receive an overpricing penalty to counteract the
// inherent advantage from Dimension 7 flex score + NON_REFUNDABLE warning savings.

import type { ScoringFeatures, FlightScoreOutput } from './FlightScoringTypes';
import type { RefundabilityUpgradeConfig } from './FlightScoringConfig';
import {
  findNearestChangeableFare,
  getComparabilityFactor,
  type FareMatchCandidate,
} from './FlightComparableFareMatcher';

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

function premiumToBonus(
  premiumPct: number,
  config: RefundabilityUpgradeConfig,
): number {
  if (premiumPct <= 0) {
    return Math.min(config.premiumBands[0]?.bonus ?? 0, config.maxBonusCap);
  }
  for (const band of config.premiumBands) {
    if (premiumPct <= band.maxPct) {
      return Math.min(band.bonus, config.maxBonusCap);
    }
  }
  return 0;
}

// ── Apply adjustment to score output ─────────────────────────────────────────

function applyAdjustment(
  so: FlightScoreOutput,
  adjustment: number,
  premiumPct: number,
  baselineId: string,
): void {
  so.refundabilityUpgradeBonus = adjustment;
  so.refundabilityUpgradeBaselineId = baselineId;
  so.baseScore += adjustment;
  so.finalScore += adjustment;
  so.aiScoreRaw = Math.round(so.finalScore * 100) / 100;
  so.aiScoreDisplay = Math.round(so.finalScore);
  so.scoreBreakdown.refundabilityUpgradeBonus = adjustment;
  so.scoreBreakdown.refundabilityUpgradePremiumPct = Math.round(premiumPct * 100) / 100;
}

// ── Main rule ────────────────────────────────────────────────────────────────

export function applyRefundabilityUpgrades(
  candidates: UpgradeCandidate[],
  config: RefundabilityUpgradeConfig,
): UpgradeResult {
  const adjustments: UpgradeAdjustment[] = [];

  if (!config.enabled || candidates.length < 2) {
    return { adjustments };
  }

  const matchCandidates: FareMatchCandidate[] = candidates.map(c => ({
    features: c.features,
    cabinClass: c.cabinClass,
    currency: c.currency,
  }));

  for (const candidate of candidates) {
    const f = candidate.features;

    // Only evaluate fully refundable offers
    if (!f.fareFlexibility.refundable) continue;

    // Find nearest comparable changeable fare (3-level hierarchy)
    const matchResult = findNearestChangeableFare(
      { features: f, cabinClass: candidate.cabinClass, currency: candidate.currency },
      matchCandidates,
      config,
    );

    if (!matchResult.match) continue;

    const changeablePrice = matchResult.match.features.effectiveTotalPrice;
    const refundablePrice = f.effectiveTotalPrice;

    if (changeablePrice <= 0) continue;

    // Calculate premium percentage
    let premiumPct: number;
    if (refundablePrice <= changeablePrice) {
      premiumPct = 0;
    } else {
      premiumPct = ((refundablePrice - changeablePrice) / changeablePrice) * 100;
    }

    // Get raw bonus from premium bands
    const rawBonus = premiumToBonus(premiumPct, config);

    if (rawBonus > 0) {
      // ── Eligible: apply bonus × comparability factor ──
      const factor = getComparabilityFactor(
        matchResult.matchLevel,
        matchResult.stopDiff,
        matchResult.durationRatio,
      );
      const finalBonus = Math.round(rawBonus * factor);

      if (finalBonus > 0) {
        applyAdjustment(
          candidate.scoreOutput,
          finalBonus,
          premiumPct,
          matchResult.match.features.offerId,
        );

        adjustments.push({
          offerId: f.offerId,
          bonus: finalBonus,
          premiumPct: Math.round(premiumPct * 100) / 100,
          baselineOfferId: matchResult.match.features.offerId,
          baselinePrice: changeablePrice,
        });
      }
    } else {
      // ── Overpriced (>20%): apply penalty ──
      let penalty = 0;
      for (const band of config.overpricingPenaltyBands) {
        if (premiumPct <= band.maxPct) {
          penalty = band.bonus; // negative value
          break;
        }
      }
      if (penalty === 0 && config.overpricingPenaltyBands.length > 0 && premiumPct > 0) {
        penalty = config.overpricingPenaltyBands[config.overpricingPenaltyBands.length - 1].bonus;
      }

      if (penalty < 0) {
        applyAdjustment(
          candidate.scoreOutput,
          penalty,
          premiumPct,
          matchResult.match.features.offerId,
        );

        adjustments.push({
          offerId: f.offerId,
          bonus: penalty,
          premiumPct: Math.round(premiumPct * 100) / 100,
          baselineOfferId: matchResult.match.features.offerId,
          baselinePrice: changeablePrice,
        });
      }
    }
  }

  return { adjustments };
}
