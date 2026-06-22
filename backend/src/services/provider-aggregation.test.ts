/**
 * Provider Aggregation Tests — APPEND_ALL Mode
 *
 * Tests that all provider offers are retained without dedup or winner selection.
 * Run with: npx tsx backend/src/services/provider-aggregation.test.ts
 */

import {
  buildDuplicateKey,
  normalizeFlightNumber,
  aggregateProviderOffers,
} from './provider-aggregation';
import type { UnifiedFlight } from '../lib/types';

// ═══════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual === expected) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

/**
 * Create a minimal UnifiedFlight for testing.
 */
function makeFlight(overrides: Partial<UnifiedFlight> & {
  provider: UnifiedFlight['provider'];
  price: number;
  flightNumber?: string;
  origin?: string;
  destination?: string;
  departureTime?: string;
  arrivalTime?: string;
  cabin?: string;
  checked?: number;
  carryOn?: number;
  refundable?: boolean;
  changeable?: boolean;
  cancellationFee?: number;
  changeFee?: number;
}): UnifiedFlight {
  const flightNum = overrides.flightNumber || 'AA1087';
  const origin = overrides.origin || 'DFW';
  const dest = overrides.destination || 'LHR';
  const depTime = overrides.departureTime || '2026-07-15T08:30:00';
  const arrTime = overrides.arrivalTime || '2026-07-15T20:30:00';
  const cabin = overrides.cabin || 'economy';

  return {
    id: `test_${Math.random().toString(36).slice(2, 8)}`,
    provider: overrides.provider,
    providerOfferId: overrides.providerOfferId || `offer_${overrides.provider}_${Math.random().toString(36).slice(2, 8)}`,
    airline: { code: flightNum.slice(0, 2), name: 'Test Airline' },
    segments: overrides.segments || [
      {
        id: `seg_${Math.random().toString(36).slice(2, 8)}`,
        departure: { airport: origin, airportName: origin, city: origin, time: depTime },
        arrival: { airport: dest, airportName: dest, city: dest, time: arrTime },
        airline: { code: flightNum.slice(0, 2), name: 'Test Airline' },
        flightNumber: flightNum,
        duration: 720,
      },
    ],
    totalPrice: overrides.price,
    currency: 'USD',
    cabinClass: cabin as UnifiedFlight['cabinClass'],
    fareRules: {
      refundable: overrides.refundable ?? false,
      changeable: overrides.changeable ?? false,
      cancellationFee: overrides.cancellationFee,
      changeFee: overrides.changeFee,
    },
    baggage: {
      carryOn: overrides.carryOn ?? 1,
      checked: overrides.checked ?? 0,
    },
    totalDuration: 720,
    stops: 0,
    valueScore: 50,
    ...overrides,
  } as UnifiedFlight;
}

// ═══════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════

console.log('\n🧪 Provider Aggregation Tests — APPEND_ALL Mode\n');

// ── Test 1: Duffel returns 100, Mystifly returns 80 → 180 total ──
console.log('Test 1: Duffel 100 + Mystifly 80 = 180 total offers');
{
  const duffelFlights = Array.from({ length: 100 }, (_, i) =>
    makeFlight({ provider: 'duffel', price: 500 + i, flightNumber: `DL${1000 + i}`, origin: 'JFK', destination: 'LAX', departureTime: `2026-07-15T${String(6 + (i % 12)).padStart(2, '0')}:00:00` })
  );
  const mystiflyFlights = Array.from({ length: 80 }, (_, i) =>
    makeFlight({ provider: 'mystifly', price: 520 + i, flightNumber: `AA${2000 + i}`, origin: 'JFK', destination: 'LAX', departureTime: `2026-07-15T${String(6 + (i % 12)).padStart(2, '0')}:30:00` })
  );
  const { flights, stats } = aggregateProviderOffers([...duffelFlights, ...mystiflyFlights]);
  assertEqual(flights.length, 180, 'Should return 180 total offers');
  assertEqual(stats.totalOffersAfterAggregation, 180, 'Stats should show 180');
  assertEqual(stats.aggregationMode, 'APPEND_ALL', 'Mode should be APPEND_ALL');
  assertEqual(stats.providerCounts['duffel'], 100, 'Duffel count should be 100');
  assertEqual(stats.providerCounts['mystifly'], 80, 'Mystifly count should be 80');
}

