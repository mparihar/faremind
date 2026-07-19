// ═══════════════════════════════════════════════════════════════════════════════
// Refundability Upgrade Rule — Contextual Scoring Adjustment
// ═══════════════════════════════════════════════════════════════════════════════
//
// Reference fare = median of 3 cheapest comparable changeable fares.
// NOT the nearest-by-price changeable fare.
//
// Bonus × comparability factor for non-exact matches.
// Penalty for >20% premium to counteract Dim 7 + warning advantage.

import type { ScoringFeatures, FlightScoreOutput } from './FlightScoringTypes';
import type { RefundabilityUpgradeConfig } from './FlightScoringConfig';
import {
  findNearestChangeableFare,
  getComparabilityFactor,
  type FareMatchCandidate,
  type MatchLevel,
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
  matchLevel: MatchLevel | null;
  comparabilityFactor: number;
  rawBonus: number;
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
    if (!f.fareFlexibility.refundable) continue;

    // Find reference changeable fare (median of 3 cheapest in comparable group)
    const matchResult = findNearestChangeableFare(
      { features: f, cabinClass: candidate.cabinClass, currency: candidate.currency },
      matchCandidates,
      config,
    );

    if (!matchResult.match) continue;

    const referencePrice = matchResult.referencePrice;
    const refundablePrice = f.effectiveTotalPrice;
    if (referencePrice <= 0) continue;

    // Premium % = (refundable - reference) / reference × 100
    let premiumPct: number;
    if (refundablePrice <= referencePrice) {
      premiumPct = 0;
    } else {
      premiumPct = ((refundablePrice - referencePrice) / referencePrice) * 100;
    }

    // Debug log — helps verify comparator selection
    console.log(
      `[RefundUpgrade] $${Math.round(refundablePrice)} refundable ` +
      `vs $${Math.round(referencePrice)} reference (${matchResult.matchLevel}, ` +
      `group=${matchResult.groupSize}) → ${premiumPct.toFixed(1)}% premium`
    );

    const rawBonus = premiumToBonus(premiumPct, config);
    const factor = getComparabilityFactor(
      matchResult.matchLevel,
      matchResult.stopDiff,
      matchResult.durationRatio,
    );

    if (rawBonus > 0) {
      // ── Eligible: bonus × comparability factor ──
      const finalBonus = Math.round(rawBonus * factor);

      console.log(
        `  → Raw bonus: +${rawBonus}, factor: ${factor}, final: +${finalBonus}`
      );

      if (finalBonus > 0) {
        applyAdjustment(candidate.scoreOutput, finalBonus, premiumPct, matchResult.match.features.offerId);
        adjustments.push({
          offerId: f.offerId,
          bonus: finalBonus,
          premiumPct: Math.round(premiumPct * 100) / 100,
          baselineOfferId: matchResult.match.features.offerId,
          baselinePrice: referencePrice,
          matchLevel: matchResult.matchLevel,
          comparabilityFactor: factor,
          rawBonus,
        });
      }
    } else {
      // ── Overpriced (>20%): penalty ──
      let penalty = 0;
      for (const band of config.overpricingPenaltyBands) {
        if (premiumPct <= band.maxPct) {
          penalty = band.bonus;
          break;
        }
      }
      if (penalty === 0 && config.overpricingPenaltyBands.length > 0 && premiumPct > 0) {
        penalty = config.overpricingPenaltyBands[config.overpricingPenaltyBands.length - 1].bonus;
      }

      console.log(`  → OVERPRICED: penalty ${penalty}`);

      if (penalty < 0) {
        applyAdjustment(candidate.scoreOutput, penalty, premiumPct, matchResult.match.features.offerId);
        adjustments.push({
          offerId: f.offerId,
          bonus: penalty,
          premiumPct: Math.round(premiumPct * 100) / 100,
          baselineOfferId: matchResult.match.features.offerId,
          baselinePrice: referencePrice,
          matchLevel: matchResult.matchLevel,
          comparabilityFactor: factor,
          rawBonus: 0,
        });
      }
    }
  }

  return { adjustments };
}
