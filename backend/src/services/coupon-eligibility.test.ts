/**
 * Run: cd backend && npx tsx --test src/services/coupon-eligibility.test.ts
 *
 * FM25OCTM was a refundable ticket — TripDetails said
 * IsRefundableBeforeDeparture: "Yes", refund charge $36.32 — whose two future HK
 * segments both came back CouponStatus "N/A", Status 0. The old test was
 * /open/i, so "N/A" counted as closed and the console announced "Airline reports
 * 0 of 2 coupons open; NOT valid for REFUND/VOID and REISSUE". The airline had
 * not refused; it had said nothing.
 */
import assert from 'node:assert';
import { couponState, summariseCoupons, couponSummaryLabel } from './coupon-eligibility';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

console.log('coupon state');

test('OPEN in any casing is open', () => {
  assert.equal(couponState('OPEN'), 'open');
  assert.equal(couponState('Open'), 'open');
  assert.equal(couponState('open '), 'open');
});

test('the airline saying nothing is unknown, not closed', () => {
  for (const v of ['N/A', 'n/a', 'NA', '', '   ', null, undefined, '-', 'Unknown', 'None']) {
    assert.equal(couponState(v), 'unknown', `${JSON.stringify(v)} should be unknown`);
  }
});

test('a spent coupon is closed', () => {
  for (const v of ['USED', 'FLOWN', 'EXCHANGED', 'REFUNDED', 'VOID', 'SUSPENDED']) {
    assert.equal(couponState(v), 'closed', `${v} should be closed`);
  }
});

test('an unrecognised named status counts as closed, not waved through', () => {
  // It is still a statement by the airline; treating it as silence would be the
  // permissive direction, and this gate exists to be cautious.
  assert.equal(couponState('SOME_NEW_STATUS'), 'closed');
});

console.log('\nthe FM25OCTM case');

const NA_SEGMENTS = [
  { couponStatus: 'N/A', statusCode: 0 },
  { couponStatus: 'N/A', statusCode: 0 },
];

test('two unreported coupons do not make a ticket ineligible', () => {
  const s = summariseCoupons(NA_SEGMENTS);
  assert.equal(s.unknown, 2);
  assert.equal(s.closed, 0);
  assert.equal(s.open, 0);
  assert.equal(s.unreported, true);
  assert.equal(s.eligible, true, 'silence must not block servicing');
  assert.equal(s.allOpen, false, 'nor may it be claimed as open');
});

test('the label says the airline did not report, not "0 of 2 open"', () => {
  const label = couponSummaryLabel(summariseCoupons(NA_SEGMENTS));
  assert.match(label, /did not report/i);
  assert.doesNotMatch(label, /0 of 2/);
});

console.log('\nreal coupon data still blocks');

test('a genuinely used coupon is ineligible', () => {
  const s = summariseCoupons([{ couponStatus: 'OPEN' }, { couponStatus: 'USED' }]);
  assert.equal(s.closed, 1);
  assert.equal(s.eligible, false);
  assert.match(couponSummaryLabel(s), /no longer open/i);
});

test('all open is eligible and says so', () => {
  const s = summariseCoupons([{ couponStatus: 'OPEN' }, { couponStatus: 'OPEN' }]);
  assert.equal(s.allOpen, true);
  assert.equal(s.eligible, true);
  assert.match(couponSummaryLabel(s), /All 2 coupons are open/);
});

test('a mix of open and unreported is eligible but not claimed as all-open', () => {
  const s = summariseCoupons([{ couponStatus: 'OPEN' }, { couponStatus: 'N/A' }]);
  assert.equal(s.eligible, true);
  assert.equal(s.allOpen, false);
  assert.equal(s.unreported, false);
  assert.match(couponSummaryLabel(s), /1 of 2 coupons are open; 1 not reported/);
});

test('no coupons at all is not a refusal', () => {
  const s = summariseCoupons([]);
  assert.equal(s.eligible, true);
  assert.equal(s.total, 0);
});

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES ABOVE' : ''}`);
