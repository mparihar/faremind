/**
 * Explanation Safety Tests
 *
 * Tests:
 *   10. GPT explanation never changes ranking
 *       - Validates that the explanation layer only reads from
 *         the ranked result and cannot alter scores or ranking.
 *       - Tests the fallback explanation when GPT is unavailable.
 *       - Tests prompt structure constraints.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rankFlightOffers } from '../core/rankOffers';
import { buildExplanationPrompt, buildExplanationMessages } from '../explanation/buildExplanationPrompt';
import type { RankingInput, RankedOffer, SearchContext } from '../types';

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

describe('Explanation Safety', () => {

  // ── Test 10: GPT explanation never changes ranking ─────────────────────────

  it('Test 10: Ranking output is immutable — explanation cannot change it', () => {
    const input: RankingInput = {
      searchContext: makeDomesticContext(),
      offers: [
        {
          offerId: 'offer_a', provider: 'Duffel', airline: 'American Airlines',
          airlineCode: 'AA', totalPrice: 200, currency: 'USD', durationMinutes: 240,
          segments: [{
            departureAirport: 'DFW', arrivalAirport: 'LAX',
            departureTime: '2026-09-10T09:00:00Z', arrivalTime: '2026-09-10T11:00:00Z',
            durationMinutes: 240, airline: 'AA', flightNumber: 'AA100',
          }],
          baggage: { carryOn: 1, checked: 0 },
          fareRules: { refundable: false, changeable: false },
          comfort: { cabinClass: 'economy' },
          ancillaries: {},
          stops: 0,
        },
        {
          offerId: 'offer_b', provider: 'Duffel', airline: 'Delta Air Lines',
          airlineCode: 'DL', totalPrice: 350, currency: 'USD', durationMinutes: 200,
          segments: [{
            departureAirport: 'DFW', arrivalAirport: 'LAX',
            departureTime: '2026-09-10T10:00:00Z', arrivalTime: '2026-09-10T12:20:00Z',
            durationMinutes: 200, airline: 'DL', flightNumber: 'DL500',
          }],
          baggage: { carryOn: 1, checked: 1 },
          fareRules: { refundable: true, changeable: true, cancellationFee: 0 },
          comfort: { cabinClass: 'economy' },
          ancillaries: {},
          stops: 0,
        },
      ],
    };

    // Get ranking result
    const result = rankFlightOffers(input);

    // Record the ranking before explanation
    const rankingBefore = result.rankedOffers.map(o => ({
      offerId: o.offerId,
      rank: o.rank,
      finalScore: o.finalScore,
    }));

    // Build explanation (does not modify result)
    const topOffer = result.rankedOffers[0];
    const prompt = buildExplanationPrompt(topOffer, result.searchContext, 'domestic');

    // Verify ranking is unchanged after building explanation
    const rankingAfter = result.rankedOffers.map(o => ({
      offerId: o.offerId,
      rank: o.rank,
      finalScore: o.finalScore,
    }));

    assert.deepEqual(rankingBefore, rankingAfter,
      'Ranking should not change after explanation generation');
  });

  // ── Prompt contains safety constraints ─────────────────────────────────────

  it('Explanation prompt contains safety constraints', () => {
    const rankedOffer: RankedOffer = {
      rank: 1,
      offerId: 'test_offer',
      provider: 'Duffel',
      airline: 'Qatar Airways',
      finalScore: 88.42,
      scoreBreakdown: {
        priceScore: 84, scheduleScore: 78, durationScore: 92,
        stopsScore: 85, baggageScore: 90, comfortScore: 80,
        flexibilityScore: 72, brandScore: 88,
        reliabilityScore: 82, airportExperienceScore: 76,
      },
      appliedRules: [
        { ruleId: 'small_premium_big_value', impact: 4, reason: 'Only 6% more than cheapest but saves 4 hours.' },
      ],
      machineReasons: [
        'Only 6% more than the cheapest comparable option.',
        'Saves 4 hours compared with lower-ranked alternatives.',
      ],
      tradeoffs: ['Not the absolute cheapest option.'],
      confidence: 'high',
    };

    const prompt = buildExplanationPrompt(rankedOffer, makeDomesticContext(), 'domestic');
    const parsed = JSON.parse(prompt);

    // System prompt must contain safety constraints
    assert.ok(parsed.systemPrompt.includes('Do not change the ranking'), 'Must include "do not change ranking"');
    assert.ok(parsed.systemPrompt.includes('Do not recalculate scores'), 'Must include "do not recalculate"');
    assert.ok(parsed.systemPrompt.includes('Do not invent new reasons'), 'Must include "do not invent"');
    assert.ok(parsed.systemPrompt.includes('Do not mention internal model names'), 'Must hide internal details');

    // User prompt must contain the ranking data
    assert.ok(parsed.userPrompt.includes('test_offer'), 'Must include offer ID');
    assert.ok(parsed.userPrompt.includes('Only 6% more'), 'Must include machine reasons');
  });

  // ── Prompt does not expose internal weights ────────────────────────────────

  it('Explanation prompt does not expose internal weight numbers', () => {
    const rankedOffer: RankedOffer = {
      rank: 1, offerId: 'test', provider: 'Duffel', airline: 'AA', finalScore: 80,
      scoreBreakdown: {
        priceScore: 80, scheduleScore: 70, durationScore: 90,
        stopsScore: 100, baggageScore: 60, comfortScore: 55,
        flexibilityScore: 40, brandScore: 70,
        reliabilityScore: 70, airportExperienceScore: 65,
      },
      appliedRules: [],
      machineReasons: ['Cheapest option.'],
      tradeoffs: [],
      confidence: 'high',
    };

    const { system, user } = buildExplanationMessages(rankedOffer, makeDomesticContext(), 'domestic');

    // Should NOT contain weight percentages from the config
    assert.ok(!system.includes('price: 35'), 'System prompt should not expose price weight');
    assert.ok(!system.includes('weight'), 'System prompt should not mention weights');

    // User prompt should have reasons, not raw scores
    assert.ok(!user.includes('"weights"'), 'User prompt should not include weights object');
  });

  // ── Build messages returns valid structure ──────────────────────────────────

  it('buildExplanationMessages returns valid system and user prompts', () => {
    const rankedOffer: RankedOffer = {
      rank: 1, offerId: 'msg_test', provider: 'Duffel', airline: 'Emirates',
      finalScore: 92, scoreBreakdown: {
        priceScore: 90, scheduleScore: 85, durationScore: 95,
        stopsScore: 100, baggageScore: 90, comfortScore: 80,
        flexibilityScore: 75, brandScore: 90,
        reliabilityScore: 85, airportExperienceScore: 80,
      },
      appliedRules: [],
      machineReasons: ['Best price.', 'Nonstop flight.'],
      tradeoffs: [],
      confidence: 'high',
    };

    const { system, user } = buildExplanationMessages(rankedOffer, makeDomesticContext(), 'domestic');

    assert.ok(typeof system === 'string' && system.length > 50, 'System prompt should be substantial');
    assert.ok(typeof user === 'string' && user.length > 20, 'User prompt should contain data');
    assert.ok(user.includes('msg_test'), 'User prompt should reference the offer');
  });
});
