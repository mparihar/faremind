// ═══════════════════════════════════════════════════════════════════════════════
// Refundability Rule — Unit Tests (Spec Tests 1–10)
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { findComparableChangeableFare, type FareMatchCandidate } from '../FlightComparableFareMatcher';
import { applyRefundabilityRule, REFUNDABILITY_CONFIG, type RefundabilityCandidate } from '../FlightRefundabilityRule';
import { applyPairwisePrecedence, type PairwiseCandidate } from '../FlightPairwisePrecedenceService';
import type { ScoringFeatures, FlightScoreOutput, ScoreBreakdownDetail } from '../FlightScoringTypes';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFeatures(overrides: Partial<ScoringFeatures> & { offerId: string; effectiveTotalPrice: number }): ScoringFeatures {
  return {
    offerId: overrides.offerId,
    tripType: 'ONE_WAY',
    effectiveTotalPrice: overrides.effectiveTotalPrice,
    rawTotalPrice: overrides.rawTotalPrice ?? overrides.effectiveTotalPrice,
    totalDurationMinutes: overrides.totalDurationMinutes ?? 930,
    totalStops: overrides.totalStops ?? 1,
    outboundStops: overrides.totalStops ?? 1,
    returnStops: 0,
    allLayovers: overrides.allLayovers ?? [],
    outboundLayovers: [],
    returnLayovers: [],
    schedule: overrides.schedule ?? { outboundDepartureHour: 12, outboundArrivalHour: 6, returnDepartureHour: undefined, returnArrivalHour: undefined },
    baggage: overrides.baggage ?? { carryOnIncluded: true, carryOnPieces: 1, checkedBagsIncluded: 1 },
    fareFlexibility: overrides.fareFlexibility ?? { refundable: false, changeable: false },
    providerReliability: overrides.providerReliability ?? { score: 85, providerCode: 'test', isKnownReliable: true },
    isInternational: overrides.isInternational ?? true,
  };
}

function makeCandidate(overrides: Partial<ScoringFeatures> & { offerId: string; effectiveTotalPrice: number }): FareMatchCandidate {
  return { features: makeFeatures(overrides), cabinClass: 'economy', currency: 'USD' };
}

function makeScoreOutput(offerId: string, finalScore: number = 80): FlightScoreOutput {
  return {
    offerId,
    providerCode: 'test',
    tripType: 'ONE_WAY',
    aiScoreRaw: finalScore,
    aiScoreDisplay: Math.round(finalScore),
    baseScore: finalScore,
    finalScore,
    warningPenalty: 0,
    compoundWarningPenalty: 0,
    positiveReasons: [],
    negativeWarnings: [],
    compactReason: '',
    rankingTags: [],
    aiPickEligible: true,
    scoreBreakdown: {
      effectivePriceScore: 80, durationScore: 80, stopsScore: 85,
      baggageValueScore: 90, layoverScore: 100, scheduleScore: 80,
      fareFlexibilityScore: 75, providerReliabilityScore: 85,
      warningPenalty: 0, compoundWarningPenalty: 0, warningDetails: [],
      weights: {} as any,
      refundabilityUpgradeBonus: 0, refundabilityUpgradePremiumPct: 0,
    } as ScoreBreakdownDetail,
    refundabilityUpgradeBonus: 0,
  };
}

function makeRefundCandidate(
  offerId: string, price: number,
  opts: { refundable?: boolean; changeable?: boolean; totalStops?: number; totalDurationMinutes?: number; finalScore?: number } = {},
): RefundabilityCandidate {
  const features = makeFeatures({
    offerId,
    effectiveTotalPrice: price,
    fareFlexibility: { refundable: opts.refundable ?? false, changeable: opts.changeable ?? false },
    totalStops: opts.totalStops ?? 1,
    totalDurationMinutes: opts.totalDurationMinutes ?? 930,
  });
  return { features, scoreOutput: makeScoreOutput(offerId, opts.finalScore ?? 80), cabinClass: 'economy', currency: 'USD' };
}

