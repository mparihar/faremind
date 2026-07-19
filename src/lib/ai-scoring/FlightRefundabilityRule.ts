// ═══════════════════════════════════════════════════════════════════════════════
// Refundability Premium Rule
// ═══════════════════════════════════════════════════════════════════════════════
//
// Calculates the refundability adjustment applied AFTER base score, BEFORE
// warning penalties. Uses REFUNDABILITY_CONFIG, NOT the old upgrade config.
//
// adjustment = premiumBandValue × comparabilityFactor
//
// Comparability factors (per spec §4):
//   Same stops, dur diff ≤15%           → 1.00
//   Same stops, dur diff >15%–35%       → 0.85
//   +1 stop,    dur diff ≤20%           → 0.75
//   +1 stop,    dur diff >20%–35%       → 0.60
//
// Exports qualifiedPairs for the pairwise precedence service.

import type { ScoringFeatures, FlightScoreOutput } from './FlightScoringTypes';
import {
  findComparableChangeableFare,
  type FareMatchCandidate,
  type MatchLevel,
} from './FlightComparableFareMatcher';

// ── Config (per spec §614-648) ───────────────────────────────────────────────

export const REFUNDABILITY_CONFIG = {
  enabled: true,

  minPremiumPct: 0,
  maxPremiumPct: 20,

  maxDurationDifferencePct: 35,
  maxStopDifference: 1,

  premiumBands: [
    { maxPct: 5, adjustment: 15 },
    { maxPct: 10, adjustment: 12 },
    { maxPct: 15, adjustment: 8 },
    { maxPct: 20, adjustment: 5 },
  ],

  overpricingBands: [
    { maxPct: 35, adjustment: -3 },
    { maxPct: 50, adjustment: -5 },
    { maxPct: Number.POSITIVE_INFINITY, adjustment: -8 },
  ],

  comparabilityFactors: {
    exactSimilarDuration: 1.0,        // same stops, dur diff ≤15%
    exactModeratelyLonger: 0.85,      // same stops, dur diff >15%–35%
    oneExtraStopSimilarDuration: 0.75, // +1 stop,  dur diff ≤20%
    oneExtraStopModeratelyLonger: 0.60, // +1 stop, dur diff >20%–35%
  },

  applyLocalPairwisePrecedence: true,
  forceTopWindowRepresentation: false,
} as const;

// ── Types ────────────────────────────────────────────────────────────────────

export interface RefundabilityCandidate {
  features: ScoringFeatures;
  scoreOutput: FlightScoreOutput;
  cabinClass: string;
  currency: string;
}

export interface RefundabilityAdjustment {
  offerId: string;
  matchedComparableOfferId: string;
  matchedComparableFare: number;
  comparabilityLevel: MatchLevel | null;
  absolutePriceDifference: number;
  premiumPct: number;
  premiumBand: string;
  comparabilityFactor: number;
  refundabilityAdjustment: number;
  qualifies: boolean;
}

export interface RefundabilityResult {
  adjustments: RefundabilityAdjustment[];
  qualifiedPairs: Map<string, string>;
}

// ── Comparability factor (spec §4) ───────────────────────────────────────────

function getComparabilityFactor(
  matchLevel: MatchLevel | null,
  stopDiff: number,
  durationDiffPct: number,
): number {
  if (!matchLevel) return 0;

  const f = REFUNDABILITY_CONFIG.comparabilityFactors;

  if (matchLevel === 'exact') {
    // Same stops
    return durationDiffPct <= 15 ? f.exactSimilarDuration : f.exactModeratelyLonger;
  }

  // Near — +1 stop
  if (stopDiff >= 2) return 0;
  return durationDiffPct <= 20 ? f.oneExtraStopSimilarDuration : f.oneExtraStopModeratelyLonger;
}

// ── Premium band lookup ──────────────────────────────────────────────────────

function getPremiumAdjustment(premiumPct: number): { adjustment: number; band: string } {
  if (premiumPct <= 0) {
    return { adjustment: REFUNDABILITY_CONFIG.premiumBands[0].adjustment, band: '<=0%' };
  }
  for (const band of REFUNDABILITY_CONFIG.premiumBands) {
    if (premiumPct <= band.maxPct) {
      return { adjustment: band.adjustment, band: `<=${band.maxPct}%` };
    }
  }
  // Overpriced
  for (const band of REFUNDABILITY_CONFIG.overpricingBands) {
    if (premiumPct <= band.maxPct) {
      return { adjustment: band.adjustment, band: `overpriced_${band.maxPct === Infinity ? 'max' : band.maxPct}%` };
    }
  }
  return { adjustment: -8, band: 'overpriced_max' };
}

