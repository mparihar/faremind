/**
 * Context-Aware Rules Engine
 *
 * Applies deterministic context rules to adjust final scores
 * before ranking. Each rule produces an AppliedRule with:
 *   - ruleId: identifier
 *   - impact: score adjustment (+/-)
 *   - reason: human-readable explanation
 *
 * Rules (spec §16):
 *   A: Dominance — cheaper + equal/better in all dimensions
 *   B: Small Premium Big Value — 5–10% premium with meaningful improvements
 *   C: Expensive Feature Penalty — >50% premium for one minor improvement
 *   D: Risky Connection — layover below safe threshold
 *   E: Long-Haul Comfort — boost comfort for >8h international segments
 *   F: Family Traveler — boost baggage, schedule; penalize risky connections
 *   G: Business Traveler — boost schedule, duration, reliability, flexibility
 *   H: Budget Traveler — boost price weight, reduce comfort/brand
 */

import type {
  AppliedRule,
  OfferFeatures,
  ScoreBreakdown,
  JourneyType,
  TravelerProfile,
  RankingWeights,
  LayoverThresholds,
  PassengerCount,
} from '../types';

interface ScoredOffer {
  offerId: string;
  features: OfferFeatures;
  breakdown: ScoreBreakdown;
  rawFinalScore: number;
}

interface ContextRuleInput {
  offers: ScoredOffer[];
  journeyType: JourneyType;
  travelerProfile: TravelerProfile;
  passengers: PassengerCount;
  enabledRules: string[];
  layoverThresholds: LayoverThresholds;
  cheapestPrice: number;
}

interface RuleResult {
  offerId: string;
  rules: AppliedRule[];
  scoreAdjustment: number;
}

// ── Rule A: Dominance ────────────────────────────────────────────────────────

function applyDominanceRule(offers: ScoredOffer[]): RuleResult[] {
  const results: RuleResult[] = offers.map(o => ({ offerId: o.offerId, rules: [], scoreAdjustment: 0 }));

  for (let i = 0; i < offers.length; i++) {
    for (let j = 0; j < offers.length; j++) {
      if (i === j) continue;
      const a = offers[i];
      const b = offers[j];

      // If A is cheaper AND equal-or-better in duration, stops, baggage, and flexibility
      const cheaper = a.features.totalPrice < b.features.totalPrice;
      const betterDuration = a.features.durationMinutes <= b.features.durationMinutes;
      const betterStops = a.features.stops <= b.features.stops;
      const betterBaggage = a.breakdown.baggageScore >= b.breakdown.baggageScore;
      const betterFlex = a.breakdown.flexibilityScore >= b.breakdown.flexibilityScore;

      if (cheaper && betterDuration && betterStops && betterBaggage && betterFlex) {
        // A dominates B — but only adjust if B somehow scored higher
        if (b.rawFinalScore >= a.rawFinalScore) {
          results[j].scoreAdjustment -= 2;
          results[j].rules.push({
            ruleId: 'dominance',
            impact: -2,
            reason: `Dominated by offer ${a.offerId}: cheaper and equal or better in duration, stops, baggage, and flexibility.`,
          });
        }
      }
    }
  }

  return results;
}

// ── Rule B: Small Premium Big Value ──────────────────────────────────────────

