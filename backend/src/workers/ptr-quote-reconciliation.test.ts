/**
 * Run: cd backend && npx tsx --test src/workers/ptr-quote-reconciliation.test.ts
 *
 * The extractor is the part that decides whether a polled quote is written as an
 * amount or left alone. Getting "no rows" wrong in the permissive direction
 * would write 0 onto a refundable ticket — the exact defect this whole area was
 * fixed for — so the empty cases matter more than the populated ones.
 */
import assert from 'node:assert';
import { extractQuoteRows, ptrIdFromStoredResponse } from './ptr-quote-reconciliation';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const ROW = { TotalRefundAmount: '137.55', TotalRefundCharges: '36.32', Currency: 'USD' };

console.log('finding the priced rows');

test('rows under Data', () => {
  assert.deepEqual(extractQuoteRows({ Data: { RefundQuotes: [ROW] } }), [ROW]);
});

test('rows at the root', () => {
  assert.deepEqual(extractQuoteRows({ RefundQuotes: [ROW] }), [ROW]);
});

test('rows nested inside a PTRDetail entry', () => {
  assert.deepEqual(extractQuoteRows({ Data: { PTRDetail: [{ RefundQuotes: [ROW] }] } }), [ROW]);
});

test('void rows are found the same way', () => {
  const v = { TotalRefundAmount: '215.00', TotalVoidingFee: '0', Currency: 'USD' };
  assert.deepEqual(extractQuoteRows({ Data: { VoidQuotes: [v] } }), [v]);
});

test('lower-cased keys are tolerated', () => {
  assert.deepEqual(extractQuoteRows({ Data: { refundQuotes: [ROW] } }), [ROW]);
});

console.log('\nnothing to read means nothing is written');

test('an unpriced PTR yields no rows', () => {
  // The FM25OCTM shape: answered list entry, no quote array anywhere.
  const unpriced = { Data: { PTRDetail: [{ PTRId: 22897, PTRStatus: 'InProcess', Resolution: 'QuoteRequested' }] } };
  assert.deepEqual(extractQuoteRows(unpriced), []);
});

test('an empty array is not treated as an answer', () => {
  assert.deepEqual(extractQuoteRows({ Data: { RefundQuotes: [] } }), []);
});

test('junk shapes yield no rows rather than throwing', () => {
  for (const v of [null, undefined, {}, { Data: null }, { Data: { RefundQuotes: null } }, 'nope', 42]) {
    assert.deepEqual(extractQuoteRows(v as any), [], `${JSON.stringify(v)}`);
  }
});

test('a populated array wins over an empty one earlier in the search order', () => {
  const res = { Data: { RefundQuotes: [] }, RefundQuotes: [ROW] };
  assert.deepEqual(extractQuoteRows(res), [ROW]);
});

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES ABOVE' : ''}`);
