/**
 * Run: cd backend && npx tsx src/lib/ptr-refund-ref.test.ts
 *
 * This reference is the only thread from a submitted void/refund back to the
 * Search/PostTicketingRequest call that confirms the airline actually did it.
 * If it does not round-trip, the poll runs with ptrId 0, finds nothing, and the
 * booking sits "refunded" on our side and unconfirmed on theirs — silently,
 * because a mis-parse looks exactly like a PTR that has not settled yet.
 */
import assert from 'node:assert';
import { buildPtrRefundRef, parsePtrRefundRef } from './ptr-refund-ref';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

console.log('ptr refund reference');

// ── Round trip: what the writer emits, the reader must recover ──────────────

test('a void round-trips', () => {
  const ref = buildPtrRefundRef('VOID', 'MF35566326', 12345)!;
  assert.equal(ref, 'mystifly_void_MF35566326_12345');
  const p = parsePtrRefundRef(ref, 'MF35566326');
  assert.equal(p.ptrType, 'Void');
  assert.equal(p.ptrId, 12345);
  assert.equal(p.mfRef, 'MF35566326');
});

test('a refund round-trips', () => {
  const ref = buildPtrRefundRef('REFUND', 'MF35472726', 98765)!;
  assert.equal(ref, 'mystifly_refund_MF35472726_98765');
  const p = parsePtrRefundRef(ref, 'MF35472726');
  assert.equal(p.ptrType, 'Refund');
  assert.equal(p.ptrId, 98765);
});

test('an MF ref ending in digits does not swallow the PTR id', () => {
  // "MF35566326" is all digits after the prefix; an unanchored match would
  // return 35566326 and poll a PTR that does not exist.
  const p = parsePtrRefundRef(buildPtrRefundRef('VOID', 'MF35566326', 7)!, null);
  assert.equal(p.ptrId, 7);
  assert.equal(p.mfRef, 'MF35566326');
});

test('the MF ref is recoverable without the fallback column', () => {
  const p = parsePtrRefundRef('mystifly_refund_MF35566326_42', null);
  assert.equal(p.mfRef, 'MF35566326');
  assert.equal(p.ptrId, 42);
});

test('providerPnr wins over the encoded ref when both are present', () => {
  const p = parsePtrRefundRef('mystifly_void_STALE_9', 'MF35566326');
  assert.equal(p.mfRef, 'MF35566326');
});

// ── No PTR to chase ─────────────────────────────────────────────────────────

test('a missing or zero PTR id builds nothing', () => {
  assert.equal(buildPtrRefundRef('VOID', 'MF1', null), null);
  assert.equal(buildPtrRefundRef('VOID', 'MF1', undefined), null);
  assert.equal(buildPtrRefundRef('VOID', 'MF1', 0), null);
  assert.equal(buildPtrRefundRef('VOID', 'MF1', -3), null);
});

test('a missing MF ref builds nothing', () => {
  assert.equal(buildPtrRefundRef('VOID', '', 5), null);
});

// ── Legacy shapes still in the wild ─────────────────────────────────────────

test('an unticketed void has no PTR id and must not be polled', () => {
  const p = parsePtrRefundRef('mystifly_void_unticketed_MF35566326', null);
  assert.equal(p.ptrId, null);
  assert.equal(p.mfRef, 'MF35566326');
});

test('a no-refund cancellation has no PTR id either', () => {
  const p = parsePtrRefundRef('mystifly_cancel_norefund_MF35566326', null);
  assert.equal(p.ptrId, null);
  assert.equal(p.mfRef, 'MF35566326');
});

test('type defaults to Void rather than guessing Refund', () => {
  // Refunds are the only ones that carry _refund_. Getting this backwards would
  // query the wrong PTR type and report "no PTR found" forever.
  assert.equal(parsePtrRefundRef('mystifly_void_MF1_1').ptrType, 'Void');
  assert.equal(parsePtrRefundRef('garbage').ptrType, 'Void');
  assert.equal(parsePtrRefundRef('mystifly_refund_MF1_1').ptrType, 'Refund');
});

test('garbage does not throw', () => {
  const p = parsePtrRefundRef('', null);
  assert.equal(p.ptrId, null);
});

console.log(`\n${passed} passed`);
