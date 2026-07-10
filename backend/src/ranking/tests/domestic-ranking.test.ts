/**
 * Domestic Ranking Tests
 *
 * Tests:
 *   1. Cheapest domestic flight wins when other factors are similar
 *   2. Slightly more expensive domestic flight wins when it saves significant time
 *   3. Refundable domestic fare loses when premium is too high
 *   9. Same input and same config always produce same ranking (determinism)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rankFlightOffers } from '../core/rankOffers';
import type { RankingInput, RankingOffer, SearchContext } from '../types';

// ── Test Helpers ─────────────────────────────────────────────────────────────

function makeDomesticContext(overrides: Partial<SearchContext> = {}): SearchContext {
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
    ...overrides,
  };
}

function makeOffer(overrides: Partial<RankingOffer>): RankingOffer {
  return {
    offerId: `offer_${Math.random().toString(36).slice(2, 8)}`,
    provider: 'Duffel',
    airline: 'American Airlines',
    airlineCode: 'AA',
    totalPrice: 250,
    currency: 'USD',
    durationMinutes: 240,
    segments: [
      {
        departureAirport: 'DFW',
        arrivalAirport: 'LAX',
        departureTime: '2026-09-10T09:00:00Z',
        arrivalTime: '2026-09-10T11:00:00Z',
        durationMinutes: 240,
        airline: 'AA',
        flightNumber: 'AA100',
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

// ── Test 1: Cheapest wins when other factors are similar ─────────────────────

describe('Domestic Ranking', () => {
  it('Test 1: Cheapest domestic flight wins when other factors are similar', () => {
    const input: RankingInput = {
      searchContext: makeDomesticContext(),
      offers: [
        makeOffer({ offerId: 'cheap', totalPrice: 200, durationMinutes: 240, stops: 0 }),
        makeOffer({ offerId: 'mid', totalPrice: 280, durationMinutes: 240, stops: 0 }),
        makeOffer({ offerId: 'expensive', totalPrice: 400, durationMinutes: 240, stops: 0 }),
      ],
    };

    const result = rankFlightOffers(input);
    assert.equal(result.rankedOffers.length, 3);
    assert.equal(result.rankedOffers[0].offerId, 'cheap', 'Cheapest should rank #1');
    assert.ok(result.rankedOffers[0].finalScore > result.rankedOffers[1].finalScore, 'Cheapest score > mid score');
    assert.ok(result.rankedOffers[1].finalScore > result.rankedOffers[2].finalScore, 'Mid score > expensive score');
    assert.equal(result.profileId, 'domestic_default_v1');
  });

  // ── Test 2: More expensive wins with significant time savings ──────────────

  it('Test 2: Slightly more expensive domestic flight wins when it saves significant time', () => {
    const input: RankingInput = {
      searchContext: makeDomesticContext(),
      offers: [
        makeOffer({
          offerId: 'cheap_slow',
          totalPrice: 180,
          durationMinutes: 600, // 10 hours (1 stop, long layover)
          stops: 1,
          segments: [
            {
              departureAirport: 'DFW', arrivalAirport: 'DEN',
              departureTime: '2026-09-10T06:00:00Z', arrivalTime: '2026-09-10T08:30:00Z',
              durationMinutes: 150, airline: 'AA', flightNumber: 'AA100',
            },
            {
              departureAirport: 'DEN', arrivalAirport: 'LAX',
              departureTime: '2026-09-10T14:00:00Z', arrivalTime: '2026-09-10T16:00:00Z',
              durationMinutes: 210, airline: 'AA', flightNumber: 'AA200',
            },
          ],
        }),
        makeOffer({
          offerId: 'fast_nonstop',
          totalPrice: 195, // Only ~8% more
          durationMinutes: 210, // 3.5 hours, saves 6.5 hours
          stops: 0,
        }),
      ],
    };

    const result = rankFlightOffers(input);
    assert.equal(result.rankedOffers[0].offerId, 'fast_nonstop',
      'Faster nonstop should win despite being ~8% more expensive');
  });

  // ── Test 3: Refundable loses when premium is too high ──────────────────────

  it('Test 3: Refundable domestic fare loses when premium is too high', () => {
    const input: RankingInput = {
      searchContext: makeDomesticContext(),
      offers: [
        makeOffer({
          offerId: 'nonrefundable',
          totalPrice: 200,
          fareRules: { refundable: false, changeable: false },
        }),
        makeOffer({
          offerId: 'refundable_expensive',
          totalPrice: 400, // 100% premium
          fareRules: { refundable: true, changeable: true, cancellationFee: 0 },
        }),
      ],
    };

    const result = rankFlightOffers(input);
    assert.equal(result.rankedOffers[0].offerId, 'nonrefundable',
      'Non-refundable should win when refundable has 100% premium');
  });

  // ── Test 9: Determinism ────────────────────────────────────────────────────

  it('Test 9: Same input and same config always produce same ranking', () => {
    const input: RankingInput = {
      searchContext: makeDomesticContext(),
      offers: [
        makeOffer({ offerId: 'a', totalPrice: 250, durationMinutes: 240 }),
        makeOffer({ offerId: 'b', totalPrice: 200, durationMinutes: 300 }),
        makeOffer({ offerId: 'c', totalPrice: 350, durationMinutes: 180 }),
      ],
    };

    const result1 = rankFlightOffers(input);
    const result2 = rankFlightOffers(input);
    const result3 = rankFlightOffers(input);

    // Same ranking order
    assert.deepEqual(
      result1.rankedOffers.map(o => o.offerId),
      result2.rankedOffers.map(o => o.offerId),
      'Run 1 and 2 should produce same order'
    );
    assert.deepEqual(
      result2.rankedOffers.map(o => o.offerId),
      result3.rankedOffers.map(o => o.offerId),
      'Run 2 and 3 should produce same order'
    );

    // Same scores
    assert.deepEqual(
      result1.rankedOffers.map(o => o.finalScore),
      result2.rankedOffers.map(o => o.finalScore),
      'Scores should be identical across runs'
    );
  });

  // ── Score breakdown validation ─────────────────────────────────────────────

  it('Every offer has a complete score breakdown', () => {
    const input: RankingInput = {
      searchContext: makeDomesticContext(),
      offers: [
        makeOffer({ offerId: 'test1', totalPrice: 200 }),
        makeOffer({ offerId: 'test2', totalPrice: 300 }),
      ],
    };

    const result = rankFlightOffers(input);
    for (const offer of result.rankedOffers) {
      assert.ok(offer.scoreBreakdown, 'Should have scoreBreakdown');
      assert.ok(typeof offer.scoreBreakdown.priceScore === 'number');
      assert.ok(typeof offer.scoreBreakdown.scheduleScore === 'number');
      assert.ok(typeof offer.scoreBreakdown.durationScore === 'number');
      assert.ok(typeof offer.scoreBreakdown.stopsScore === 'number');
      assert.ok(typeof offer.scoreBreakdown.baggageScore === 'number');
      assert.ok(typeof offer.scoreBreakdown.comfortScore === 'number');
      assert.ok(typeof offer.scoreBreakdown.flexibilityScore === 'number');
      assert.ok(typeof offer.scoreBreakdown.brandScore === 'number');
      assert.ok(typeof offer.scoreBreakdown.reliabilityScore === 'number');
      assert.ok(typeof offer.scoreBreakdown.airportExperienceScore === 'number');

      // All scores should be 0–100
      for (const [key, value] of Object.entries(offer.scoreBreakdown)) {
        assert.ok(value >= 0 && value <= 100, `${key} should be 0–100, got ${value}`);
      }

      // Machine reasons should exist
      assert.ok(Array.isArray(offer.machineReasons), 'Should have machineReasons');
      assert.ok(offer.machineReasons.length > 0, 'Should have at least one reason');

      // Confidence should be valid
      assert.ok(['high', 'medium', 'low'].includes(offer.confidence));
    }
  });

  // ── Audit data validation ──────────────────────────────────────────────────

  it('Output contains complete audit data', () => {
    const input: RankingInput = {
      searchContext: makeDomesticContext(),
      offers: [makeOffer({ offerId: 'audit_test' })],
    };

    const result = rankFlightOffers(input);
    assert.ok(result.audit, 'Should have audit data');
    assert.equal(result.audit.rankingVersion, 'faremind-ranking-v1.0.0');
    assert.equal(result.audit.profileId, 'domestic_default_v1');
    assert.equal(result.audit.configVersion, '1.0.0');
    assert.ok(result.audit.timestamp);
    assert.deepEqual(result.audit.inputOfferIds, ['audit_test']);
    assert.equal(result.audit.totalOffers, 1);
    assert.equal(result.audit.journeyType, 'domestic');
    assert.equal(result.audit.currency, 'USD');
    assert.ok(result.audit.weightsUsed);
  });
});
