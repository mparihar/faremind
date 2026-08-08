/**
 * Run: cd backend && npx tsx src/lib/finance/finance-math.test.ts
 *
 * The Finance page called the entire customer charge "Total Revenue". On a
 * $2,146 booking where $2,096 goes to the airline and $50 is our service fee,
 * that overstates earnings by a factor of forty. These assert the distinction
 * that fix depends on: money that MOVED THROUGH us is not money we EARNED.
 */
import assert from 'node:assert';
import {
  totalsFor, emptyTotals, agentCommissionFor, percentChange, refundRate,
} from './finance-math';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

/** A real one: FM4OW3RM, $2,146 of which the airline takes nearly all. */
const TICKET = {
  totalAmount: 2146, providerPayableTotal: 2096, serviceFeeAmount: 50,
};

console.log('finance math');

// ── The error this exists to prevent ────────────────────────────────────────

test('the airline fare is NOT revenue', () => {
  const t = totalsFor([TICKET]);
  assert.equal(t.grossBookingValue, 2146);      // volume
  assert.equal(t.fareMindGrossRevenue, 50);     // earnings
  assert.notEqual(t.fareMindGrossRevenue, t.grossBookingValue);
});

test('provider cost is reported, but never subtracted from earnings', () => {
  // Deducting it from revenue would be the same error inverted: the fare was
  // never ours to lose.
  const t = totalsFor([TICKET]);
  assert.equal(t.providerCost, 2096);
  assert.equal(t.fareMindNetRevenue, 50);
});

test('a big month of cheap fares is not a big revenue month', () => {
  const t = totalsFor(Array.from({ length: 100 }, () => TICKET));
  assert.equal(t.grossBookingValue, 214600);
  assert.equal(t.fareMindGrossRevenue, 5000);
});

// ── Volume ladder ───────────────────────────────────────────────────────────

test('net booking value is gross minus refunds', () => {
  const t = totalsFor([{ ...TICKET, refundAmount: 146 }]);
  assert.equal(t.grossBookingValue, 2146);
  assert.equal(t.refunds, 146);
  assert.equal(t.netBookingValue, 2000);
});

test('a refund does not erase the earnings ladder', () => {
  // Volume falls; what we earned is a separate question the caller answers by
  // recording a FareMind-funded refund, not by netting the fare off.
  const t = totalsFor([{ ...TICKET, refundAmount: 2146 }]);
  assert.equal(t.netBookingValue, 0);
  assert.equal(t.fareMindGrossRevenue, 50);
});

test('average booking value divides by bookings, not by revenue', () => {
  const t = totalsFor([TICKET, { totalAmount: 854, serviceFeeAmount: 10 }]);
  assert.equal(t.bookings, 2);
  assert.equal(t.averageBookingValue, 1500);
});

// ── Earnings ladder ─────────────────────────────────────────────────────────

test('every FareMind earning stream adds to gross revenue', () => {
  const t = totalsFor([{
    totalAmount: 1000, providerPayableTotal: 800,
    serviceFeeAmount: 20, markupAmount: 30, seatServiceTotal: 40,
    travelInsuranceAmount: 50, thirdPartyPayableTotal: 35,
  }]);
  assert.equal(t.serviceFeeRevenue, 20);
  assert.equal(t.markupRevenue, 30);
  assert.equal(t.ancillaryRevenue, 40);
  assert.equal(t.insuranceCommission, 15);   // 50 collected − 35 owed onward
  assert.equal(t.fareMindGrossRevenue, 105);
});

test('an insurance premium is not revenue — only the spread is', () => {
  // Counting the whole premium books the underwriter's money as ours.
  const t = totalsFor([{ travelInsuranceAmount: 40, thirdPartyPayableTotal: 30 }]);
  assert.equal(t.insuranceCommission, 10);
});

test('owing more onward than collected does not create negative revenue', () => {
  const t = totalsFor([{ travelInsuranceAmount: 30, thirdPartyPayableTotal: 50 }]);
  assert.equal(t.insuranceCommission, 0);
});

test('agent commission is deducted from net, not from gross', () => {
  const t = totalsFor([{ ...TICKET, agentCommissionTotal: 25 }]);
  assert.equal(t.fareMindGrossRevenue, 50);
  assert.equal(t.agentCommission, 25);
  assert.equal(t.fareMindNetRevenue, 25);
});

// ── Not tracked is not zero ─────────────────────────────────────────────────

test('untracked processing cost reports null, never 0', () => {
  // Rendering $0 for a cost we simply never captured claims card processing is
  // free, and overstates net revenue by exactly the amount nobody measured.
  const t = totalsFor([TICKET]);
  assert.equal(t.paymentProcessingCost, null);
  assert.equal(t.fareMindNetRevenue, 50);
});

test('tracked processing cost is subtracted', () => {
  const t = totalsFor([{ ...TICKET, paymentProcessingFee: 3.5 }]);
  assert.equal(t.paymentProcessingCost, 3.5);
  assert.equal(t.fareMindNetRevenue, 46.5);
});

