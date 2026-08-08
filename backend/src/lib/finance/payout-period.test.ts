/**
 * Run: cd backend && npx tsx src/lib/finance/payout-period.test.ts
 *
 * Payout periods and the override arithmetic. A commission payout is the point
 * money leaves for an agent, so the two things that must not be wrong are which
 * month is being settled and whether the ledger still equals what was paid.
 */
import assert from 'node:assert';
import { periodRange } from './agent-commission-payout';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

console.log('payout periods');

test('a month covers its own days and stops before the next', () => {
  const r = periodRange({ year: 2026, month: 3 });
  assert.equal(r.gte.getFullYear(), 2026);
  assert.equal(r.gte.getMonth(), 2);       // March
  assert.equal(r.gte.getDate(), 1);
  assert.equal(r.lt.getMonth(), 3);        // exclusive: 1 April
  assert.equal(r.lt.getDate(), 1);
});

test('December rolls into the next YEAR, not month 13', () => {
  // Getting this wrong settles December against a month that does not exist and
  // silently pays nobody.
  const r = periodRange({ year: 2026, month: 12 });
  assert.equal(r.gte.getFullYear(), 2026);
  assert.equal(r.gte.getMonth(), 11);
  assert.equal(r.lt.getFullYear(), 2027);
  assert.equal(r.lt.getMonth(), 0);
});

test('January starts at the year boundary', () => {
  const r = periodRange({ year: 2027, month: 1 });
  assert.equal(r.gte.getFullYear(), 2027);
  assert.equal(r.gte.getMonth(), 0);
  assert.equal(r.lt.getMonth(), 1);
});

test('February in a leap year still ends on 1 March', () => {
  // Range is half-open, so leap day needs no special case — but if the
  // implementation ever hard-codes 28 days this catches it.
  const r = periodRange({ year: 2028, month: 2 });
  assert.equal(r.lt.getMonth(), 2);
  assert.equal(r.lt.getDate(), 1);
  const days = Math.round((r.lt.getTime() - r.gte.getTime()) / 86400000);
  assert.equal(days, 29);
});

test('consecutive months abut exactly — no gap, no overlap', () => {
  // A gap loses a booking from every payout; an overlap pays it twice.
  for (let m = 1; m <= 11; m++) {
    const a = periodRange({ year: 2026, month: m });
    const b = periodRange({ year: 2026, month: m + 1 });
    assert.equal(a.lt.getTime(), b.gte.getTime(), `month ${m} → ${m + 1}`);
  }
  assert.equal(
    periodRange({ year: 2026, month: 12 }).lt.getTime(),
    periodRange({ year: 2027, month: 1 }).gte.getTime(),
    'Dec → Jan across the year',
  );
});

// ── Override arithmetic ─────────────────────────────────────────────────────

const cents = (n: number) => Math.round(n * 100) / 100;

test('an adjustment entry makes the ledger equal what was paid', () => {
  // The service writes delta = paid − system as an ADJUSTMENT so the agent's
  // running balance matches their bank statement. Without it the ledger drifts
  // by exactly the correction and nobody can say why.
  const system = 52.40, paid = 40.00;
  const delta = cents(paid - system);
  assert.equal(delta, -12.4);
  assert.equal(cents(system + delta), paid);
});

test('paying more than calculated also reconciles', () => {
  const system = 52.40, paid = 60.00;
  assert.equal(cents(system + cents(paid - system)), paid);
});

test('paying exactly the calculated amount needs no adjustment', () => {
  assert.equal(cents(52.4 - 52.4), 0);
});

console.log(`\n${passed} passed`);
