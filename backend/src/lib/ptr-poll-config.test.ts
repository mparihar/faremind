/**
 * Run: cd backend && npx tsx src/lib/ptr-poll-config.test.ts
 *
 * The clamp is the only thing standing between an admin typo and the poller.
 * A `0` would busy-loop the provider; a blank field parses to NaN and must land
 * on the default rather than scheduling `setTimeout(NaN)`, which fires
 * immediately and turns a 3-hour cron into a tight loop against Mystifly.
 */
import assert from 'node:assert';
import {
  clampPtrPollMinutes,
  DEFAULT_PTR_POLL_FREQUENCY_MINUTES,
  PTR_POLL_CONFIG_KEY,
} from './ptr-poll-config';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

console.log('ptr poll frequency');

test('default is three hours', () => {
  assert.equal(DEFAULT_PTR_POLL_FREQUENCY_MINUTES, 180);
});

test('the key is the one the admin console writes', () => {
  assert.equal(PTR_POLL_CONFIG_KEY, 'ptr_poll_frequency_minutes');
});

test('a sane value passes through', () => {
  assert.equal(clampPtrPollMinutes(180), 180);
  assert.equal(clampPtrPollMinutes(1), 1);
  assert.equal(clampPtrPollMinutes(1440), 1440);
});

test('zero and negatives clamp up to the floor, never to no delay', () => {
  assert.equal(clampPtrPollMinutes(0), 1);
  assert.equal(clampPtrPollMinutes(-99), 1);
});

test('above a day clamps to a day', () => {
  assert.equal(clampPtrPollMinutes(5000), 1440);
});

test('NaN and Infinity fall back to the default', () => {
  assert.equal(clampPtrPollMinutes(NaN), 180);
  assert.equal(clampPtrPollMinutes(Infinity), 180);
});

test('fractions round rather than producing a fractional timeout', () => {
  assert.equal(clampPtrPollMinutes(179.6), 180);
  assert.equal(clampPtrPollMinutes(0.2), 1);
});

console.log(`\n${passed} passed`);
