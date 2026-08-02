/**
 * Run: cd backend && npx tsx --test src/services/fare-category.test.ts
 *
 * The contract: every provider offer lands in exactly one FareMind tab, the
 * airline's brand is never rewritten, and an offer we cannot place goes to the
 * visible `other` tab rather than disappearing.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import {
  classifyFareCategory, FARE_CATEGORY_ORDER,
  emptyDiagnostics, recordClassification, formatDiagnostics,
} from './fare-category';

// ── Priority 1: the provider's own cabin wins ────────────────────────────────

test('provider cabin is authoritative and beats every weaker signal', () => {
  // RBD 'Y' and a brand saying "Saver" both point at economy; the provider says
  // business, and the provider wins.
  const r = classifyFareCategory({
    cabinClass: 'business', bookingClass: 'Y', fareFamily: 'SAVER',
    segmentCabinCodes: ['Y'], fareBasisCodes: ['YL7X'],
  });
  assert.equal(r.category, 'business');
  assert.equal(r.method, 'provider_cabin');
});

test('provider cabin codes and words both decode', () => {
  for (const [value, expected] of [
    ['Y', 'economy'], ['C', 'business'], ['J', 'business'], ['F', 'first'],
    ['economy', 'economy'], ['business', 'business'], ['first', 'first'],
  ] as const) {
    assert.equal(classifyFareCategory({ cabinClass: value }).category, expected, `${value}`);
  }
});

test('premium economy is its own tab, never folded into Economy', () => {
  // 'premium_economy' contains 'economy' and must not fall through to it.
  for (const v of ['premium_economy', 'Premium Economy', 'premium-economy', 'S']) {
    assert.equal(classifyFareCategory({ cabinClass: v }).category, 'premium_economy', `${v}`);
  }
});

test('a bare "premium" cabin names no cabin and is not guessed', () => {
  // Premium first and premium economy both use the word; picking one would be
  // a guess, and the offer stays visible under Other instead.
  assert.equal(classifyFareCategory({ cabinClass: 'premium' }).category, 'other');
});

// ── Priority 2: per-segment cabin ────────────────────────────────────────────

test('segment cabin classifies when the offer carries no cabin', () => {
  const r = classifyFareCategory({ segmentCabinCodes: ['C', 'C'] });
  assert.equal(r.category, 'business');
  assert.equal(r.method, 'segment_cabin');
});

test('a mixed-cabin itinerary is Other, not whichever segment came first', () => {
  const r = classifyFareCategory({ segmentCabinCodes: ['Y', 'C'] });
  assert.equal(r.category, 'other');
  assert.equal(r.method, 'segment_cabin');
  assert.match(r.evidence ?? '', /mixed/);
});

// ── Priority 3: RBD ──────────────────────────────────────────────────────────

test('unambiguous RBDs classify; ambiguous ones do not', () => {
  assert.equal(classifyFareCategory({ bookingClass: 'J' }).category, 'business');
  assert.equal(classifyFareCategory({ bookingClass: 'F' }).category, 'first');
  assert.equal(classifyFareCategory({ bookingClass: 'L' }).category, 'economy');

  // W, S, E, P and R mean different cabins at different carriers. Guessing is
  // how a business fare ends up under Economy — they must fall through.
  for (const rbd of ['W', 'S', 'E', 'P', 'R']) {
    const r = classifyFareCategory({ bookingClass: rbd });
    assert.equal(r.category, 'other', `RBD ${rbd} must not be guessed`);
  }
});

test('a real booking: Vueling RBD W on an economy fare is not called premium', () => {
  // FMGJCRCA — bookingClass W, provider cabin Y. The cabin must win.
  const r = classifyFareCategory({ cabinClass: 'economy', bookingClass: 'W', fareFamily: 'FLY GRANDE' });
  assert.equal(r.category, 'economy');
  assert.equal(r.method, 'provider_cabin');
});

// ── Priority 4: fare basis ───────────────────────────────────────────────────

test('fare basis classifies off its leading RBD letter when codes agree', () => {
  const r = classifyFareCategory({ fareBasisCodes: ['JL7XLGY1', 'JN2XLGY1'] });
  assert.equal(r.category, 'business');
  assert.equal(r.method, 'fare_basis');
});

test('disagreeing fare basis codes fall through rather than pick one', () => {
  const r = classifyFareCategory({ fareBasisCodes: ['JL7X', 'QL7X'] });
  assert.notEqual(r.method, 'fare_basis');
});

// ── Priority 6: name inference, deliberately narrow ──────────────────────────

test('compound brands that name a cabin are inferred', () => {
  assert.equal(classifyFareCategory({ fareFamily: 'Business Flex' }).category, 'business');
  assert.equal(classifyFareCategory({ fareFamily: 'First Saver' }).category, 'first');
  assert.equal(classifyFareCategory({ fareFamily: 'Economy Light' }).category, 'economy');
  assert.equal(classifyFareCategory({ fareFamily: 'EXECUTIVE' }).category, 'business');
});

test('generic brands are NEVER inferred — they exist in every cabin', () => {
  for (const name of ['Flex', 'Classic', 'Saver', 'Value', 'Standard', 'Plus', 'BASIC', 'ECO VALUE', 'FLY GRANDE']) {
    const r = classifyFareCategory({ fareFamily: name });
    assert.equal(r.category, 'other', `"${name}" must not be inferred into a cabin`);
  }
});

test('"Premium Economy Flex" lands in Premium Economy, not Economy', () => {
  const r = classifyFareCategory({ fareFamily: 'Premium Economy Flex' });
  assert.equal(r.category, 'premium_economy');
  assert.equal(r.method, 'name_inference');
});

// ── The governing invariant ──────────────────────────────────────────────────

test('every offer gets exactly one category — nothing is ever dropped', () => {
  const offers = [
    {}, { cabinClass: '' }, { fareFamily: '' }, { bookingClass: '' },
    { cabinClass: 'Z9' }, { fareFamily: 'Wholly Unknown Brand' },
    { bookingClass: 'W' }, { segmentCabinCodes: [] }, { fareBasisCodes: [null, undefined] },
    { cabinClass: null, fareFamily: null, bookingClass: null },
  ];
  for (const o of offers) {
    const r = classifyFareCategory(o as any);
    assert.ok(FARE_CATEGORY_ORDER.includes(r.category), `${JSON.stringify(o)} → ${r.category}`);
  }
});

test('classification never throws, whatever it is handed', () => {
  const hostile = [
    undefined, null, 0, 'string', [],
    { cabinClass: 123 }, { fareFamily: {} }, { segmentCabinCodes: 'not-an-array' },
    { fareBasisCodes: [{}] }, { bookingClass: ['Y'] },
  ];
  for (const input of hostile) {
    assert.doesNotThrow(() => classifyFareCategory(input as any), `${JSON.stringify(input)}`);
  }
});

// ── Diagnostics ──────────────────────────────────────────────────────────────

test('diagnostics count every offer and report zero discarded', () => {
  const d = emptyDiagnostics();
  const offers = [
    { cabinClass: 'economy' }, { cabinClass: 'business' }, { cabinClass: 'first' },
    { cabinClass: 'premium_economy' },
    { bookingClass: 'J' }, { fareFamily: 'Mystery' }, { segmentCabinCodes: ['Y', 'C'] },
  ];
  for (const o of offers) recordClassification(d, classifyFareCategory(o));

  assert.equal(d.totalOffers, offers.length);
  const summed = Object.values(d.byCategory).reduce((a, b) => a + b, 0);
  assert.equal(summed, offers.length, 'every offer lands in exactly one category');
  assert.equal(d.discarded, 0);
  assert.match(formatDiagnostics(d), /offers=7/);
  assert.match(formatDiagnostics(d), /discarded=0/);
});
