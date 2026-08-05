/**
 * Run: cd backend && npx tsx src/lib/ptr-in-process.test.ts
 *
 * Recovery from FME4N3CL: Mystifly 500'd while creating PTR 22981, returned no
 * PTRId, and then refused every retry because that PTR was already open. The id
 * only ever appears in the refusal text, so this parser is the one route back to
 * a quote that otherwise cannot be raised again or reached.
 */
import assert from 'node:assert';
import { ptrIdFromInProcessMessage } from './ptr-in-process';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

console.log('in-process PTR recovery');

test('the exact message from FME4N3CL', () => {
  assert.equal(ptrIdFromInProcessMessage('RefundQuote request PTR 22981 is already in process'), 22981);
});

test('the void wording', () => {
  assert.equal(ptrIdFromInProcessMessage('VoidQuote request PTR 30112 is already in process'), 30112);
});

test('reversed ordering', () => {
  assert.equal(ptrIdFromInProcessMessage('Already in process, see PTR 5150'), 5150);
});

test('case and spacing do not matter', () => {
  assert.equal(ptrIdFromInProcessMessage('ptr   22981 IS ALREADY IN PROCESS'), 22981);
});

test('a different provider error yields nothing', () => {
  // Must stay null: adopting on the wrong message would mark a genuine failure
  // as a healthy pending quote and hide it from staff.
  assert.equal(ptrIdFromInProcessMessage('The remote server returned an error: (500) Internal Server Error.'), null);
  assert.equal(ptrIdFromInProcessMessage('Ticket is not eligible for refund'), null);
  assert.equal(ptrIdFromInProcessMessage('Please verify the request'), null);
});

test('a PTR id with no in-process claim yields nothing', () => {
  assert.equal(ptrIdFromInProcessMessage('PTR 22981 was rejected by the airline'), null);
});

test('an id in a different sentence is not borrowed', () => {
  // The sentence boundary keeps an unrelated id out.
  assert.equal(ptrIdFromInProcessMessage('PTR 111 failed. Something else is already in process'), null);
});

test('empty and malformed input', () => {
  assert.equal(ptrIdFromInProcessMessage(''), null);
  assert.equal(ptrIdFromInProcessMessage(null), null);
  assert.equal(ptrIdFromInProcessMessage(undefined), null);
  assert.equal(ptrIdFromInProcessMessage('PTR 0 is already in process'), null);
});

console.log(`\n${passed} passed`);