// ── Apply to score output ────────────────────────────────────────────────────

function applyToScore(
  so: FlightScoreOutput,
  adjustment: number,
  premiumPct: number,
  comparatorId: string,
): void {
  so.refundabilityUpgradeBonus = adjustment;
  so.refundabilityUpgradeBaselineId = comparatorId;
  so.baseScore += adjustment;
  so.finalScore += adjustment;
  so.aiScoreRaw = Math.round(so.finalScore * 100) / 100;
  so.aiScoreDisplay = Math.round(so.finalScore);
  so.scoreBreakdown.refundabilityUpgradeBonus = adjustment;
  so.scoreBreakdown.refundabilityUpgradePremiumPct = Math.round(premiumPct * 100) / 100;
}

// ── Main rule ────────────────────────────────────────────────────────────────

export function applyRefundabilityRule(
  candidates: RefundabilityCandidate[],
): RefundabilityResult {
  const adjustments: RefundabilityAdjustment[] = [];
  const qualifiedPairs = new Map<string, string>();

  if (!REFUNDABILITY_CONFIG.enabled || candidates.length < 2) {
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

    const matchResult = findComparableChangeableFare(
      { features: f, cabinClass: candidate.cabinClass, currency: candidate.currency },
      matchCandidates,
      REFUNDABILITY_CONFIG.maxDurationDifferencePct,
    );

    if (!matchResult.match) {
      console.log(
        `[RefundRule] $${Math.round(f.effectiveTotalPrice)} (${f.offerId}) → no comparable → no adjustment`
      );
      continue;
    }

    const comparatorPrice = matchResult.match.features.effectiveTotalPrice;
    const refundablePrice = f.effectiveTotalPrice;
    if (comparatorPrice <= 0) continue;

    // Premium %
    const premiumPct = refundablePrice <= comparatorPrice
      ? 0
      : ((refundablePrice - comparatorPrice) / comparatorPrice) * 100;

    const { adjustment: rawAdjustment, band } = getPremiumAdjustment(premiumPct);
    const factor = getComparabilityFactor(
      matchResult.matchLevel,
      matchResult.stopDiff,
      matchResult.durationDiffPct,
    );
    const finalAdjustment = Math.round(rawAdjustment * factor);
    const qualifies = finalAdjustment > 0;

    // Audit output (spec §11)
    console.log(
      `[RefundRule] offerId=${f.offerId} ` +
      `effectiveFare=$${Math.round(refundablePrice)} ` +
      `matchedId=${matchResult.match.features.offerId} ` +
      `level=${matchResult.matchLevel} ` +
      `matchedFare=$${Math.round(comparatorPrice)} ` +
      `absDiff=$${Math.round(Math.abs(refundablePrice - comparatorPrice))} ` +
      `premiumPct=${premiumPct.toFixed(2)}% ` +
      `band=${band} ` +
      `factor=${factor} ` +
      `adjustment=${finalAdjustment > 0 ? '+' : ''}${finalAdjustment} ` +
      `qualifies=${qualifies}`
    );

    if (finalAdjustment !== 0) {
      applyToScore(candidate.scoreOutput, finalAdjustment, premiumPct, matchResult.match.features.offerId);
    }

    if (qualifies) {
      qualifiedPairs.set(f.offerId, matchResult.match.features.offerId);
    }

    adjustments.push({
      offerId: f.offerId,
      matchedComparableOfferId: matchResult.match.features.offerId,
      matchedComparableFare: comparatorPrice,
      comparabilityLevel: matchResult.matchLevel,
      absolutePriceDifference: Math.round(Math.abs(refundablePrice - comparatorPrice)),
      premiumPct: Math.round(premiumPct * 100) / 100,
      premiumBand: band,
      comparabilityFactor: factor,
      refundabilityAdjustment: finalAdjustment,
      qualifies,
    });
  }

  return { adjustments, qualifiedPairs };
}
