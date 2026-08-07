/**
 * Run: cd backend && npx tsx src/lib/refund-status.test.ts
 *
 * This decides whether a support ticket says a customer is owed money. Getting
 * it wrong in either direction is expensive: a false "owed" sends staff to
 * refund a card that was already refunded, and a false "refunded" leaves someone
 * out of pocket with nothing on any screen saying so.
 *
 * The case these exist for is REFUND_PENDING, which meant two opposite things.
 * Stripe accepting a refund that has not settled is money in flight — watch it.
 * A refund call that failed is money still in our account — act on it. Four
 * screens classified this independently and the confirm route called both of
 * them "MANUAL REFUND REQUIRED (auto-refund failed: unknown)", which filled the
 * work queue with refunds that were fine.
 */
import assert from 'node:assert';
import { classifyRefund, needsAttention, refundQueue, refundLabel } from './refund-status';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const PI = 'pi_3U1dvRLc1QCRMY5l34ZsxYQU';   // FM78J1NG's real intent

console.log('refund classification');

// ── The card was never charged ──────────────────────────────────────────────

test('no payment intent means not charged, whatever the refund fields say', () => {
  // The booking failed before capture. There is no money to chase, and telling
  // staff it is "not refunded" sends them to phone a customer who was never
  // billed.
  assert.equal(classifyRefund({ stripePaymentIntentId: null }), 'NOT_CHARGED');
  assert.equal(classifyRefund({ stripePaymentIntentId: '', refundStatus: 'REFUND_PENDING' }), 'NOT_CHARGED');
});

test('not charged needs nobody and belongs in no queue', () => {
  assert.equal(needsAttention('NOT_CHARGED'), false);
  assert.equal(refundQueue('NOT_CHARGED'), null);
});

// ── Settled ─────────────────────────────────────────────────────────────────

test('an issued refund is done', () => {
  assert.equal(classifyRefund({ stripePaymentIntentId: PI, refundStatus: 'REFUND_ISSUED', refundId: 're_1' }), 'REFUNDED');
});

test('ALREADY_REFUNDED is the same state, not a separate one', () => {
  // The backend returns it when Stripe already held a refund for the intent.
  // Treating it as unknown would re-queue a refund that has already happened.
  assert.equal(classifyRefund({ stripePaymentIntentId: PI, refundStatus: 'ALREADY_REFUNDED', refundId: 're_1' }), 'REFUNDED');
});

test('refunded needs nobody and clears the queue', () => {
  assert.equal(needsAttention('REFUNDED'), false);
  assert.equal(refundQueue('REFUNDED'), null);
});

// ── The one that was wrong: PENDING is two states ───────────────────────────

test('pending WITH a refund id is in flight, not owed', () => {
  // Stripe took it. Nothing for a human to do but watch.
  assert.equal(
    classifyRefund({ stripePaymentIntentId: PI, refundStatus: 'REFUND_PENDING', refundId: 're_1' }),
    'IN_FLIGHT');
});

test('pending WITHOUT a refund id is owed — the call never landed', () => {
  assert.equal(
    classifyRefund({ stripePaymentIntentId: PI, refundStatus: 'REFUND_PENDING', refundId: null }),
    'OWED');
});

test('a refund id does not outrank a recorded failure', () => {
  // A refund can fail AFTER Stripe accepts it. The id is still there, so id
  // alone cannot mean "fine" — the reason has to win.
  assert.equal(
    classifyRefund({
      stripePaymentIntentId: PI, refundStatus: 'REFUND_PENDING',
      refundId: 're_1', refundFailureReason: 'charge_already_refunded',
    }),
    'OWED');
});

test('in flight and owed go to DIFFERENT queues', () => {
  // Merging them is what made the work queue untrustworthy: a queue that is
  // mostly false alarms stops being read, and then the real ones are missed.
  assert.equal(refundQueue('IN_FLIGHT'), 'REFUND_MONITORING');
  assert.equal(refundQueue('OWED'), 'MANUAL_REFUND_REQUIRED');
  assert.notEqual(refundQueue('IN_FLIGHT'), refundQueue('OWED'));
});

test('both still need attention — in flight is watched, not ignored', () => {
  assert.equal(needsAttention('IN_FLIGHT'), true);
  assert.equal(needsAttention('OWED'), true);
});

// ── Money with no plan ──────────────────────────────────────────────────────

test('charged with no refund status recorded is unresolved, not fine', () => {
  // This is the FM78J1NG shape: captured, booking dead, nothing claiming a
  // refund. Defaulting it to "no action" is how $537 sits unnoticed.
  assert.equal(classifyRefund({ stripePaymentIntentId: PI, refundStatus: null }), 'UNRESOLVED');
  assert.equal(classifyRefund({ stripePaymentIntentId: PI }), 'UNRESOLVED');
});

test('an unrecognised status is unresolved rather than assumed settled', () => {
  assert.equal(classifyRefund({ stripePaymentIntentId: PI, refundStatus: 'SOMETHING_NEW' }), 'UNRESOLVED');
});

test('unresolved is queued for a human', () => {
  assert.equal(needsAttention('UNRESOLVED'), true);
  assert.equal(refundQueue('UNRESOLVED'), 'MANUAL_REFUND_REQUIRED');
});

test('REFUND_FAILED is owed', () => {
  assert.equal(classifyRefund({ stripePaymentIntentId: PI, refundStatus: 'REFUND_FAILED' }), 'OWED');
});

// ── Deliberately kept ───────────────────────────────────────────────────────

test('NOT_APPLICABLE means charged and correctly kept', () => {
  const s = classifyRefund({ stripePaymentIntentId: PI, refundStatus: 'NOT_APPLICABLE' });
  assert.equal(s, 'NOT_APPLICABLE');
  assert.equal(needsAttention(s), false);
  assert.equal(refundLabel(s), null);   // no badge — there is nothing to report
});

// ── Robustness ──────────────────────────────────────────────────────────────

test('a missing audit is unresolved, never silently clean', () => {
  assert.equal(classifyRefund(null), 'UNRESOLVED');
  assert.equal(classifyRefund(undefined), 'UNRESOLVED');
});

test('every state that needs attention has a label to show', () => {
  for (const s of ['REFUNDED', 'IN_FLIGHT', 'OWED', 'UNRESOLVED', 'NOT_CHARGED'] as const) {
    assert.ok(refundLabel(s), `${s} has no label`);
  }
});

console.log(`\n${passed} passed`);