// ── Test 2: Same itinerary from both providers → BOTH retained ──
console.log('\nTest 2: Same itinerary from Duffel and Mystifly — both retained');
{
  const duffel = makeFlight({ provider: 'duffel', price: 850 });
  const mystifly = makeFlight({ provider: 'mystifly', price: 820 });
  const { flights } = aggregateProviderOffers([duffel, mystifly]);
  assertEqual(flights.length, 2, 'Should return 2 offers (no dedup)');
  const providers = flights.map(f => f.provider);
  assert(providers.includes('duffel'), 'Duffel offer should be present');
  assert(providers.includes('mystifly'), 'Mystifly offer should be present');
}

// ── Test 3: Same route, same flight number, different providers → both retained ──
console.log('\nTest 3: Same flight number from different providers — both retained');
{
  const duffel = makeFlight({ provider: 'duffel', price: 800, flightNumber: 'AA1087' });
  const mystifly = makeFlight({ provider: 'mystifly', price: 850, flightNumber: 'AA1087' });
  const { flights } = aggregateProviderOffers([duffel, mystifly]);
  assertEqual(flights.length, 2, 'Should return 2 offers (same flight, different providers)');
}

// ── Test 4: One provider fails → other provider offers still shown ──
console.log('\nTest 4: Provider failure — only one provider returns offers');
{
  const duffel = makeFlight({ provider: 'duffel', price: 820 });
  // Mystifly failed — no offers
  const { flights, stats } = aggregateProviderOffers([duffel]);
  assertEqual(flights.length, 1, 'Should return 1 flight from successful provider');
  assertEqual(flights[0].provider, 'duffel', 'Duffel offer should be present');
  assertEqual(stats.duplicateGroupsFound, 0, 'No duplicate groups (APPEND_ALL never groups)');
}

// ── Test 5: Booking Duffel offer uses Duffel providerOfferId ──
console.log('\nTest 5: Duffel offer preserves providerOfferId');
{
  const duffelOfferId = 'off_duffel_abc123';
  const duffel = makeFlight({ provider: 'duffel', price: 850, providerOfferId: duffelOfferId });
  const { flights } = aggregateProviderOffers([duffel]);
  assertEqual(flights[0].providerOfferId, duffelOfferId, 'Duffel providerOfferId preserved');
  assertEqual(flights[0].provider, 'duffel', 'Provider identity preserved');
}

// ── Test 6: Booking Mystifly offer uses Mystifly providerOfferId ──
console.log('\nTest 6: Mystifly offer preserves providerOfferId');
{
  const mystiflyOfferId = 'V1~mystifly_xyz789';
  const mystifly = makeFlight({ provider: 'mystifly', price: 820, providerOfferId: mystiflyOfferId });
  const { flights } = aggregateProviderOffers([mystifly]);
  assertEqual(flights[0].providerOfferId, mystiflyOfferId, 'Mystifly providerOfferId preserved');
  assertEqual(flights[0].provider, 'mystifly', 'Provider identity preserved');
}

// ── Test 7: Existing scoring pipeline still runs (offers pass through) ──
console.log('\nTest 7: All offers pass through to scoring pipeline');
{
  const offers = [
    makeFlight({ provider: 'duffel', price: 800, flightNumber: 'AA100' }),
    makeFlight({ provider: 'mystifly', price: 820, flightNumber: 'AA100' }),
    makeFlight({ provider: 'duffel', price: 900, flightNumber: 'UA200' }),
  ];
  const { flights } = aggregateProviderOffers(offers);
  assertEqual(flights.length, 3, 'All 3 offers should pass through');
}

// ── Test 8: Existing labels still apply (provider data preserved) ──
console.log('\nTest 8: Flight data preserved for labeling/scoring');
{
  const flight = makeFlight({
    provider: 'duffel', price: 800,
    checked: 2, carryOn: 1,
    refundable: true, changeable: true,
  });
  const { flights } = aggregateProviderOffers([flight]);
  assertEqual(flights[0].baggage.checked, 2, 'Baggage data preserved');
  assertEqual(flights[0].fareRules.refundable, true, 'Fare rules preserved');
  assertEqual(flights[0].fareRules.changeable, true, 'Changeability preserved');
}

