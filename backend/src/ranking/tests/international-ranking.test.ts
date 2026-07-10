/**
 * International Ranking Tests
 *
 * Tests:
 *   6. International flight with safer connection beats risky short connection
 *   7. International flight with included checked bag ranks better when prices close
 *   8. Basic economy long-haul is penalized
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rankFlightOffers } from '../core/rankOffers';
import type { RankingInput, RankingOffer, SearchContext } from '../types';

// ── Test Helpers ─────────────────────────────────────────────────────────────

function makeIntlContext(overrides: Partial<SearchContext> = {}): SearchContext {
  return {
    origin: 'DFW',
    destination: 'DEL',
    departureDate: '2026-09-10',
    tripType: 'one_way',
    journeyType: 'international',
    cabin: 'economy',
    currency: 'USD',
    passengers: { adults: 1, children: 0, infants: 0 },
    travelerProfile: 'default',
    ...overrides,
  };
}

function makeIntlOffer(overrides: Partial<RankingOffer>): RankingOffer {
  return {
    offerId: `offer_${Math.random().toString(36).slice(2, 8)}`,
    provider: 'Duffel',
    airline: 'Qatar Airways',
    airlineCode: 'QR',
    totalPrice: 1200,
    currency: 'USD',
    durationMinutes: 960,
    segments: [
      {
        departureAirport: 'DFW', arrivalAirport: 'DOH',
        departureTime: '2026-09-10T22:00:00Z', arrivalTime: '2026-09-11T16:00:00Z',
        durationMinutes: 780, airline: 'QR', flightNumber: 'QR730',
      },
      {
        departureAirport: 'DOH', arrivalAirport: 'DEL',
        departureTime: '2026-09-11T18:30:00Z', arrivalTime: '2026-09-12T00:30:00Z',
        durationMinutes: 240, airline: 'QR', flightNumber: 'QR572',
      },
    ],
    baggage: { carryOn: 1, checked: 1 },
    fareRules: { refundable: false, changeable: true, changeFee: 100 },
    comfort: { cabinClass: 'economy' },
    ancillaries: {},
    stops: 1,
    ...overrides,
  };
}

// ── Test 6: Safer connection beats risky short connection ────────────────────

describe('International Ranking', () => {
  it('Test 6: Safer connection beats risky short connection', () => {
    const input: RankingInput = {
      searchContext: makeIntlContext(),
      offers: [
        makeIntlOffer({
          offerId: 'risky_connection',
          totalPrice: 1150,
          durationMinutes: 900,
          segments: [
            {
              departureAirport: 'DFW', arrivalAirport: 'DOH',
              departureTime: '2026-09-10T22:00:00Z', arrivalTime: '2026-09-11T16:00:00Z',
              durationMinutes: 780, airline: 'QR', flightNumber: 'QR730',
            },
            {
              departureAirport: 'DOH', arrivalAirport: 'DEL',
              departureTime: '2026-09-11T16:45:00Z', arrivalTime: '2026-09-11T22:45:00Z',
              durationMinutes: 240, airline: 'QR', flightNumber: 'QR572',
            },
          ],
          // 45-minute layover — below 60-min international threshold
        }),
        makeIntlOffer({
          offerId: 'safe_connection',
          totalPrice: 1200,
          durationMinutes: 1020,
          segments: [
            {
              departureAirport: 'DFW', arrivalAirport: 'DOH',
              departureTime: '2026-09-10T22:00:00Z', arrivalTime: '2026-09-11T16:00:00Z',
              durationMinutes: 780, airline: 'QR', flightNumber: 'QR730',
            },
            {
              departureAirport: 'DOH', arrivalAirport: 'DEL',
              departureTime: '2026-09-11T19:00:00Z', arrivalTime: '2026-09-12T01:00:00Z',
              durationMinutes: 240, airline: 'QR', flightNumber: 'QR574',
            },
          ],
          // 180-minute layover — safe and comfortable
        }),
      ],
    };

    const result = rankFlightOffers(input);
    assert.equal(result.rankedOffers[0].offerId, 'safe_connection',
      'Safer connection should rank #1 despite being slightly more expensive');
    assert.equal(result.profileId, 'international_default_v1');
  });

  // ── Test 7: Included checked bag ranks better when prices close ────────────

  it('Test 7: Included checked bag ranks better when prices are close', () => {
    const input: RankingInput = {
      searchContext: makeIntlContext(),
      offers: [
        makeIntlOffer({
          offerId: 'no_bag',
          totalPrice: 1100,
          baggage: { carryOn: 1, checked: 0 },
        }),
        makeIntlOffer({
          offerId: 'with_bag',
          totalPrice: 1125, // Only $25 more (~2.3% premium)
          baggage: { carryOn: 1, checked: 1 },
        }),
      ],
    };

    const result = rankFlightOffers(input);
    // The offer with checked bag should score better on baggage dimension
    const noBag = result.rankedOffers.find(o => o.offerId === 'no_bag')!;
    const withBag = result.rankedOffers.find(o => o.offerId === 'with_bag')!;
    assert.ok(withBag.scoreBreakdown.baggageScore > noBag.scoreBreakdown.baggageScore,
      'Offer with checked bag should have higher baggage score');
    // With only ~2.3% price difference, the bag advantage should compensate
    assert.equal(result.rankedOffers[0].offerId, 'with_bag',
      'Offer with checked bag should rank #1 when price difference is small');
  });

  // ── Test 8: Basic economy long-haul is penalized ───────────────────────────

  it('Test 8: Basic economy long-haul is penalized', () => {
    const input: RankingInput = {
      searchContext: makeIntlContext(),
      offers: [
        makeIntlOffer({
          offerId: 'basic_economy',
          totalPrice: 1000,
          comfort: { cabinClass: 'economy', fareClassName: 'Basic Economy' },
          // Has long-haul segment (780 min = 13 hours)
        }),
        makeIntlOffer({
          offerId: 'standard_economy',
          totalPrice: 1050, // Only $50 more
          comfort: { cabinClass: 'economy', fareClassName: 'Economy Classic' },
        }),
      ],
    };

    const result = rankFlightOffers(input);
    const basic = result.rankedOffers.find(o => o.offerId === 'basic_economy')!;
    const standard = result.rankedOffers.find(o => o.offerId === 'standard_economy')!;

    assert.ok(standard.scoreBreakdown.comfortScore > basic.scoreBreakdown.comfortScore,
      'Standard economy should score higher on comfort than basic economy');

    // Check that long-haul comfort rule was applied to basic economy
    const basicRules = basic.appliedRules.filter(r => r.ruleId === 'long_haul_comfort');
    assert.ok(basicRules.length > 0 || basic.scoreBreakdown.comfortScore < 50,
      'Basic economy should be penalized on long-haul');
  });

  // ── Profile validation ─────────────────────────────────────────────────────

  it('Uses international profile for DFW→DEL route', () => {
    const input: RankingInput = {
      searchContext: makeIntlContext(),
      offers: [makeIntlOffer({ offerId: 'test' })],
    };

    const result = rankFlightOffers(input);
    assert.equal(result.profileId, 'international_default_v1');
    assert.equal(result.audit.journeyType, 'international');
  });

  it('International weights differ from domestic', () => {
    const input: RankingInput = {
      searchContext: makeIntlContext(),
      offers: [makeIntlOffer({ offerId: 'test' })],
    };

    const result = rankFlightOffers(input);
    // International should have higher duration and stops weights
    assert.ok(result.audit.weightsUsed.duration > 15, 'Intl duration weight should be > 15');
    assert.ok(result.audit.weightsUsed.stops > 10, 'Intl stops weight should be > 10');
  });
});
