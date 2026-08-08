/**
 * Run: cd backend && npx tsx src/lib/notify-coverage.test.ts
 *
 * Every money movement must reach someone.
 *
 * An event type can exist, have templates written for it, and still notify
 * nobody — the routing sets decide who actually gets an email, and a new event
 * missing from them fails completely silently. That is exactly what happened to
 * refunds, voids, reissues and commission payouts: money moved and no email was
 * ever sent, and nothing in the code looked wrong.
 *
 * These assert the templates AND the routing, because either one missing means
 * the same thing to the person waiting to be told.
 */
import assert from 'node:assert';
import { buildCustomerEmail, buildSupportEmail, buildAgentEmail } from './notify';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const DATA = {
  booking_reference: 'FM4OW3RM',
  customer_name: 'Rishi Parihar',
  route: 'DEL → YYZ',
  refund_amount: 'USD 934.00',
  refund_reference: 're_abc123',
  new_route: 'DEL → JFK',
  fare_difference: 'USD 120.00',
  paid_amount: '$420.00',
  system_amount: '$520.00',
  period: 'March 2026',
  reason: 'Disputed booking under review',
  decided_by: 'admin@faremind.ai',
  agent_name: 'Munish Parihar',
  entry_count: 7,
};

/** The money events. Each names who must hear about it. */
const MONEY_EVENTS = [
  { event: 'REFUND_ISSUED',      customer: true,  agent: true,  support: true },
  { event: 'BOOKING_VOIDED',     customer: true,  agent: true,  support: true },
  { event: 'REISSUE_COMPLETED',  customer: true,  agent: true,  support: true },
  // Commission is between FareMind and the agent — no customer copy.
  { event: 'COMMISSION_PAID',     customer: false, agent: true,  support: true },
  { event: 'COMMISSION_WITHHELD', customer: false, agent: true,  support: true },
];

console.log('notification coverage');

for (const { event, customer, agent, support } of MONEY_EVENTS) {
  if (customer) {
    test(`${event} — customer email exists`, () => {
      const spec = buildCustomerEmail(event, DATA);
      assert.ok(spec, `no customer template for ${event}`);
      assert.ok(spec!.subject.trim().length > 0, 'empty subject');
      assert.ok(spec!.html.includes('<'), 'empty html');
      assert.ok(spec!.text.trim().length > 0, 'empty text fallback');
    });
  }
  if (agent) {
    test(`${event} — agent email exists`, () => {
      const spec = buildAgentEmail(event, DATA, 'Munish');
      assert.ok(spec, `no agent template for ${event}`);
      assert.ok(spec!.subject.trim().length > 0, 'empty subject');
    });
  }
  if (support) {
    test(`${event} — support/admin email exists`, () => {
      const spec = buildSupportEmail(event, DATA);
      assert.ok(spec, `no support template for ${event}`);
      assert.ok(spec!.subject.trim().length > 0, 'empty subject');
    });
  }
}

// ── The details that make these emails answer their own question ────────────

test('a refund email leads with the amount', () => {
  // "Your refund has been processed" without the number makes the customer go
  // and check their bank, which is what the email was meant to save them.
  const spec = buildCustomerEmail('REFUND_ISSUED', DATA)!;
  assert.match(spec.subject + spec.html, /934\.00/);
});

test('a reissue email names the NEW flights', () => {
  // Telling someone their booking changed without saying what to is worse than
  // silence — they now know to worry and not what to do.
  const spec = buildCustomerEmail('REISSUE_COMPLETED', DATA)!;
  assert.match(spec.html, /DEL → JFK/);
});

test('an adjusted commission payout says what it was adjusted FROM', () => {
  const spec = buildAgentEmail('COMMISSION_PAID', DATA, 'Munish')!;
  assert.match(spec.html, /420\.00/);
  assert.match(spec.html, /520\.00/);   // the calculated figure
  assert.match(spec.html, /Disputed booking under review/);
});

test('a withheld payout says the money is still owed', () => {
  // Otherwise "withheld" reads as "forfeited" and the agent escalates.
  const spec = buildAgentEmail('COMMISSION_WITHHELD', DATA, 'Munish')!;
  assert.match(spec.html, /remains owed/i);
  assert.match(spec.html, /Disputed booking under review/);
});

test('staff copies carry the provider reference, customer copies do not', () => {
  // Support is asked "the customer cannot see their refund" and the answer
  // starts with the provider reference the customer has never had.
  const withRef = { ...DATA, mystifly_ref: 'MF35594526' };
  assert.match(buildSupportEmail('REFUND_ISSUED', withRef)!.html, /MF35594526/);
  assert.doesNotMatch(buildCustomerEmail('REFUND_ISSUED', withRef)!.html, /MF35594526/);
});

test('a refund with no booking reference still produces an email', () => {
  // A booking that died before persisting has no reference, and that customer
  // is exactly the one owed an explanation.
  const spec = buildCustomerEmail('REFUND_ISSUED', { refund_amount: 'USD 537.00', customer_name: 'Gaurang' });
  assert.ok(spec);
  assert.match(spec!.html, /537\.00/);
});

console.log(`\n${passed} passed`);