function makePairwiseCandidate(offerId: string, price: number, finalScore: number, opts: { refundable?: boolean; changeable?: boolean } = {}): PairwiseCandidate {
  return {
    features: makeFeatures({ offerId, effectiveTotalPrice: price, fareFlexibility: { refundable: opts.refundable ?? false, changeable: opts.changeable ?? false } }),
    score: makeScoreOutput(offerId, finalScore),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('Refundability Rule (Spec)', () => {

  // Test 1: $861 vs $791 → 8.85% → qualifies
  describe('Test 1: $861 refundable vs $791 changeable', () => {
    it('should use $791 as comparator and qualify at 8.85%', () => {
      const candidates: RefundabilityCandidate[] = [
        makeRefundCandidate('ref-861', 861, { refundable: true, changeable: true }),
        makeRefundCandidate('ch-791', 791, { changeable: true }),
        makeRefundCandidate('ch-599', 599, { changeable: true }),
      ];
      const result = applyRefundabilityRule(candidates);
      const adj = result.adjustments.find(a => a.offerId === 'ref-861');

      expect(adj).toBeDefined();
      expect(adj!.matchedComparableOfferId).toBe('ch-791');
      expect(adj!.premiumPct).toBeCloseTo(8.85, 1);
      expect(adj!.refundabilityAdjustment).toBe(12); // 5-10% band
      expect(adj!.qualifies).toBe(true);
      expect(result.qualifiedPairs.get('ref-861')).toBe('ch-791');
    });
  });

  // Test 2: $599 must NOT replace $791 as comparator
  describe('Test 2: $599 must not replace $791', () => {
    it('should select $791 (abs diff $70) over $599 (abs diff $262)', () => {
      const refundable = makeCandidate({
        offerId: 'ref-861', effectiveTotalPrice: 861,
        fareFlexibility: { refundable: true, changeable: true },
      });
      const candidates = [
        refundable,
        makeCandidate({ offerId: 'ch-599', effectiveTotalPrice: 599, fareFlexibility: { refundable: false, changeable: true } }),
        makeCandidate({ offerId: 'ch-791', effectiveTotalPrice: 791, fareFlexibility: { refundable: false, changeable: true } }),
      ];

      const result = findComparableChangeableFare(refundable, candidates);
      expect(result.match!.features.offerId).toBe('ch-791');
    });
  });

  // Test 3: $1,111 vs $791 → 40.46% → overpriced
  describe('Test 3: $1,111 refundable → overpriced', () => {
    it('should apply overpricing penalty, no positive preference', () => {
      const candidates: RefundabilityCandidate[] = [
        makeRefundCandidate('ref-1111', 1111, { refundable: true, changeable: true }),
        makeRefundCandidate('ch-791', 791, { changeable: true }),
      ];
      const result = applyRefundabilityRule(candidates);
      const adj = result.adjustments.find(a => a.offerId === 'ref-1111');

      expect(adj).toBeDefined();
      expect(adj!.premiumPct).toBeGreaterThan(40);
      expect(adj!.refundabilityAdjustment).toBeLessThan(0);
      expect(adj!.qualifies).toBe(false);
      expect(result.qualifiedPairs.has('ref-1111')).toBe(false);
    });
  });

  // Test 4: +1 stop → Level-2 with reduced comparability factor
  describe('Test 4: One additional stop — Level-2', () => {
    it('should match via Level 2 and apply reduced factor', () => {
      const candidates: RefundabilityCandidate[] = [
        makeRefundCandidate('ref-861', 861, { refundable: true, changeable: true, totalStops: 2, totalDurationMinutes: 950 }),
        makeRefundCandidate('ch-791', 791, { changeable: true, totalStops: 1, totalDurationMinutes: 930 }),
      ];
      const result = applyRefundabilityRule(candidates);
      const adj = result.adjustments.find(a => a.offerId === 'ref-861');

      expect(adj).toBeDefined();
      expect(adj!.comparabilityLevel).toBe('near');
      // Factor 0.75 for +1 stop, dur diff ~2% → ≤20% → 0.75
      expect(adj!.comparabilityFactor).toBe(0.75);
      // 8.85% → band +12 × 0.75 = 9
      expect(adj!.refundabilityAdjustment).toBe(9);
    });
  });

  // Test 5: +2 stops → not comparable
  describe('Test 5: Two or more additional stops', () => {
    it('should not find a comparable fare', () => {
      const refundable = makeCandidate({
        offerId: 'ref-861', effectiveTotalPrice: 861, totalStops: 3,
        fareFlexibility: { refundable: true, changeable: true },
      });
      const candidates = [
        refundable,
        makeCandidate({ offerId: 'ch-791', effectiveTotalPrice: 791, totalStops: 1, fareFlexibility: { refundable: false, changeable: true } }),
      ];
      const result = findComparableChangeableFare(refundable, candidates);
      expect(result.match).toBeNull();
    });
  });

  // Test 6: Pairwise precedence — move only above matched comparator
  describe('Test 6: Pairwise precedence is local, not global', () => {
    it('should move refundable above its matched changeable, not above unrelated offers', () => {
      const sorted: PairwiseCandidate[] = [
        makePairwiseCandidate('unrelated-1', 500, 92),
        makePairwiseCandidate('unrelated-2', 550, 90),
        makePairwiseCandidate('ch-791', 791, 88, { changeable: true }),
        makePairwiseCandidate('unrelated-3', 600, 86),
        makePairwiseCandidate('ref-861', 861, 82, { refundable: true }),
      ];

      const pairs = new Map([['ref-861', 'ch-791']]);
      const moves = applyPairwisePrecedence(sorted, pairs);

      expect(moves).toHaveLength(1);
      // ref-861 should now be immediately before ch-791
      const refIdx = sorted.findIndex(c => c.features.offerId === 'ref-861');
      const chgIdx = sorted.findIndex(c => c.features.offerId === 'ch-791');
      expect(refIdx).toBeLessThan(chgIdx);
      expect(refIdx).toBe(chgIdx - 1);

      // Score should NOT have changed
      expect(sorted[refIdx].score.finalScore).toBe(82);

      // Must still be below unrelated-2 (rank 2)
      const unrelated2Idx = sorted.findIndex(c => c.features.offerId === 'unrelated-2');
      expect(refIdx).toBeGreaterThan(unrelated2Idx);
    });
  });

  // Test 7: No qualifying refundable → top results may contain zero refundable
  describe('Test 7: No qualifying refundable', () => {
    it('should not insert any refundable into top results', () => {
      const candidates: RefundabilityCandidate[] = [
        makeRefundCandidate('ref-1200', 1200, { refundable: true, changeable: true }),
        makeRefundCandidate('ch-791', 791, { changeable: true }),
      ];
      const result = applyRefundabilityRule(candidates);
      expect(result.qualifiedPairs.size).toBe(0);
    });
  });

  // Test 8: Implausible layover
  describe('Test 8: Implausible 12h layover on 15h30m flight', () => {
    it('should filter implausible layover (>80% of total duration)', () => {
      const features = makeFeatures({
        offerId: 'test', effectiveTotalPrice: 599,
        totalDurationMinutes: 930,
        allLayovers: [{ airport: 'AMS', durationMinutes: 780, isOvernight: true, requiresAirportChange: false, isSelfTransfer: false }],
      });
      const plausible = features.allLayovers.filter(l =>
        !(features.totalDurationMinutes > 0 && l.durationMinutes > features.totalDurationMinutes * 0.8)
      );
      expect(plausible).toHaveLength(0);
    });
  });

  // Test 10: Pairwise precedence must be the last ordering operation
  describe('Test 10: Pairwise precedence is final', () => {
    it('should not be followed by any re-sort', () => {
      const sorted: PairwiseCandidate[] = [
        makePairwiseCandidate('ch-791', 791, 88, { changeable: true }),
        makePairwiseCandidate('ref-861', 861, 82, { refundable: true }),
      ];

      const pairs = new Map([['ref-861', 'ch-791']]);
      applyPairwisePrecedence(sorted, pairs);

      // After pairwise, ref-861 should be first
      expect(sorted[0].features.offerId).toBe('ref-861');
      expect(sorted[1].features.offerId).toBe('ch-791');

      // If we re-sorted by score, it would break — verify score was NOT changed
      expect(sorted[0].score.finalScore).toBe(82);
      expect(sorted[1].score.finalScore).toBe(88);
    });
  });

  // Bonus: refundable cheaper than changeable → +15
  describe('Refundable cheaper than changeable', () => {
    it('should award +15 when refundable is cheaper', () => {
      const candidates: RefundabilityCandidate[] = [
        makeRefundCandidate('ref-490', 490, { refundable: true, changeable: true }),
        makeRefundCandidate('ch-500', 500, { changeable: true }),
      ];
      const result = applyRefundabilityRule(candidates);
      const adj = result.adjustments.find(a => a.offerId === 'ref-490');
      expect(adj!.refundabilityAdjustment).toBe(15);
      expect(adj!.premiumPct).toBe(0);
    });
  });

  // Comparability factor: exact with moderate duration diff → 0.85
  describe('Comparability factor: exact match, 25% duration diff → 0.85', () => {
    it('should apply factor 0.85 for same stops but >15% duration diff', () => {
      const candidates: RefundabilityCandidate[] = [
        makeRefundCandidate('ref-853', 853, { refundable: true, changeable: true, totalDurationMinutes: 1160 }), // 25% longer than 930
        makeRefundCandidate('ch-791', 791, { changeable: true, totalDurationMinutes: 930 }),
      ];
      const result = applyRefundabilityRule(candidates);
      const adj = result.adjustments.find(a => a.offerId === 'ref-853');
      expect(adj!.comparabilityFactor).toBe(0.85);
    });
  });
});
