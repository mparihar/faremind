/**
 * Run: cd backend && npx tsx --test src/services/fare-family.test.ts
 *
 * Cases marked "live" are fare family strings actually returned by Mystifly on
 * DEL-BOM, JFK-LHR and LHR-SIN searches. The rest are brands from carriers we
 * have not seen yet — they must tier correctly with no code change.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import {
  normalizeFareTier,
  displayFareFamily,
  cabinBucket,
  itineraryKey,
  parseBaggageAllowance,
  type NormalizedFareTier,
} from './fare-family';

const eco = { cabinClass: 'economy', refundable: false, changeable: false, checkedBags: 1 };

test('live Mystifly fare families tier correctly', () => {
  const cases: Array<[string, NormalizedFareTier]> = [
    // DEL-BOM (IX / 6E)
    ['VALUE', 'BASIC'],
    ['ECO VALUE', 'BASIC'],
    ['CLASSIC', 'STANDARD'],
    ['ECO CLASSIC', 'STANDARD'],
    ['FLEX', 'FLEX'],
    ['INDIGO UPFRONT', 'FLEX'],
    // JFK-LHR (EI / DL)
    ['SAVER', 'BASIC'],
    ['ECONOMY LIGHT', 'BASIC'],
    ['DELTA MAIN BASIC', 'BASIC'],
    ['SMART', 'STANDARD'],
    ['ECONOMY CLASSIC', 'STANDARD'],
  ];
  for (const [family, expected] of cases) {
    assert.equal(normalizeFareTier({ ...eco, fareFamily: family }), expected, `${family} → ${expected}`);
  }
});

test('brands with no tier signal fall back to attributes, not to a guess', () => {
  // "RETURN" / "ROUNDTRIP FARE" / "REGULAR FARE" are trip-type labels Mystifly
  // returns in the FareFamily slot — they carry no brand meaning.
  assert.equal(normalizeFareTier({ ...eco, fareFamily: 'RETURN' }), 'STANDARD');
  assert.equal(normalizeFareTier({ ...eco, fareFamily: 'ROUNDTRIP FARE' }), 'STANDARD');
  assert.equal(
    normalizeFareTier({ ...eco, fareFamily: 'ROUNDTRIP FARE', refundable: true, changeable: true }),
    'FLEX',
  );
  // Airline filed no brand at all (observed on JFK-LHR).
  assert.equal(normalizeFareTier({ ...eco, fareFamily: '', checkedBags: 0 }), 'BASIC');
  assert.equal(normalizeFareTier({ ...eco, fareFamily: null, refundable: true, changeable: true }), 'FLEX');
});

test('cabin outranks brand — a Business Flex is BUSINESS', () => {
  assert.equal(normalizeFareTier({ fareFamily: 'BUSINESS FLEX', cabinClass: 'business' }), 'BUSINESS');
  assert.equal(normalizeFareTier({ fareFamily: 'Business Lite', cabinClass: 'business' }), 'BUSINESS');
  assert.equal(normalizeFareTier({ fareFamily: 'PREMIUMECONOMY', cabinClass: 'premium_economy' }), 'PREMIUM');
  assert.equal(normalizeFareTier({ fareFamily: 'Flex', cabinClass: 'first' }), 'FIRST');
});

test('unseen carrier brands tier without a code change', () => {
  const cases: Array<[string, NormalizedFareTier]> = [
    // Lufthansa / Air France / Emirates / Delta, per spec
    ['Light', 'BASIC'],
    ['Standard', 'STANDARD'],
    ['Flex', 'FLEX'],
    ['Special', 'BASIC'],
    ['Flex Plus', 'FLEX'],
    ['Main Basic', 'BASIC'],
    ['Main Classic', 'STANDARD'],
    // Future-compatibility list from the spec
    ['Comfort', 'STANDARD'],
    ['Comfort+', 'FLEX'],
    ['Value', 'BASIC'],
    ['Choice', 'STANDARD'],
    ['Go Smart', 'STANDARD'],
    ['Super Flex', 'FLEX'],
    ['Ultra', 'FLEX'],
    ['Prime', 'FLEX'],
  ];
  for (const [family, expected] of cases) {
    assert.equal(normalizeFareTier({ ...eco, fareFamily: family }), expected, `${family} → ${expected}`);
  }
});

test('display never invents a brand', () => {
  assert.equal(displayFareFamily('ECO VALUE', 'economy'), 'ECO VALUE');
  assert.equal(displayFareFamily('  Comfort+  ', 'economy'), 'Comfort+');
  // No brand filed → plain cabin name, never "Economy Basic".
  assert.equal(displayFareFamily('', 'economy'), 'Economy');
  assert.equal(displayFareFamily(null, 'business'), 'Business');
  assert.equal(displayFareFamily(undefined, 'premium_economy'), 'Premium Economy');
});

test('cabin bucket keeps the four industry tabs', () => {
  assert.equal(cabinBucket('economy'), 'economy');
  assert.equal(cabinBucket('premium_economy'), 'premium_economy');
  assert.equal(cabinBucket('business'), 'business');
  assert.equal(cabinBucket('first'), 'first');
  assert.equal(cabinBucket(undefined), 'economy');
});

test('itineraryKey groups the same metal across fare families', () => {
  const seg = (flightNumber: string, time: string) => ({
    flightNumber,
    airline: { code: 'IX' },
    departure: { airport: 'DEL', time },
    arrival: { airport: 'BOM' },
  });
  const a = itineraryKey([seg('1056', '2026-09-10T17:50:00')]);
  const b = itineraryKey([seg('1056', '2026-09-10T17:50:00')]);
  const c = itineraryKey([seg('1235', '2026-09-10T17:50:00')]);
  assert.equal(a, b, 'same flight+time → same key regardless of fare');
  assert.notEqual(a, c, 'different flight number → different key');
});

test('baggage parses weight allowances without dropping them', () => {
  // The old rule was `kg >= 20 ? 1 : 0`, which reported a real 15Kg allowance
  // as "no checked bag".
  assert.deepEqual(parseBaggageAllowance('15Kg'), { pieces: 1, kg: 15, raw: '15Kg' });
  assert.deepEqual(parseBaggageAllowance('20KG'), { pieces: 1, kg: 20, raw: '20KG' });
  assert.deepEqual(parseBaggageAllowance('0KG'), { pieces: 0, kg: 0, raw: '0KG' });
  assert.deepEqual(parseBaggageAllowance('0PC'), { pieces: 0, kg: null, raw: '0PC' });
  assert.deepEqual(parseBaggageAllowance('2PC'), { pieces: 2, kg: null, raw: '2PC' });
  assert.deepEqual(parseBaggageAllowance('SB'), { pieces: null, kg: null, raw: 'SB' });
  assert.deepEqual(parseBaggageAllowance(''), { pieces: null, kg: null, raw: '' });
});