test('a partially-tracked set only subtracts what it knows', () => {
  const t = totalsFor([{ ...TICKET, paymentProcessingFee: 2 }, TICKET]);
  assert.equal(t.paymentProcessingCost, 2);
  assert.equal(t.fareMindGrossRevenue, 100);
  assert.equal(t.fareMindNetRevenue, 98);
});

// ── Agent commission ────────────────────────────────────────────────────────

const RATES = { serviceFeeRate: 50, ancillaryRate: 50 };

test('the worked example from the spec', () => {
  // $20 service fee at 50% → agent $10, FareMind keeps $10.
  const c = agentCommissionFor({ serviceFeeAmount: 20 }, RATES);
  assert.equal(c.serviceFeeCommission, 10);
  assert.equal(c.total, 10);
  const t = totalsFor([{ serviceFeeAmount: 20, agentCommissionTotal: c.total }]);
  assert.equal(t.fareMindNetRevenue, 10);
});

test('ancillary commission splits the ancillary earning, not the premium', () => {
  // $30 of ancillary commission at 50% → agent $15.
  const c = agentCommissionFor(
    { travelInsuranceAmount: 100, thirdPartyPayableTotal: 70 }, RATES);
  assert.equal(c.ancillaryCommission, 15);
});

test('commission never comes out of the airline fare', () => {
  const c = agentCommissionFor({ serviceFeeAmount: 0 }, RATES);
  assert.equal(c.total, 0);
});

test('the rates applied are returned so the amount can be explained later', () => {
  const c = agentCommissionFor({ serviceFeeAmount: 20 }, { serviceFeeRate: 40, ancillaryRate: 60 });
  assert.equal(c.serviceFeeRate, 40);
  assert.equal(c.ancillaryRate, 60);
  assert.equal(c.serviceFeeCommission, 8);
});

test('a nonsense rate is clamped rather than paying out more than we earned', () => {
  assert.equal(agentCommissionFor({ serviceFeeAmount: 20 }, { serviceFeeRate: 250, ancillaryRate: 0 }).total, 20);
  assert.equal(agentCommissionFor({ serviceFeeAmount: 20 }, { serviceFeeRate: -50, ancillaryRate: 0 }).total, 0);
  assert.equal(agentCommissionFor({ serviceFeeAmount: 20 }, { serviceFeeRate: NaN, ancillaryRate: 0 }).total, 0);
});

test('rounding lands on cents, both parts and total', () => {
  const c = agentCommissionFor({ serviceFeeAmount: 33.33 }, { serviceFeeRate: 50, ancillaryRate: 0 });
  assert.equal(c.serviceFeeCommission, 16.67);
  assert.equal(c.total, 16.67);
});

// ── Month over month ────────────────────────────────────────────────────────

test('an ordinary increase', () => {
  assert.equal(percentChange(9100, 8200), 11);
});

test('a first month reports null, not +100% and not infinity', () => {
  // A percentage against zero invents a trend from a single data point.
  assert.equal(percentChange(5000, 0), null);
  assert.equal(percentChange(0, 0), null);
});

test('a decrease is negative', () => {
  assert.equal(percentChange(8000, 10000), -20);
});

test('a recovery from a negative month is signed sensibly', () => {
  assert.equal(percentChange(500, -500), 200);
});

test('non-finite input yields null rather than NaN on a card', () => {
  assert.equal(percentChange(NaN, 100), null);
  assert.equal(percentChange(100, Infinity), null);
});

// ── Refund rate ─────────────────────────────────────────────────────────────

test('refund rate is bookings, not amounts', () => {
  assert.equal(refundRate(3, 40), 7.5);
});

test('no bookings is 0%, not a division by zero', () => {
  assert.equal(refundRate(0, 0), 0);
});

// ── Empty and malformed ─────────────────────────────────────────────────────

test('an empty month is all zeroes, so the cards still render', () => {
  const t = emptyTotals();
  assert.equal(t.grossBookingValue, 0);
  assert.equal(t.fareMindNetRevenue, 0);
  assert.equal(t.bookings, 0);
  assert.equal(t.averageBookingValue, 0);
  assert.equal(t.paymentProcessingCost, null);
});

test('nulls and strings from Prisma Decimal do not produce NaN', () => {
  const t = totalsFor([
    { totalAmount: null, serviceFeeAmount: undefined },
    { totalAmount: '1000' as any, serviceFeeAmount: '25.50' as any },
  ]);
  assert.equal(t.grossBookingValue, 1000);
  assert.equal(t.fareMindGrossRevenue, 25.5);
  assert.ok(!Number.isNaN(t.fareMindNetRevenue));
});

test('floating point does not leak into a reported figure', () => {
  const t = totalsFor([{ serviceFeeAmount: 0.1 }, { serviceFeeAmount: 0.2 }]);
  assert.equal(t.fareMindGrossRevenue, 0.3);
});

console.log(`\n${passed} passed`);
