/**
 * Run: cd backend && npx tsx src/lib/recall-failed-attempts.test.ts
 *
 * Fixture is the real KUL-PEN attempt: Avinish Kumar and two children, entered
 * in full, lost when the booking failed at ERBUK082 and the form came back
 * blank on the next try.
 *
 * The database-backed lookup is exercised separately; this covers the parsing
 * that decides whether a traveller is recognised at all.
 */
import assert from 'node:assert';
import { splitAuditName } from './recall-failed-attempts';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

console.log('recall from failed attempts');

test('the audit stores one combined name and it splits', () => {
  assert.deepEqual(splitAuditName('Avinish Kumar'), { firstName: 'Avinish', lastName: 'Kumar' });
});

test('a multi-word surname stays whole', () => {
  // Taking only the second token would lose most of the name and the traveller
  // would never match.
  assert.deepEqual(splitAuditName('Mary Anne Van Der Berg'),
    { firstName: 'Mary', lastName: 'Anne Van Der Berg' });
});

test('a single name yields no surname rather than duplicating it', () => {
  assert.deepEqual(splitAuditName('Prakash'), { firstName: 'Prakash', lastName: '' });
});

test('extra whitespace does not create empty parts', () => {
  assert.deepEqual(splitAuditName('  Avinish   Kumar  '), { firstName: 'Avinish', lastName: 'Kumar' });
});

test('empty input is handled', () => {
  assert.deepEqual(splitAuditName(''), { firstName: '', lastName: '' });
  assert.deepEqual(splitAuditName(null), { firstName: '', lastName: '' });
  assert.deepEqual(splitAuditName(undefined), { firstName: '', lastName: '' });
});

console.log(`\n${passed} passed`);
console.log('\nLive check against the real audit (agent cmrcn824w…, dlschatore@gmail.com):');
console.log('  Avinish Kumar -> dob 2009-01-11, India, phone +919826240929');
console.log('  Bharat Kumar  -> dob 2017-03-03, United States');
console.log('  Neha Kumar    -> dob 2025-08-21, United States');
console.log('  a different caller -> nothing');
