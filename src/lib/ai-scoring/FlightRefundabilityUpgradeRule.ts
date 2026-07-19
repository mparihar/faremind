// ═══════════════════════════════════════════════════════════════════════════════
// Refundability Upgrade Rule — Contextual Scoring Adjustment
// ═══════════════════════════════════════════════════════════════════════════════
//
// Evaluated AFTER the 8-dimension base score and BEFORE warning penalties.
//
// Reference fare = nearest valid comparable changeable fare (by absolute price
// difference), NOT cheapest, NOT median.
//
// Premium formula:
//   premiumPct = ((refundableFare - matchedChangeableFare) / matchedChangeableFare) × 100
//
// Qualification:
//   IF refundableFare <= matchedChangeableFare        → qualifies (bonus)
//   ELSE IF 0 <= premiumPct <= configuredMax (20%)    → qualifies (bonus)
//   ELSE                                              → overpriced (penalty)

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
  qualifies: boolean;
}

export interface UpgradeResult {
  adjustments: UpgradeAdjustment[];
  /** Map of qualifying refundable offerId → matched changeable offerId */
  qualifiedPairs: Map<string, string>;
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

function premiumBandLabel(premiumPct: number, config: RefundabilityUpgradeConfig): string {
  if (premiumPct <= 0) return '<=0%';
  for (const band of config.premiumBands) {
    if (premiumPct <= band.maxPct) return `<=${band.maxPct}%`;
  }
  for (const band of config.overpricingPenaltyBands) {
    if (premiumPct <= band.maxPct) return `overpriced_${band.maxPct}%`;
  }
  return 'overpriced_max';
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
  const qualifiedPairs = new Map<string, string>();

  if (!config.enabled || candidates.length < 2) {
    return { adjustments, qualifiedPairs };
  }

  const matchCandidates: FareMatchCandidate[] = candidates.map(c => ({
    features: c.features,
    cabinClass: c.cabinClass,
    currency: c.currency,
  }));

  for (const candidate of candidates) {
    const f = candidate.features;
    if (!f.fareFlexibility.refundable) continue;

    // Find nearest valid comparable changeable fare
    const matchResult = findNearestChangeableFare(
      { features: f, cabinClass: candidate.cabinClass, currency: candidate.currency },
      matchCandidates,
      config,
    );

    if (!matchResult.match) {
      console.log(
        `[RefundUpgrade] $${Math.round(f.effectiveTotalPrice)} refundable (${f.offerId}) ` +
        `→ NO comparable changeable fare found — no adjustment`
      );
      continue;
    }

    const matchedPrice = matchResult.match.features.effectiveTotalPrice;
    const refundablePrice = f.effectiveTotalPrice;
    if (matchedPrice <= 0) continue;

    // Premium % = (refundable - matched) / matched × 100
    let premiumPct: number;
    if (refundablePrice <= matchedPrice) {
      premiumPct = 0;
    } else {
      premiumPct = ((refundablePrice - matchedPrice) / matchedPrice) * 100;
    }

    const rawBonus = premiumToBonus(premiumPct, config);
    const factor = getComparabilityFactor(
      matchResult.matchLevel,
      matchResult.stopDiff,
      matchResult.durationRatio,
    );
    const bandLabel = premiumBandLabel(premiumPct, config);

    // ── Diagnostic output (§9) ──
    console.log(
      `[RefundUpgrade] offerId=${f.offerId} ` +
      `rawFare=$${Math.round(f.rawTotalPrice)} effectiveFare=$${Math.round(refundablePrice)} ` +
      `refundable=true changeable=${f.fareFlexibility.changeable} ` +
      `matchedId=${matchResult.match.features.offerId} ` +
      `level=${matchResult.matchLevel} ` +
      `matchedFare=$${Math.round(matchedPrice)} ` +
      `absDiff=$${Math.round(Math.abs(refundablePrice - matchedPrice))} ` +
      `premiumPct=${premiumPct.toFixed(2)}% ` +
      `threshold=${config.premiumBands[config.premiumBands.length - 1]?.maxPct ?? 20}% ` +
      `band=${bandLabel} ` +
      `rawBonus=${rawBonus > 0 ? '+' : ''}${rawBonus} factor=${factor}`
    );

    if (rawBonus > 0) {
      // ── Qualifies: bonus × comparability factor ──
      const finalBonus = Math.round(rawBonus * factor);

      if (finalBonus > 0) {
        applyAdjustment(candidate.scoreOutput, finalBonus, premiumPct, matchResult.match.features.offerId);
        qualifiedPairs.set(f.offerId, matchResult.match.features.offerId);

        console.log(
          `  → QUALIFIES: rawBonus=+${rawBonus} × factor=${factor} = +${finalBonus} ` +
          `baseScore=${candidate.scoreOutput.baseScore.toFixed(2)} finalScore=${candidate.scoreOutput.finalScore.toFixed(2)}`
        );

        adjustments.push({
          offerId: f.offerId,
          bonus: finalBonus,
          premiumPct: Math.round(premiumPct * 100) / 100,
          baselineOfferId: matchResult.match.features.offerId,
          baselinePrice: matchedPrice,
          matchLevel: matchResult.matchLevel,
          comparabilityFactor: factor,
          rawBonus,
          qualifies: true,
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

      console.log(`  → OVERPRICED: penalty=${penalty}`);

      if (penalty < 0) {
        applyAdjustment(candidate.scoreOutput, penalty, premiumPct, matchResult.match.features.offerId);

        adjustments.push({
          offerId: f.offerId,
          bonus: penalty,
          premiumPct: Math.round(premiumPct * 100) / 100,
          baselineOfferId: matchResult.match.features.offerId,
          baselinePrice: matchedPrice,
          matchLevel: matchResult.matchLevel,
          comparabilityFactor: factor,
          rawBonus: 0,
          qualifies: false,
        });
      }
    }
  }

  return { adjustments, qualifiedPairs };
}
