/**
 * Run: cd backend && npx tsx --test src/services/fare-family.test.ts
 *
 * Covers three things:
 *   • the internal tier a brand maps to (fare-family.ts)
 *   • the comfort SCORE the ranking engine gives that brand (scoreComfort.ts),
 *     including the neutral fallback for names we do not recognise
 *   • provider baggage formats (0PC / 1PC / 2PC / 15kg / 23kg / 32kg)
 *
 * Cases marked "live" are strings Mystifly actually returned on DEL-BOM,
 * JFK-LHR, LHR-SIN and SIN-SYD searches. The rest are brands from carriers we
 * have not seen — they must behave correctly with no code change.
 *
 * The scoring engine is NOT modified by the fare-family work; these tests pin
 * its behaviour against the inputs we now feed it.
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
import { scoreComfort } from '../ranking/core/scoreComfort';

const eco = { cabinClass: 'economy', refundable: false, changeable: false, checkedBags: 1 };

/** scoreComfort with everything except cabin + fare name held constant. */
function comfortOf(fareClassName: string, cabinClass: any = 'economy'): number {
  return scoreComfort(
    cabinClass, fareClassName,
    undefined,      // seatPitch
    undefined,      // seatSelection
    false,          // wifi
    false,          // meals
    false,          // entertainment
    false,          // priorityBoarding
    false,          // loungeAccess
    480,            // longestSegmentMinutes
    'international' as any,
  );
}

/** The score an economy fare gets when the brand carries no recognised signal. */
const NEUTRAL_ECONOMY_COMFORT = comfortOf('');

// ─── Tier mapping ────────────────────────────────────────────────────────────

test('live Mystifly fare families tier correctly', () => {
  const cases: Array<[string, NormalizedFareTier]> = [
    ['VALUE', 'BASIC'],
    ['ECO VALUE', 'BASIC'],
    ['CLASSIC', 'STANDARD'],
    ['ECO CLASSIC', 'STANDARD'],
    ['FLEX', 'FLEX'],
    ['FLEXI', 'FLEX'],
    ['INDIGO UPFRONT', 'FLEX'],
    ['SAVER', 'BASIC'],
    ['ECONOMY LIGHT', 'BASIC'],
    ['LIGHT', 'BASIC'],
    ['DELTA MAIN BASIC', 'BASIC'],
    ['SMART', 'STANDARD'],
    ['ECONOMY CLASSIC', 'STANDARD'],
  ];
  for (const [family, expected] of cases) {
    assert.equal(normalizeFareTier({ ...eco, fareFamily: family }), expected, `${family} → ${expected}`);
  }
});

test('the brands named in the refactor brief tier correctly', () => {
  const cases: Array<[string, NormalizedFareTier]> = [
    ['Basic', 'BASIC'],
    ['Main Basic', 'BASIC'],
    ['Classic', 'STANDARD'],
    ['Main Classic', 'STANDARD'],
    ['Flex', 'FLEX'],
    ['Saver', 'BASIC'],
    ['Value', 'BASIC'],
  ];
  for (const [family, expected] of cases) {
    assert.equal(normalizeFareTier({ ...eco, fareFamily: family }), expected, `${family} → ${expected}`);
  }
  // Cabin outranks brand — a Business Flex is BUSINESS, not FLEX.
  assert.equal(normalizeFareTier({ fareFamily: 'Business Flex', cabinClass: 'business' }), 'BUSINESS');
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
  assert.equal(normalizeFareTier({ ...eco, fareFamily: '', checkedBags: 0 }), 'BASIC');
  assert.equal(normalizeFareTier({ ...eco, fareFamily: null, refundable: true, changeable: true }), 'FLEX');
});

test('cabin outranks brand', () => {
  assert.equal(normalizeFareTier({ fareFamily: 'BUSINESS FLEX', cabinClass: 'business' }), 'BUSINESS');
  assert.equal(normalizeFareTier({ fareFamily: 'Business Lite', cabinClass: 'business' }), 'BUSINESS');
  assert.equal(normalizeFareTier({ fareFamily: 'PREMIUMECONOMY', cabinClass: 'premium_economy' }), 'PREMIUM');
  assert.equal(normalizeFareTier({ fareFamily: 'Flex', cabinClass: 'first' }), 'FIRST');
});

test('unseen carrier brands tier without a code change', () => {
  const cases: Array<[string, NormalizedFareTier]> = [
    ['Light', 'BASIC'], ['Standard', 'STANDARD'], ['Flex', 'FLEX'], ['Special', 'BASIC'],
    ['Flex Plus', 'FLEX'], ['Comfort', 'STANDARD'], ['Comfort+', 'FLEX'], ['Choice', 'STANDARD'],
    ['Go Smart', 'STANDARD'], ['Super Flex', 'FLEX'], ['Ultra', 'FLEX'], ['Prime', 'FLEX'],
  ];
  for (const [family, expected] of cases) {
    assert.equal(normalizeFareTier({ ...eco, fareFamily: family }), expected, `${family} → ${expected}`);
  }
});

// ─── Comfort score: the ranking engine's view of these brands ─────────────────

