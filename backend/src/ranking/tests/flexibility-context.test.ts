/**
 * Flexibility Context Tests
 *
 * Tests:
 *   4. Changeable fare wins when refundable fare is too expensive
 *   5. Refundable fare wins when premium is small
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rankFlightOffers } from '../core/rankOffers';
import { scoreFlexibility, classifyFlexibility, applyChangeableVsRefundableRule } from '../core/scoreFlexibility';
import type { RankingInput, RankingOffer, SearchContext } from '../types';

// ── Test Helpers ─────────────────────────────────────────────────────────────

function makeDomesticContext(): SearchContext {
  return {
    origin: 'DFW',
    destination: 'LAX',
    departureDate: '2026-09-10',
    tripType: 'one_way',
    journeyType: 'domestic',
    cabin: 'economy',
    currency: 'USD',
    passengers: { adults: 1, children: 0, infants: 0 },
    travelerProfile: 'default',
  };
}

function makeOffer(overrides: Partial<RankingOffer>): RankingOffer {
  return {
    offerId: `offer_${Math.random().toString(36).slice(2, 8)}`,
    provider: 'Duffel',
    airline: 'American Airlines',
    airlineCode: 'AA',
    totalPrice: 300,
    currency: 'USD',
    durationMinutes: 240,
    segments: [
      {
        departureAirport: 'DFW', arrivalAirport: 'LAX',
        departureTime: '2026-09-10T09:00:00Z', arrivalTime: '2026-09-10T11:00:00Z',
        durationMinutes: 240, airline: 'AA', flightNumber: 'AA100',
      },
    ],
    baggage: { carryOn: 1, checked: 0 },
    fareRules: { refundable: false, changeable: false },
    comfort: { cabinClass: 'economy' },
    ancillaries: {},
    stops: 0,
    ...overrides,
  };
}

describe('Flexibility Context Scoring', () => {

  // ── Test 4: Changeable wins when refundable is too expensive ───────────────

  it('Test 4: Changeable fare wins when refundable fare is too expensive', () => {
    // Cheapest: $300 non-refundable
    // Changeable: $330 (10% premium)
    // Refundable: $520 (73% premium)
    const input: RankingInput = {
      searchContext: makeDomesticContext(),
      offers: [
        makeOffer({
          offerId: 'nonrefundable',
          totalPrice: 300,
          fareRules: { refundable: false, changeable: false },
        }),
        makeOffer({
          offerId: 'changeable',
          totalPrice: 330,
          fareRules: { refundable: false, changeable: true, changeFee: 50 },
        }),
        makeOffer({
          offerId: 'refundable_expensive',
          totalPrice: 520,
          fareRules: { refundable: true, changeable: true, cancellationFee: 0 },
        }),
      ],
    };

    const result = rankFlightOffers(input);
    const changeable = result.rankedOffers.find(o => o.offerId === 'changeable')!;
    const refundable = result.rankedOffers.find(o => o.offerId === 'refundable_expensive')!;

    // Changeable should rank higher than expensive refundable
    assert.ok(changeable.finalScore > refundable.finalScore,
      'Changeable should score higher than expensive refundable');

    // Changeable should have better flexibility score than you'd expect
    // because value is good (10% premium for flexibility benefit)
    assert.ok(changeable.scoreBreakdown.flexibilityScore > 30,
      'Changeable should have reasonable flexibility score');
  });

  // ── Test 5: Refundable wins when premium is small ──────────────────────────

  it('Test 5: Refundable fare wins when premium is small', () => {
    // Changeable: $330
    // Refundable: $350 (only ~6% more than changeable, ~17% over cheapest)
    const input: RankingInput = {
      searchContext: makeDomesticContext(),
      offers: [
        makeOffer({
          offerId: 'nonrefundable',
          totalPrice: 300,
          fareRules: { refundable: false, changeable: false },
        }),
        makeOffer({
          offerId: 'changeable',
          totalPrice: 330,
          fareRules: { refundable: false, changeable: true, changeFee: 50 },
        }),
        makeOffer({
          offerId: 'refundable_cheap',
          totalPrice: 350,
          fareRules: { refundable: true, changeable: true, cancellationFee: 0 },
        }),
      ],
    };

    const result = rankFlightOffers(input);
    const refundable = result.rankedOffers.find(o => o.offerId === 'refundable_cheap')!;

    // Refundable should have a strong flexibility score because:
    // - Benefit score is 100 (fully refundable)
    // - Premium is only 17% → value score ~90
    assert.ok(refundable.scoreBreakdown.flexibilityScore > 70,
      'Refundable with small premium should have high flexibility score');
  });

  // ── Unit tests for flexibility scorer ──────────────────────────────────────

  it('Flexibility classification is correct', () => {
    assert.equal(classifyFlexibility(false, false, undefined, undefined), 'nonChangeableNonRefundable');
    assert.equal(classifyFlexibility(false, true, undefined, 50), 'changeableWithFee');
    assert.equal(classifyFlexibility(false, true, undefined, 0), 'changeableNoFee');
    assert.equal(classifyFlexibility(true, false, 50, undefined), 'refundableWithFee');
    assert.equal(classifyFlexibility(true, false, 0, undefined), 'fullyRefundable');
    assert.equal(classifyFlexibility(true, true, undefined, undefined), 'fullyRefundable');
  });

  it('Context-aware flexibility scores are within bounds', () => {
    const domesticThresholds = [
      { maxPremiumPercent: 10,  valueScore: 100 },
      { maxPremiumPercent: 20,  valueScore: 90  },
      { maxPremiumPercent: 35,  valueScore: 75  },
      { maxPremiumPercent: 50,  valueScore: 55  },
      { maxPremiumPercent: 75,  valueScore: 35  },
      { maxPremiumPercent: 999, valueScore: 10  },
    ];

    // Non-refundable at cheapest price
    const score1 = scoreFlexibility(false, false, undefined, undefined, 300, 300, domesticThresholds);
    assert.ok(score1 >= 0 && score1 <= 100, `Score ${score1} should be 0-100`);

    // Fully refundable at 5% premium
    const score2 = scoreFlexibility(true, true, 0, 0, 315, 300, domesticThresholds);
    assert.ok(score2 > score1, 'Refundable at small premium should score higher than non-refundable');

    // Fully refundable at 80% premium
    const score3 = scoreFlexibility(true, true, 0, 0, 540, 300, domesticThresholds);
    assert.ok(score3 < score2, 'Refundable at high premium should score lower');
  });

  it('Changeable vs refundable rule adjusts scores correctly', () => {
    const result = applyChangeableVsRefundableRule(
      60, // changeableScore
      70, // refundableScore
      330, // changeablePrice
      520, // refundablePrice (high premium)
      300, // cheapestPrice
    );

    // Changeable should be boosted (30%+ gap, changeable premium ≤20%)
    assert.ok(result.adjustedChangeableScore > 60, 'Changeable should be boosted');
    // Refundable should be penalized
    assert.ok(result.adjustedRefundableScore < 70, 'Expensive refundable should be penalized');
  });

  it('Refundable gets boost when only slightly more than changeable', () => {
    const result = applyChangeableVsRefundableRule(
      60, // changeableScore
      70, // refundableScore
      330, // changeablePrice
      350, // refundablePrice (only 6% gap from changeable)
      300, // cheapestPrice
    );

    // Refundable should get a boost (premiumDiff ~6.7%)
    assert.ok(result.adjustedRefundableScore > 70, 'Refundable should be boosted when slightly more than changeable');
  });
});
