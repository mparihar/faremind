/**
 * Context-Aware Flexibility Score
 *
 * This is the most complex scorer. It does NOT score refundability/changeability
 * as a static value — instead it scores it relative to the price premium.
 *
 * 4-step process:
 *   1. Assign flexibility benefit score based on fare rules
 *   2. Compute price premium over cheapest comparable fare
 *   3. Lookup value score from premium thresholds (domestic vs international)
 *   4. Blend: flexibilityScore = (benefitScore * 0.5) + (valueScore * 0.5)
 *
 * Special rule: if refundable premium is high but changeable premium is
 * reasonable, the changeable fare gets a boost.
 */

import type { FlexibilityType, FlexibilityThreshold, JourneyType } from '../types';

// ── Step 1: Flexibility benefit scores ────────────────────────────────────────

const FLEXIBILITY_BENEFIT_SCORES: Record<FlexibilityType, number> = {
  nonChangeableNonRefundable: 20,
  changeableWithFee: 55,
  changeableNoFee: 70,
  refundableWithFee: 80,
  fullyRefundable: 100,
};

/**
 * Classify fare flexibility type from fare rules.
 */
export function classifyFlexibility(
  refundable: boolean,
  changeable: boolean,
  cancellationFee: number | undefined,
  changeFee: number | undefined,
): FlexibilityType {
  if (refundable && (cancellationFee === undefined || cancellationFee === 0)) {
    return 'fullyRefundable';
  }
  if (refundable && cancellationFee !== undefined && cancellationFee > 0) {
    return 'refundableWithFee';
  }
  if (changeable && (changeFee === undefined || changeFee === 0)) {
    return 'changeableNoFee';
  }
  if (changeable) {
    return 'changeableWithFee';
  }
  return 'nonChangeableNonRefundable';
}

/**
 * Get the benefit score for a flexibility type.
 */
function getBenefitScore(flexType: FlexibilityType): number {
  return FLEXIBILITY_BENEFIT_SCORES[flexType];
}

// ── Step 2 & 3: Premium and value score ──────────────────────────────────────

/**
 * Compute premium percentage over cheapest fare.
 */
function computePremiumPercent(offerPrice: number, cheapestPrice: number): number {
  if (cheapestPrice <= 0) return 0;
  return ((offerPrice - cheapestPrice) / cheapestPrice) * 100;
}

/**
 * Look up value score from premium thresholds.
 */
function getValueScore(premiumPercent: number, thresholds: FlexibilityThreshold[]): number {
  // Thresholds are sorted by maxPremiumPercent ascending
  for (const threshold of thresholds) {
    if (premiumPercent <= threshold.maxPremiumPercent) {
      return threshold.valueScore;
    }
  }
  return 10; // fallback: very high premium
}

// ── Step 4: Compute final flexibility score ─────────────────────────────────

/**
 * Compute context-aware flexibility score.
 *
 * @param refundable - Whether the fare is refundable
 * @param changeable - Whether the fare is changeable
 * @param cancellationFee - Cancellation fee (0 = free, undefined = unknown)
 * @param changeFee - Change fee (0 = free, undefined = unknown)
 * @param offerPrice - This offer's total price
 * @param cheapestPrice - Cheapest comparable fare in the set
 * @param thresholds - Premium thresholds from profile config
 * @returns Score from 0 to 100
 */
export function scoreFlexibility(
  refundable: boolean,
  changeable: boolean,
  cancellationFee: number | undefined,
  changeFee: number | undefined,
  offerPrice: number,
  cheapestPrice: number,
  thresholds: FlexibilityThreshold[],
): number {
  const flexType = classifyFlexibility(refundable, changeable, cancellationFee, changeFee);
  const benefitScore = getBenefitScore(flexType);

  const premiumPercent = computePremiumPercent(offerPrice, cheapestPrice);
  const valueScore = getValueScore(premiumPercent, thresholds);

  // Blend: 50% benefit, 50% value
  const raw = (benefitScore * 0.5) + (valueScore * 0.5);
  return Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100;
}

/**
 * Apply the special "changeable beats refundable" rule.
 *
 * If a changeable fare has reasonable premium but refundable fare has high premium,
 * the changeable fare should get a boost. And if refundable is only slightly more
 * than changeable, refundable gets a boost.
 *
 * @param changeableScore - Pre-computed flexibility score for changeable fare
 * @param refundableScore - Pre-computed flexibility score for refundable fare
 * @param changeablePrice - Changeable fare price
 * @param refundablePrice - Refundable fare price
 * @param cheapestPrice - Cheapest comparable fare
 * @returns Object with adjusted scores for both
 */
export function applyChangeableVsRefundableRule(
  changeableScore: number,
  refundableScore: number,
  changeablePrice: number,
  refundablePrice: number,
  cheapestPrice: number,
): { adjustedChangeableScore: number; adjustedRefundableScore: number } {
  if (cheapestPrice <= 0) {
    return { adjustedChangeableScore: changeableScore, adjustedRefundableScore: refundableScore };
  }

  const changeablePremium = computePremiumPercent(changeablePrice, cheapestPrice);
  const refundablePremium = computePremiumPercent(refundablePrice, cheapestPrice);
  const premiumDiff = refundablePremium - changeablePremium;

  let adjustedChangeableScore = changeableScore;
  let adjustedRefundableScore = refundableScore;

  // If refundable is much more expensive (>30% premium gap), boost changeable
  if (premiumDiff > 30 && changeablePremium <= 20) {
    adjustedChangeableScore = Math.min(100, changeableScore + 8);
    adjustedRefundableScore = Math.max(0, refundableScore - 5);
  }
  // If refundable is only slightly more than changeable (<8% gap), boost refundable
  else if (premiumDiff > 0 && premiumDiff <= 8) {
    adjustedRefundableScore = Math.min(100, refundableScore + 6);
  }

  return { adjustedChangeableScore, adjustedRefundableScore };
}
