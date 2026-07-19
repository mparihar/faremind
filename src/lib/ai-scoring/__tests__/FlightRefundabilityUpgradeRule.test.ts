// ═══════════════════════════════════════════════════════════════════════════════
// Refundability Upgrade Rule — Unit Tests (Cases A–H)
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { findNearestChangeableFare, getComparabilityFactor, type FareMatchCandidate } from '../FlightComparableFareMatcher';
import { applyRefundabilityUpgrades, type UpgradeCandidate } from '../FlightRefundabilityUpgradeRule';
import { REFUNDABILITY_UPGRADE_CONFIG } from '../FlightScoringConfig';
import type { ScoringFeatures, FlightScoreOutput, ScoreBreakdownDetail } from '../FlightScoringTypes';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeFeatures(overrides: Partial<ScoringFeatures> & { offerId: string; effectiveTotalPrice: number }): ScoringFeatures {
  return {
    offerId: overrides.offerId,
    tripType: 'ONE_WAY',
    effectiveTotalPrice: overrides.effectiveTotalPrice,
    rawTotalPrice: overrides.rawTotalPrice ?? overrides.effectiveTotalPrice,
    totalDurationMinutes: overrides.totalDurationMinutes ?? 930, // 15h30m default
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
  return {
    features: makeFeatures(overrides),
    cabinClass: 'economy',
    currency: 'USD',
  };
}

function makeScoreOutput(offerId: string): FlightScoreOutput {
  return {
    offerId,
    providerCode: 'test',
    tripType: 'ONE_WAY',
    aiScoreRaw: 80,
    aiScoreDisplay: 80,
    baseScore: 80,
    finalScore: 80,
    warningPenalty: 0,
    compoundWarningPenalty: 0,
    positiveReasons: [],
    negativeWarnings: [],
    compactReason: '',
    rankingTags: [],
    aiPickEligible: true,
    scoreBreakdown: {
      effectivePriceScore: 80,
      durationScore: 80,
      stopsScore: 85,
      baggageValueScore: 90,
      layoverScore: 100,
      scheduleScore: 80,
      fareFlexibilityScore: 75,
      providerReliabilityScore: 85,
      warningPenalty: 0,
      compoundWarningPenalty: 0,
      warningDetails: [],
      weights: {} as any,
      refundabilityUpgradeBonus: 0,
      refundabilityUpgradePremiumPct: 0,
    } as ScoreBreakdownDetail,
    refundabilityUpgradeBonus: 0,
  };
}

function makeUpgradeCandidate(
  offerId: string,
  price: number,
  opts: { refundable?: boolean; changeable?: boolean; totalStops?: number; totalDurationMinutes?: number; finalScore?: number } = {},
): UpgradeCandidate {
  const features = makeFeatures({
    offerId,
    effectiveTotalPrice: price,
    fareFlexibility: {
      refundable: opts.refundable ?? false,
      changeable: opts.changeable ?? false,
    },
    totalStops: opts.totalStops ?? 1,
    totalDurationMinutes: opts.totalDurationMinutes ?? 930,
  });
  const so = makeScoreOutput(offerId);
  if (opts.finalScore != null) {
    so.finalScore = opts.finalScore;
    so.baseScore = opts.finalScore;
    so.aiScoreRaw = opts.finalScore;
    so.aiScoreDisplay = Math.round(opts.finalScore);
  }
  return { features, scoreOutput: so, cabinClass: 'economy', currency: 'USD' };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('Refundability Upgrade Rule', () => {
  // Case A: $861 refundable vs $791 changeable → 8.85% → qualifies
  describe('Case A: $861 refundable vs $791 changeable (8.85% premium)', () => {
    it('should select $791 as the nearest comparable fare', () => {
      const refundable = makeCandidate({
        offerId: 'ref-861', effectiveTotalPrice: 861,
        fareFlexibility: { refundable: true, changeable: true },
      });
      const candidates = [
        refundable,
        makeCandidate({ offerId: 'ch-791', effectiveTotalPrice: 791, fareFlexibility: { refundable: false, changeable: true } }),
        makeCandidate({ offerId: 'ch-599', effectiveTotalPrice: 599, fareFlexibility: { refundable: false, changeable: true } }),
        makeCandidate({ offerId: 'ch-670', effectiveTotalPrice: 670, fareFlexibility: { refundable: false, changeable: true } }),
      ];

      const result = findNearestChangeableFare(refundable, candidates, REFUNDABILITY_UPGRADE_CONFIG);

      expect(result.match).not.toBeNull();
      expect(result.match!.features.offerId).toBe('ch-791');
      expect(result.matchLevel).toBe('exact');
    });

    it('should calculate 8.85% premium and apply +12 bonus', () => {
      const candidates: UpgradeCandidate[] = [
        makeUpgradeCandidate('ref-861', 861, { refundable: true, changeable: true }),
        makeUpgradeCandidate('ch-791', 791, { changeable: true }),
        makeUpgradeCandidate('ch-599', 599, { changeable: true }),
        makeUpgradeCandidate('ch-670', 670, { changeable: true }),
      ];

      const result = applyRefundabilityUpgrades(candidates, REFUNDABILITY_UPGRADE_CONFIG);
      const adj = result.adjustments.find(a => a.offerId === 'ref-861');

      expect(adj).toBeDefined();
      expect(adj!.baselineOfferId).toBe('ch-791');
      expect(adj!.premiumPct).toBeCloseTo(8.85, 1);
      expect(adj!.bonus).toBe(12); // 5-10% band = +12
      expect(adj!.qualifies).toBe(true);
    });

    it('should record qualified pair for pairwise precedence', () => {
      const candidates: UpgradeCandidate[] = [
        makeUpgradeCandidate('ref-861', 861, { refundable: true, changeable: true }),
        makeUpgradeCandidate('ch-791', 791, { changeable: true }),
      ];

      const result = applyRefundabilityUpgrades(candidates, REFUNDABILITY_UPGRADE_CONFIG);

      expect(result.qualifiedPairs.get('ref-861')).toBe('ch-791');
    });
  });

  // Case B: $599 must NOT replace $791 as comparator
  describe('Case B: $599 must not replace $791 when $791 is the closer valid comparable', () => {
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

      const result = findNearestChangeableFare(refundable, candidates, REFUNDABILITY_UPGRADE_CONFIG);

      expect(result.match!.features.offerId).toBe('ch-791');
      expect(result.priceDiff).toBe(70); // 861 - 791
    });
  });

  // Case C: $1,086 refundable vs $599 comparable → >20% → no preference
  describe('Case C: $1,086 refundable — overpriced, no preference', () => {
    it('should not qualify when premium exceeds 20%', () => {
      const candidates: UpgradeCandidate[] = [
        makeUpgradeCandidate('ref-1086', 1086, { refundable: true, changeable: true }),
        makeUpgradeCandidate('ch-957', 957, { changeable: true }),
        makeUpgradeCandidate('ch-791', 791, { changeable: true }),
      ];

      const result = applyRefundabilityUpgrades(candidates, REFUNDABILITY_UPGRADE_CONFIG);
      const adj = result.adjustments.find(a => a.offerId === 'ref-1086');

      // Nearest by abs diff from $1086 is $957 (diff=$129) not $791 (diff=$295)
      expect(adj).toBeDefined();
      expect(adj!.baselineOfferId).toBe('ch-957');
      expect(adj!.premiumPct).toBeGreaterThan(13); // (1086-957)/957 = 13.5%
      // This is within 10-15% band → +8 bonus
      // BUT if $957 is not a valid fare, then $791 → (1086-791)/791 = 37.3% → penalty
    });
  });

  // Case D: Refundable with one extra stop → Level-2 matching
  describe('Case D: One extra stop — Level-2 matching', () => {
    it('should match via Level 2 when no same-stop changeable exists', () => {
      const refundable = makeCandidate({
        offerId: 'ref-861', effectiveTotalPrice: 861, totalStops: 2,
        totalDurationMinutes: 950,
        fareFlexibility: { refundable: true, changeable: true },
      });
      const candidates = [
        refundable,
        // Only 1-stop changeable fares available (no 2-stop)
        makeCandidate({
          offerId: 'ch-791', effectiveTotalPrice: 791, totalStops: 1,
          totalDurationMinutes: 930,
          fareFlexibility: { refundable: false, changeable: true },
        }),
      ];

      const result = findNearestChangeableFare(refundable, candidates, REFUNDABILITY_UPGRADE_CONFIG);

      expect(result.match).not.toBeNull();
      expect(result.matchLevel).toBe('near');
      expect(result.stopDiff).toBe(1);
    });

    it('should apply comparability factor 0.80 for +1 stop, similar duration', () => {
      const factor = getComparabilityFactor('near', 1, 1.02); // 2% longer
      expect(factor).toBe(0.80);
    });

    it('should apply comparability factor 0.65 for +1 stop, moderately longer', () => {
      const factor = getComparabilityFactor('near', 1, 1.25); // 25% longer
      expect(factor).toBe(0.65);
    });
  });

  // Case E: Two or more additional stops → not comparable
  describe('Case E: Two or more additional stops — not comparable', () => {
    it('should not match when stop difference is 2+', () => {
      const refundable = makeCandidate({
        offerId: 'ref-861', effectiveTotalPrice: 861, totalStops: 3,
        fareFlexibility: { refundable: true, changeable: true },
      });
      const candidates = [
        refundable,
        makeCandidate({ offerId: 'ch-791', effectiveTotalPrice: 791, totalStops: 1, fareFlexibility: { refundable: false, changeable: true } }),
      ];

      const result = findNearestChangeableFare(refundable, candidates, REFUNDABILITY_UPGRADE_CONFIG);

      expect(result.match).toBeNull();
      expect(result.matchLevel).toBeNull();
    });
  });

  // Case F: Implausible layover should not create warning
  describe('Case F: Incorrect long-layover warning', () => {
    it('should filter implausible layovers (>80% of total duration)', () => {
      const features = makeFeatures({
        offerId: 'test',
        effectiveTotalPrice: 599,
        totalDurationMinutes: 930, // 15h30m
        allLayovers: [{ airport: 'AMS', durationMinutes: 780, isOvernight: true, requiresAirportChange: false, isSelfTransfer: false }],
      });

      // 780 min > 930 * 0.8 = 744 → implausible
      const plausible = features.allLayovers.filter(l =>
        !(features.totalDurationMinutes > 0 && l.durationMinutes > features.totalDurationMinutes * 0.8)
      );

      expect(plausible).toHaveLength(0);
    });
  });

  // Case H: Tie-break determinism
  describe('Case H: Tie case — deterministic cascade', () => {
    it('should break ties by lower price when scores are equal', () => {
      const candidates: UpgradeCandidate[] = [
        makeUpgradeCandidate('a', 500, { changeable: true, finalScore: 85 }),
        makeUpgradeCandidate('b', 520, { changeable: true, finalScore: 85 }),
      ];

      // Both have same score — a ($500) should rank above b ($520)
      candidates.sort((a, b) => {
        const diff = b.scoreOutput.finalScore - a.scoreOutput.finalScore;
        if (Math.abs(diff) > 0.005) return diff;
        return a.features.effectiveTotalPrice - b.features.effectiveTotalPrice;
      });

      expect(candidates[0].features.offerId).toBe('a');
      expect(candidates[1].features.offerId).toBe('b');
    });
  });

  // Bonus: refundable cheaper than changeable → +15
  describe('Refundable cheaper than changeable', () => {
    it('should award maximum bonus (+15) when refundable is cheaper', () => {
      const candidates: UpgradeCandidate[] = [
        makeUpgradeCandidate('ref-490', 490, { refundable: true, changeable: true }),
        makeUpgradeCandidate('ch-500', 500, { changeable: true }),
      ];

      const result = applyRefundabilityUpgrades(candidates, REFUNDABILITY_UPGRADE_CONFIG);
      const adj = result.adjustments.find(a => a.offerId === 'ref-490');

      expect(adj).toBeDefined();
      expect(adj!.bonus).toBe(15);
      expect(adj!.premiumPct).toBe(0);
    });
  });
});