function applySmallPremiumBigValueRule(
  offers: ScoredOffer[],
  cheapestPrice: number,
  journeyType: JourneyType,
): RuleResult[] {
  const results: RuleResult[] = offers.map(o => ({ offerId: o.offerId, rules: [], scoreAdjustment: 0 }));
  if (cheapestPrice <= 0) return results;

  const cheapestOffer = offers.find(o => o.features.totalPrice === cheapestPrice);
  if (!cheapestOffer) return results;

  for (let i = 0; i < offers.length; i++) {
    const offer = offers[i];
    const premiumPercent = ((offer.features.totalPrice - cheapestPrice) / cheapestPrice) * 100;

    // Only applies to offers within 5–10% premium
    if (premiumPercent < 1 || premiumPercent > 10) continue;

    let bonus = 0;
    const reasons: string[] = [];

    // Nonstop instead of one stop
    if (offer.features.stops === 0 && cheapestOffer.features.stops >= 1) {
      bonus += 3;
      reasons.push('nonstop instead of one stop');
    }

    // Significant time savings
    const timeSaved = cheapestOffer.features.durationMinutes - offer.features.durationMinutes;
    if (journeyType === 'domestic' && timeSaved >= 90) {
      bonus += 2;
      reasons.push(`saves ${Math.round(timeSaved / 60)} hours`);
    } else if (journeyType === 'international' && timeSaved >= 180) {
      bonus += 3;
      reasons.push(`saves ${Math.round(timeSaved / 60)} hours`);
    }

    // Includes checked bag when cheapest doesn't
    if (offer.features.checkedBags > 0 && cheapestOffer.features.checkedBags === 0) {
      bonus += 2;
      reasons.push('includes checked bag');
    }

    // Better schedule
    if (offer.breakdown.scheduleScore - cheapestOffer.breakdown.scheduleScore > 20) {
      bonus += 1;
      reasons.push('better schedule');
    }

    // Better flexibility
    if (offer.breakdown.flexibilityScore - cheapestOffer.breakdown.flexibilityScore > 20) {
      bonus += 1;
      reasons.push('better flexibility');
    }

    // Cap bonus at 6
    bonus = Math.min(6, bonus);

    if (bonus > 0) {
      results[i].scoreAdjustment += bonus;
      results[i].rules.push({
        ruleId: 'small_premium_big_value',
        impact: bonus,
        reason: `Only ${premiumPercent.toFixed(0)}% more than cheapest but ${reasons.join(', ')}.`,
      });
    }
  }

  return results;
}

// ── Rule C: Expensive Feature Penalty ────────────────────────────────────────

function applyExpensiveFeaturePenalty(
  offers: ScoredOffer[],
  cheapestPrice: number,
): RuleResult[] {
  const results: RuleResult[] = offers.map(o => ({ offerId: o.offerId, rules: [], scoreAdjustment: 0 }));
  if (cheapestPrice <= 0) return results;

  const cheapestOffer = offers.find(o => o.features.totalPrice === cheapestPrice);
  if (!cheapestOffer) return results;

  for (let i = 0; i < offers.length; i++) {
    const offer = offers[i];
    const premiumPercent = ((offer.features.totalPrice - cheapestPrice) / cheapestPrice) * 100;

    if (premiumPercent <= 50) continue;

    // Count meaningful improvements over cheapest
    let improvements = 0;
    if (offer.breakdown.durationScore - cheapestOffer.breakdown.durationScore > 15) improvements++;
    if (offer.breakdown.stopsScore - cheapestOffer.breakdown.stopsScore > 15) improvements++;
    if (offer.breakdown.baggageScore - cheapestOffer.breakdown.baggageScore > 15) improvements++;
    if (offer.breakdown.comfortScore - cheapestOffer.breakdown.comfortScore > 15) improvements++;
    if (offer.breakdown.flexibilityScore - cheapestOffer.breakdown.flexibilityScore > 15) improvements++;
    if (offer.breakdown.scheduleScore - cheapestOffer.breakdown.scheduleScore > 15) improvements++;

    // Only penalize if 0 or 1 minor improvement for high premium
    if (improvements <= 1) {
      const penalty = premiumPercent > 100 ? -8 : premiumPercent > 75 ? -6 : -3;
      results[i].scoreAdjustment += penalty;
      results[i].rules.push({
        ruleId: 'expensive_feature_penalty',
        impact: penalty,
        reason: `${premiumPercent.toFixed(0)}% more expensive with only ${improvements} meaningful improvement${improvements !== 1 ? 's' : ''}.`,
      });
    }
  }

  return results;
}

// ── Rule D: Risky Connection ─────────────────────────────────────────────────

function applyRiskyConnectionPenalty(
  offers: ScoredOffer[],
  journeyType: JourneyType,
  thresholds: LayoverThresholds,
): RuleResult[] {
  const results: RuleResult[] = offers.map(o => ({ offerId: o.offerId, rules: [], scoreAdjustment: 0 }));

  for (let i = 0; i < offers.length; i++) {
    const offer = offers[i];
    if (offer.features.layoverDurations.length === 0) continue;

    const shortestLayover = Math.min(...offer.features.layoverDurations);

    if (shortestLayover < thresholds.highRiskMinutes) {
      let penalty = -5;

      // International with immigration/recheck is worse
      if (journeyType === 'international') {
        if (shortestLayover < 60) penalty = -8;
        if (offer.features.hasTerminalChange || offer.features.hasAirportChange) {
          penalty = -12;
        }
      }

      results[i].scoreAdjustment += penalty;
      results[i].rules.push({
        ruleId: 'risky_connection',
        impact: penalty,
        reason: `Shortest layover is ${shortestLayover} minutes, below safe threshold of ${thresholds.highRiskMinutes} minutes.`,
      });
    }
  }

  return results;
}

