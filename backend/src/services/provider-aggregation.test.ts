/**
 * Provider Aggregation Tests
 *
 * Tests for duplicate itinerary detection and best-provider selection.
 * Run with: npx tsx backend/src/services/provider-aggregation.test.ts
 */

import {
  buildDuplicateKey,
  normalizeFlightNumber,
  selectBestOffer,
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

console.log('\n🧪 Provider Aggregation Tests\n');

// ── Test 1: Same itinerary, Mystifly cheaper → Mystifly selected ──
console.log('Test 1: Same itinerary, Mystifly cheaper');
{
  const duffel = makeFlight({ provider: 'duffel', price: 850 });
  const mystifly = makeFlight({ provider: 'mystifly', price: 820 });
  const { flights } = aggregateProviderOffers([duffel, mystifly]);
  assertEqual(flights.length, 1, 'Should return 1 flight');
  assertEqual(flights[0].provider, 'mystifly', 'Mystifly should be selected');
  assertEqual(flights[0].totalPrice, 820, 'Price should be $820');
  assert(flights[0].aggregationMeta !== undefined, 'Should have aggregation metadata');
  assert(flights[0].aggregationMeta!.selectionReason.includes('lower provider fare'), 'Reason should mention lower fare');
}

// ── Test 2: Same itinerary, Duffel cheaper → Duffel selected ──
console.log('\nTest 2: Same itinerary, Duffel cheaper');
{
  const duffel = makeFlight({ provider: 'duffel', price: 800 });
  const mystifly = makeFlight({ provider: 'mystifly', price: 850 });
  const { flights } = aggregateProviderOffers([duffel, mystifly]);
  assertEqual(flights.length, 1, 'Should return 1 flight');
  assertEqual(flights[0].provider, 'duffel', 'Duffel should be selected');
  assertEqual(flights[0].totalPrice, 800, 'Price should be $800');
}

// ── Test 3: Same fare, Duffel has checked bag → Duffel selected ──
console.log('\nTest 3: Same fare, Duffel has checked bag');
{
  const duffel = makeFlight({ provider: 'duffel', price: 820, checked: 1, carryOn: 1 });
  const mystifly = makeFlight({ provider: 'mystifly', price: 820, checked: 0, carryOn: 1 });
  const { flights } = aggregateProviderOffers([duffel, mystifly]);
  assertEqual(flights.length, 1, 'Should return 1 flight');
  assertEqual(flights[0].provider, 'duffel', 'Duffel should be selected (better baggage)');
  assert(flights[0].aggregationMeta!.selectionReason.includes('baggage'), 'Reason should mention baggage');
}

// ── Test 4: Same fare+baggage, Mystifly better cancellation → Mystifly selected ──
console.log('\nTest 4: Same fare and baggage, Mystifly has better cancellation');
{
  const duffel = makeFlight({
    provider: 'duffel', price: 820, checked: 1, carryOn: 1,
    refundable: false, changeable: false,
  });
  const mystifly = makeFlight({
    provider: 'mystifly', price: 820, checked: 1, carryOn: 1,
    refundable: true, changeable: true,
  });
  const { flights } = aggregateProviderOffers([duffel, mystifly]);
  assertEqual(flights.length, 1, 'Should return 1 flight');
  assertEqual(flights[0].provider, 'mystifly', 'Mystifly should be selected (better rules)');
  assert(flights[0].aggregationMeta!.selectionReason.includes('rules'), 'Reason should mention rules');
}

// ── Test 5: Everything equal → deterministic priority (Duffel) ──
console.log('\nTest 5: Everything equal — deterministic priority');
{
  const duffel = makeFlight({
    provider: 'duffel', price: 820, checked: 1, carryOn: 1,
    refundable: false, changeable: false,
  });
  const mystifly = makeFlight({
    provider: 'mystifly', price: 820, checked: 1, carryOn: 1,
    refundable: false, changeable: false,
  });
  const { flights } = aggregateProviderOffers([duffel, mystifly]);
  assertEqual(flights.length, 1, 'Should return 1 flight');
  assertEqual(flights[0].provider, 'duffel', 'Duffel should be selected (higher priority)');
  assert(flights[0].aggregationMeta!.selectionReason.includes('deterministic'), 'Reason should mention deterministic priority');
}

// ── Test 6: Different flight numbers → both shown ──
console.log('\nTest 6: Different flight numbers — both shown');
{
  const duffel = makeFlight({ provider: 'duffel', price: 820, flightNumber: 'AA1087' });
  const mystifly = makeFlight({ provider: 'mystifly', price: 820, flightNumber: 'BA456' });
  const { flights } = aggregateProviderOffers([duffel, mystifly]);
  assertEqual(flights.length, 2, 'Should return 2 flights (different itineraries)');
}

// ── Test 7: Same route, different departure time → both shown ──
console.log('\nTest 7: Same route but different departure time');
{
  const duffel = makeFlight({ provider: 'duffel', price: 820, departureTime: '2026-07-15T08:30:00' });
  const mystifly = makeFlight({ provider: 'mystifly', price: 820, departureTime: '2026-07-15T14:30:00' });
  const { flights } = aggregateProviderOffers([duffel, mystifly]);
  assertEqual(flights.length, 2, 'Should return 2 flights (different departure times)');
}

// ── Test 8: Same flight, different cabin → both shown ──
console.log('\nTest 8: Same flight but different cabin');
{
  const duffel = makeFlight({ provider: 'duffel', price: 820, cabin: 'economy' });
  const mystifly = makeFlight({ provider: 'mystifly', price: 1200, cabin: 'business' });
  const { flights } = aggregateProviderOffers([duffel, mystifly]);
  assertEqual(flights.length, 2, 'Should return 2 flights (different cabins)');
}

// ── Test 9: Provider failure — one returns empty → other provider shown ──
console.log('\nTest 9: Provider failure — only one provider returns offers');
{
  const duffel = makeFlight({ provider: 'duffel', price: 820 });
  // Mystifly failed — no offers
  const { flights, stats } = aggregateProviderOffers([duffel]);
  assertEqual(flights.length, 1, 'Should return 1 flight from successful provider');
  assertEqual(flights[0].provider, 'duffel', 'Duffel offer should be present');
  assertEqual(stats.duplicateGroupsFound, 0, 'No duplicate groups (only one provider)');
}

// ── Test 10: Aggregated card booking uses correct provider offer ID ──
console.log('\nTest 10: Booking uses selected provider offer ID');
{
  const duffelOfferId = 'off_duffel_abc123';
  const mystiflyOfferId = 'off_mystifly_xyz789';
  const duffel = makeFlight({ provider: 'duffel', price: 850, providerOfferId: duffelOfferId });
  const mystifly = makeFlight({ provider: 'mystifly', price: 820, providerOfferId: mystiflyOfferId });
  const { flights } = aggregateProviderOffers([duffel, mystifly]);
  assertEqual(flights.length, 1, 'Should return 1 flight');
  assertEqual(flights[0].providerOfferId, mystiflyOfferId, 'Should use Mystifly offer ID (cheaper)');
  assertEqual(flights[0].provider, 'mystifly', 'Provider should be mystifly');
  // Simulate what booking flow would do:
  const selectedOffer = flights[0];
  assert(selectedOffer.providerOfferId === mystiflyOfferId, 'Booking should use selected provider offer ID');
}

// ── Bonus: Duplicate key builder tests ──
console.log('\nBonus: Duplicate key builder');
{
  const flight = makeFlight({ provider: 'duffel', price: 820 });
  const key = buildDuplicateKey(flight);
  assert(key.length > 0, 'Key should not be empty');
  assert(key.includes('AA1087'), 'Key should include flight number');
  assert(key.includes('DFW'), 'Key should include origin');
  assert(key.includes('LHR'), 'Key should include destination');
  assert(key.includes('economy'), 'Key should include cabin');

  // Same flight from different providers should produce same key
  const duffelFlight = makeFlight({ provider: 'duffel', price: 850 });
  const mystiflyFlight = makeFlight({ provider: 'mystifly', price: 820 });
  assertEqual(buildDuplicateKey(duffelFlight), buildDuplicateKey(mystiflyFlight), 'Same itinerary should produce same key');
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
  assertEqual(stats.totalOffersAfterAggregation, 2, 'After: 2 offers');
  assertEqual(stats.duplicateGroupsFound, 1, '1 duplicate group');
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
