/**
 * Run: npx tsx src/store/__tests__/ai-pricing-paxcount.test.ts
 *
 * The AI booking bot charged a family of three 3x the fare: a $2,053 Air Canada
 * round trip was summarised as "$6,159 (3 pax)".
 *
 * Provider fares are priced for the WHOLE party — Mystifly returns one total for
 * a 3-passenger search — and our normalizers carry that through unchanged. The
 * page checkout flow reads it that way (buildLocalPricing:
 * `allPaxFareTotal = selectedFare.totalPrice`). The AI store multiplied it by
 * the passenger count, which is why only the bot was wrong.
 */
import assert from 'node:assert';
import { computePriceSummary } from '../useAiBookingStore';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

/** The Air Canada fare from the report: $2,053 for the whole party. */
const fareDetails: any = {
  fareClass: 'standard',
  name: 'Economy Fare 1',
  basePrice: 684,
  totalPrice: 2053,          // ALL passengers, as the provider priced it
  providerBaseFare: 575,
  providerTaxAmount: 1478,
  currency: 'USD',
  carryOnPieces: 1,
  checkedBags: 1,
};

const noAddOns: any = { extraBags: 0, travelInsurance: false };

console.log('AI booking price summary');

test('a 3-passenger party is not charged 3x the fare', () => {
  const s = computePriceSummary(fareDetails, 3, [], 0, noAddOns, [], null, null);
  assert.notEqual(s.baseFare + s.taxes, 2053 * 3, 'the 3x bug');
  assert.equal(s.baseFare + s.taxes, 2053, 'fare is the provider total, unmultiplied');
});

test('the fare is identical however many passengers are on it', () => {
  const one = computePriceSummary(fareDetails, 1, [], 0, noAddOns, [], null, null);
  const three = computePriceSummary(fareDetails, 3, [], 0, noAddOns, [], null, null);
  assert.equal(one.baseFare + one.taxes, three.baseFare + three.taxes,
    'the provider already priced every passenger into this total');
});

test('the base/tax split is the provider\'s, not a derived one', () => {
  const s = computePriceSummary(fareDetails, 3, [], 0, noAddOns, [], null, null);
  assert.equal(s.baseFare, 575);
  assert.equal(s.taxes, 1478);
});

test('the service fee still scales with passengers', () => {
  // $10 per traveller, as the DB rule states.
  const fees: any = { serviceFee: 30, protectionFee: 0, insuranceFeeTotal: 0 };
  const s = computePriceSummary(fareDetails, 3, [], 0, noAddOns, [], fees, null);
  assert.equal(s.serviceFee, 30, 'a per-traveller fee must still be per traveller');
  assert.equal(s.total, 2053 + 30, 'fare + service fee');
});

test('protection is charged per selected passenger, not on the group total', () => {
  const protections = [{ selected: true }, { selected: true }, { selected: false }] as any;
  const s = computePriceSummary(fareDetails, 3, protections, 50, noAddOns, [], null, null);
  assert.equal(s.protectionFee, 100, 'two passengers protected at $50 each');
});

test('a single traveller is unaffected', () => {
  const s = computePriceSummary(fareDetails, 1, [], 0, noAddOns, [], null, null);
  assert.equal(s.baseFare + s.taxes, 2053);
});

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES ABOVE' : ''}`);