// ── Rule E: Long-Haul Comfort ────────────────────────────────────────────────

function applyLongHaulComfortRule(
  offers: ScoredOffer[],
  journeyType: JourneyType,
): RuleResult[] {
  const results: RuleResult[] = offers.map(o => ({ offerId: o.offerId, rules: [], scoreAdjustment: 0 }));

  if (journeyType !== 'international') return results;

  for (let i = 0; i < offers.length; i++) {
    const offer = offers[i];
    if (offer.features.longestSegmentMinutes <= 480) continue; // <8 hours

    // Basic economy on long-haul: penalty
    const fareNameLower = offer.features.fareClassName.toLowerCase();
    const isBasic = fareNameLower.includes('basic') || fareNameLower.includes('light') || fareNameLower.includes('saver');

    if (isBasic && offer.features.cabinClass === 'economy') {
      results[i].scoreAdjustment -= 4;
      results[i].rules.push({
        ruleId: 'long_haul_comfort',
        impact: -4,
        reason: 'Basic economy on a long-haul segment (>8 hours) reduces comfort significantly.',
      });
    }

    // Premium cabin on long-haul: boost
    if (offer.features.cabinClass === 'business' || offer.features.cabinClass === 'first') {
      results[i].scoreAdjustment += 3;
      results[i].rules.push({
        ruleId: 'long_haul_comfort',
        impact: 3,
        reason: 'Premium cabin provides significant comfort advantage on long-haul segment.',
      });
    }

    // Meals on long-haul: boost
    if (offer.features.mealsIncluded && offer.features.cabinClass === 'economy') {
      results[i].scoreAdjustment += 1;
      results[i].rules.push({
        ruleId: 'long_haul_comfort',
        impact: 1,
        reason: 'Meal service included on long-haul economy segment.',
      });
    }
  }

  return results;
}

// ── Rule F: Family Traveler ──────────────────────────────────────────────────

function applyFamilyTravelerRule(
  offers: ScoredOffer[],
  passengers: PassengerCount,
): RuleResult[] {
  const results: RuleResult[] = offers.map(o => ({ offerId: o.offerId, rules: [], scoreAdjustment: 0 }));

  const hasChildren = passengers.children > 0 || passengers.infants > 0;
  if (!hasChildren) return results;

  for (let i = 0; i < offers.length; i++) {
    const offer = offers[i];
    let adjustment = 0;
    const reasons: string[] = [];

    // Boost checked baggage (families need bags)
    if (offer.features.checkedBags >= 1) {
      adjustment += 2;
      reasons.push('checked baggage included for family');
    }

    // Boost family seating
    if (offer.features.familySeatingAvailable) {
      adjustment += 2;
      reasons.push('family seating available');
    }

    // Penalize risky connections
    if (offer.features.layoverDurations.length > 0) {
      const shortest = Math.min(...offer.features.layoverDurations);
      if (shortest < 60) {
        adjustment -= 3;
        reasons.push('risky short connection with children');
      }
    }

    // Boost good schedule (avoid very early/very late with kids)
    if (offer.breakdown.scheduleScore >= 80) {
      adjustment += 1;
      reasons.push('convenient schedule for family');
    }

    if (adjustment !== 0 && reasons.length > 0) {
      results[i].scoreAdjustment += adjustment;
      results[i].rules.push({
        ruleId: 'family_traveler',
        impact: adjustment,
        reason: `Family adjustment: ${reasons.join(', ')}.`,
      });
    }
  }

  return results;
}

// ── Rule G: Business Traveler ────────────────────────────────────────────────