test('recognised brands move the comfort score in the right direction', () => {
  const neutral = NEUTRAL_ECONOMY_COMFORT;
  // scoreComfort keys off basic|light|saver (40), classic (62), flex (68)
  // against a 60 baseline for undifferentiated economy.
  assert.ok(comfortOf('DELTA MAIN BASIC') < neutral, 'basic economy scores below neutral');
  assert.ok(comfortOf('SAVER') < neutral, 'saver scores below neutral');
  assert.ok(comfortOf('ECONOMY LIGHT') < neutral, 'light scores below neutral');
  assert.ok(comfortOf('FLEX') > neutral, 'flex scores above neutral');
  assert.ok(comfortOf('FLEXI') > neutral, 'flexi matches the flex branch (engine uses substring)');
  assert.ok(comfortOf('CLASSIC') > neutral, 'classic scores above neutral');
  // Ordering must be monotonic: basic < classic < flex.
  assert.ok(comfortOf('DELTA MAIN BASIC') < comfortOf('CLASSIC'), 'basic below classic');
  assert.ok(comfortOf('CLASSIC') < comfortOf('FLEX'), 'classic below flex');
});

test('unknown and absent brands receive the NEUTRAL comfort score, not a misclassification', () => {
  const neutral = NEUTRAL_ECONOMY_COMFORT;
  // Real Mystifly values that carry no tier signal, plus invented ones. None of
  // these may be pushed up or down — an unrecognised brand must not be guessed at.
  const unknown = [
    'RETURN', 'ROUNDTRIP FARE', 'REGULAR FARE', 'ECO VALUE', 'VALUE', 'INDIGO UPFRONT',
    'SMART', 'ECONOMY', 'PROMO', 'Go Smart', 'Choice', 'Ultra', 'Prime', 'Zephyr', '',
  ];
  for (const name of unknown) {
    assert.equal(
      comfortOf(name), neutral,
      `"${name}" must hold the neutral economy comfort score (${neutral}), not be classified`,
    );
  }
});

test('premium cabins ignore the brand entirely — comfort is cabin-driven', () => {
  // This is why business/first rankings did not move at all in the regression.
  for (const cabin of ['business', 'first', 'premium_economy'] as const) {
    const base = comfortOf('', cabin);
    for (const name of ['BUSINESS FLEX', 'DELTA ONE CLASSIC', 'UPPER CLASS', 'SAVER', 'anything']) {
      assert.equal(comfortOf(name, cabin), base, `${cabin} comfort must not vary with brand "${name}"`);
    }
  }
});

// ─── Display ─────────────────────────────────────────────────────────────────

test('display never invents a brand', () => {
  assert.equal(displayFareFamily('ECO VALUE', 'economy'), 'ECO VALUE');
  assert.equal(displayFareFamily('  Comfort+  ', 'economy'), 'Comfort+');
  assert.equal(displayFareFamily('', 'economy'), 'Economy');
  assert.equal(displayFareFamily(null, 'business'), 'Business');
  assert.equal(displayFareFamily(undefined, 'premium_economy'), 'Premium Economy');
  assert.equal(displayFareFamily('', 'first'), 'First');
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
    flightNumber, airline: { code: 'IX' },
    departure: { airport: 'DEL', time }, arrival: { airport: 'BOM' },
  });
  const a = itineraryKey([seg('1056', '2026-09-10T17:50:00')]);
  const b = itineraryKey([seg('1056', '2026-09-10T17:50:00')]);
  const c = itineraryKey([seg('1235', '2026-09-10T17:50:00')]);
  assert.equal(a, b, 'same flight+time → same key regardless of fare');
  assert.notEqual(a, c, 'different flight number → different key');
});

// ─── Baggage formats ─────────────────────────────────────────────────────────

test('provider baggage formats parse correctly', () => {
  // Piece-based
  assert.deepEqual(parseBaggageAllowance('0PC'), { pieces: 0, kg: null, raw: '0PC' });
  assert.deepEqual(parseBaggageAllowance('1PC'), { pieces: 1, kg: null, raw: '1PC' });
  assert.deepEqual(parseBaggageAllowance('2PC'), { pieces: 2, kg: null, raw: '2PC' });
  // Weight-based. The old rule was `kg >= 20 ? 1 : 0`, which reported a real
  // 15Kg allowance as "no checked bag".
  assert.deepEqual(parseBaggageAllowance('15Kg'), { pieces: 1, kg: 15, raw: '15Kg' });
  assert.deepEqual(parseBaggageAllowance('23Kg'), { pieces: 1, kg: 23, raw: '23Kg' });
  assert.deepEqual(parseBaggageAllowance('32Kg'), { pieces: 1, kg: 32, raw: '32Kg' });
  // Casing varies between carriers on the same route.
  assert.deepEqual(parseBaggageAllowance('15KG'), { pieces: 1, kg: 15, raw: '15KG' });
  assert.deepEqual(parseBaggageAllowance('20KG'), { pieces: 1, kg: 20, raw: '20KG' });
  assert.deepEqual(parseBaggageAllowance('69Kg'), { pieces: 1, kg: 69, raw: '69Kg' });
  // Genuine zero must stay zero.
  assert.deepEqual(parseBaggageAllowance('0KG'), { pieces: 0, kg: 0, raw: '0KG' });
  // Non-numeric codes carry no allowance — "SB" is a small/standby bag marker.
  assert.deepEqual(parseBaggageAllowance('SB'), { pieces: null, kg: null, raw: 'SB' });
  assert.deepEqual(parseBaggageAllowance(''), { pieces: null, kg: null, raw: '' });
  assert.deepEqual(parseBaggageAllowance(null), { pieces: null, kg: null, raw: '' });
});

test('baggage weight is preserved for display, not just bucketed', () => {
  // The panel shows "Checked baggage: 15Kg", so the raw value must survive.
  for (const raw of ['0PC', '1PC', '2PC', '15Kg', '23Kg', '32Kg']) {
    assert.equal(parseBaggageAllowance(raw).raw, raw, `${raw} must round-trip for display`);
  }
  assert.equal(parseBaggageAllowance('15Kg').kg, 15);
  assert.equal(parseBaggageAllowance('32Kg').kg, 32);
});