// ── Test 9: No lowest-fare aggregation filter runs ──
console.log('\nTest 9: No fare-based filtering');
{
  const cheap = makeFlight({ provider: 'duffel', price: 300 });
  const expensive = makeFlight({ provider: 'mystifly', price: 3000 });
  const { flights } = aggregateProviderOffers([cheap, expensive]);
  assertEqual(flights.length, 2, 'Both cheap and expensive offers retained');
}

// ── Test 10: No baggage/rules winner selection runs ──
console.log('\nTest 10: No winner selection based on baggage or rules');
{
  const goodBaggage = makeFlight({ provider: 'duffel', price: 820, checked: 2, carryOn: 1 });
  const noBaggage = makeFlight({ provider: 'mystifly', price: 820, checked: 0, carryOn: 0 });
  const refundable = makeFlight({ provider: 'duffel', price: 900, refundable: true, changeable: true });
  const nonRefundable = makeFlight({ provider: 'mystifly', price: 900, refundable: false, changeable: false });
  const { flights } = aggregateProviderOffers([goodBaggage, noBaggage, refundable, nonRefundable]);
  assertEqual(flights.length, 4, 'All 4 offers retained regardless of baggage/rules');
}

// ── Test 11: No aggregationMeta attached (no winner selection) ──
console.log('\nTest 11: No aggregationMeta attached to any offer');
{
  const duffel = makeFlight({ provider: 'duffel', price: 850 });
  const mystifly = makeFlight({ provider: 'mystifly', price: 820 });
  const { flights } = aggregateProviderOffers([duffel, mystifly]);
  assert(flights[0].aggregationMeta === undefined, 'First offer should have no aggregationMeta');
  assert(flights[1].aggregationMeta === undefined, 'Second offer should have no aggregationMeta');
}

// ── Test 12: Empty input ──
console.log('\nTest 12: Empty input returns empty output');
{
  const { flights, stats } = aggregateProviderOffers([]);
  assertEqual(flights.length, 0, 'Should return 0 flights');
  assertEqual(stats.totalOffersBeforeAggregation, 0, 'Before: 0');
  assertEqual(stats.totalOffersAfterAggregation, 0, 'After: 0');
}

// ── Bonus: Duplicate key builder still works ──
console.log('\nBonus: Duplicate key builder (utility)');
{
  const flight = makeFlight({ provider: 'duffel', price: 820 });
  const key = buildDuplicateKey(flight);
  assert(key.length > 0, 'Key should not be empty');
  assert(key.includes('AA1087'), 'Key should include flight number');
  assert(key.includes('DFW'), 'Key should include origin');
  assert(key.includes('LHR'), 'Key should include destination');
  assert(key.includes('economy'), 'Key should include cabin');
}

// ── Bonus: Flight number normalization ──
console.log('\nBonus: Flight number normalization');
{
  assertEqual(normalizeFlightNumber('AA1087'), 'AA1087', 'No-space format stays same');
  assertEqual(normalizeFlightNumber('AA 1087'), 'AA1087', 'Space removed');
  assertEqual(normalizeFlightNumber('aa 1087'), 'AA1087', 'Lowercased and space removed');
  assertEqual(normalizeFlightNumber('BA  456'), 'BA456', 'Multiple spaces removed');
}

// ── Bonus: Aggregation stats ──
console.log('\nBonus: Aggregation stats');
{
  const duffel = makeFlight({ provider: 'duffel', price: 850 });
  const mystifly = makeFlight({ provider: 'mystifly', price: 820 });
  const unique = makeFlight({ provider: 'duffel', price: 900, flightNumber: 'UA456', origin: 'JFK', destination: 'CDG' });
  const { stats } = aggregateProviderOffers([duffel, mystifly, unique]);
  assertEqual(stats.totalOffersBeforeAggregation, 3, 'Before: 3 offers');
  assertEqual(stats.totalOffersAfterAggregation, 3, 'After: 3 offers (no dedup)');
  assertEqual(stats.duplicateGroupsFound, 0, 'No duplicate groups (APPEND_ALL)');
  assertEqual(stats.providerCounts['duffel'], 2, 'Duffel: 2 offers');
  assertEqual(stats.providerCounts['mystifly'], 1, 'Mystifly: 1 offer');
}

// ═══════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(50)}\n`);

if (failed > 0) {
  process.exit(1);
}