function applyBusinessTravelerRule(offers: ScoredOffer[]): RuleResult[] {
  const results: RuleResult[] = offers.map(o => ({ offerId: o.offerId, rules: [], scoreAdjustment: 0 }));

  for (let i = 0; i < offers.length; i++) {
    const offer = offers[i];
    let adjustment = 0;
    const reasons: string[] = [];

    // Boost good schedule
    if (offer.breakdown.scheduleScore >= 85) {
      adjustment += 2;
      reasons.push('excellent schedule for business');
    }

    // Boost flexibility
    if (offer.breakdown.flexibilityScore >= 70) {
      adjustment += 2;
      reasons.push('good flexibility for business');
    }

    // Boost short duration
    if (offer.breakdown.durationScore >= 85) {
      adjustment += 1;
      reasons.push('short travel time');
    }

    // Boost reliability
    if (offer.breakdown.reliabilityScore >= 80) {
      adjustment += 1;
      reasons.push('high reliability');
    }

    if (adjustment > 0) {
      // Cap at 5
      adjustment = Math.min(5, adjustment);
      results[i].scoreAdjustment += adjustment;
      results[i].rules.push({
        ruleId: 'business_traveler',
        impact: adjustment,
        reason: `Business traveler boost: ${reasons.join(', ')}.`,
      });
    }
  }

  return results;
}

// ── Rule H: Budget Traveler ──────────────────────────────────────────────────

function applyBudgetTravelerRule(
  offers: ScoredOffer[],
  cheapestPrice: number,
): RuleResult[] {
  const results: RuleResult[] = offers.map(o => ({ offerId: o.offerId, rules: [], scoreAdjustment: 0 }));
  if (cheapestPrice <= 0) return results;

  for (let i = 0; i < offers.length; i++) {
    const offer = offers[i];
    const premiumPercent = ((offer.features.totalPrice - cheapestPrice) / cheapestPrice) * 100;

    // Boost cheapest/near-cheapest offers
    if (premiumPercent <= 3) {
      results[i].scoreAdjustment += 3;
      results[i].rules.push({
        ruleId: 'budget_traveler',
        impact: 3,
        reason: 'Near-cheapest option — ideal for budget-conscious traveler.',
      });
    }
    // Penalize expensive offers more aggressively
    else if (premiumPercent > 40) {
      const penalty = Math.min(5, Math.round(premiumPercent / 20));
      results[i].scoreAdjustment -= penalty;
      results[i].rules.push({
        ruleId: 'budget_traveler',
        impact: -penalty,
        reason: `${premiumPercent.toFixed(0)}% above cheapest — penalized for budget traveler.`,
      });
    }
  }

  return results;
}

// ── Public API: Apply All Context Rules ──────────────────────────────────────

/**
 * Apply all enabled context rules to scored offers.
 *
 * @returns Per-offer score adjustments and applied rules
 */
export function applyContextRules(input: ContextRuleInput): RuleResult[] {
  const { offers, journeyType, travelerProfile, passengers, enabledRules, layoverThresholds, cheapestPrice } = input;

  // Initialize results
  const mergedResults: RuleResult[] = offers.map(o => ({ offerId: o.offerId, rules: [], scoreAdjustment: 0 }));

  // Collect all rule results
  const allRuleResults: RuleResult[][] = [];

  if (enabledRules.includes('dominance')) {
    allRuleResults.push(applyDominanceRule(offers));
  }
  if (enabledRules.includes('small_premium_big_value')) {
    allRuleResults.push(applySmallPremiumBigValueRule(offers, cheapestPrice, journeyType));
  }
  if (enabledRules.includes('expensive_feature_penalty')) {
    allRuleResults.push(applyExpensiveFeaturePenalty(offers, cheapestPrice));
  }
  if (enabledRules.includes('risky_connection')) {
    allRuleResults.push(applyRiskyConnectionPenalty(offers, journeyType, layoverThresholds));
  }
  if (enabledRules.includes('long_haul_comfort') && journeyType === 'international') {
    allRuleResults.push(applyLongHaulComfortRule(offers, journeyType));
  }
  if (enabledRules.includes('family_traveler') && (passengers.children > 0 || passengers.infants > 0)) {
    allRuleResults.push(applyFamilyTravelerRule(offers, passengers));
  }
  if (enabledRules.includes('business_traveler') && travelerProfile === 'business') {
    allRuleResults.push(applyBusinessTravelerRule(offers));
  }
  if (enabledRules.includes('budget_traveler') && travelerProfile === 'budget') {
    allRuleResults.push(applyBudgetTravelerRule(offers, cheapestPrice));
  }

  // Merge all results
  for (const ruleResults of allRuleResults) {
    for (let i = 0; i < ruleResults.length; i++) {
      mergedResults[i].scoreAdjustment += ruleResults[i].scoreAdjustment;
      mergedResults[i].rules.push(...ruleResults[i].rules);
    }
  }

  return mergedResults;
}
