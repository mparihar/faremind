/**
 * Run: cd backend && npx tsx src/lib/provider-time.test.ts
 *
 * The regression is FMP6VJN2: Mystifly sent "2026-12-11T18:10:00" for VY1164
 * out of BCN, and the row landed on 2026-12-12T00:10:00.000Z — the flight moved
 * to the next day for anyone not in US Central.
 *
 * These run under TZ=America/Chicago, TZ=Asia/Kolkata and TZ=UTC in CI (see the
 * npm script) precisely because the old code passed in one zone and failed in
 * the others. A test that only runs in the author's timezone cannot see this
 * class of bug at all.
 */
import assert from 'node:assert';
import {
  parseProviderDateTime,
  parseProviderDateTimeOr,
  providerHour,
  providerMinute,
  providerDateOnly,
  hasExplicitZone,
  formatFlightDate,
  formatFlightTime,
  formatFlightTime24,
} from './provider-time';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

console.log(`provider time  (this process: TZ=${process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone})`);

// ── The regression ───────────────────────────────────────────────────────────

test('FMP6VJN2: BCN 18:10 stays 18:10 on the 11th', () => {
  const d = parseProviderDateTime('2026-12-11T18:10:00');
  assert.equal(d!.toISOString(), '2026-12-11T18:10:00.000Z');
});

test('FMP6VJN2: and never becomes the 12th', () => {
  assert.equal(providerDateOnly('2026-12-11T18:10:00'), '2026-12-11');
  assert.notEqual(parseProviderDateTime('2026-12-11T18:10:00')!.toISOString().slice(0, 10), '2026-12-12');
});

test('the arrival on the same booking', () => {
  assert.equal(parseProviderDateTime('2026-12-11T20:15:00')!.toISOString(), '2026-12-11T20:15:00.000Z');
});

// ── Zone independence ────────────────────────────────────────────────────────

test('a zone-less string is the same instant regardless of machine', () => {
  // Whatever TZ this process runs under, the answer is fixed. Under the old
  // `new Date(s)` this assertion passes only when TZ=UTC.
  assert.equal(parseProviderDateTime('2026-01-15T09:30:00')!.getTime(), Date.UTC(2026, 0, 15, 9, 30));
});

test('midnight does not roll backwards into the previous day', () => {
  assert.equal(providerDateOnly('2026-03-02T00:05:00'), '2026-03-02');
});

test('late evening does not roll forwards into the next day', () => {
  assert.equal(providerDateOnly('2026-03-02T23:55:00'), '2026-03-02');
});

test('an explicit offset is recognised but the wall clock still wins', () => {
  assert.equal(hasExplicitZone('2026-06-01T09:00:00+05:30'), true);
  assert.equal(hasExplicitZone('2026-06-01T09:00:00'), false);
  assert.equal(hasExplicitZone('2026-06-01T09:00:00Z'), true);
  // 09:00 is what the departure board says, so 09:00 is what we keep.
  assert.equal(providerHour('2026-06-01T09:00:00+05:30'), 9);
  assert.equal(providerHour('2026-06-01T09:00:00Z'), 9);
});

test('a space separator parses like a T', () => {
  assert.equal(parseProviderDateTime('2026-12-11 18:10:00')!.toISOString(), '2026-12-11T18:10:00.000Z');
});

test('a date with no time is midnight, not shifted', () => {
  assert.equal(parseProviderDateTime('2026-12-11')!.toISOString(), '2026-12-11T00:00:00.000Z');
});

test('milliseconds survive', () => {
  assert.equal(parseProviderDateTime('2026-12-11T18:10:00.250')!.toISOString(), '2026-12-11T18:10:00.250Z');
});

// ── Hour extraction, which drives red-eye and time-of-day scoring ────────────

test('the hour is the wall-clock hour', () => {
  assert.equal(providerHour('2026-12-11T18:10:00'), 18);
  assert.equal(providerMinute('2026-12-11T18:10:00'), 10);
});

test('a 02:00 red-eye is 2, not re-projected into some other hour', () => {
  assert.equal(providerHour('2026-12-11T02:00:00'), 2);
});

test('a 23:00 departure is 23', () => {
  assert.equal(providerHour('2026-12-11T23:00:00'), 23);
});

// ── Bad input ────────────────────────────────────────────────────────────────

test('null and empty give null, not the epoch', () => {
  assert.equal(parseProviderDateTime(null), null);
  assert.equal(parseProviderDateTime(undefined), null);
  assert.equal(parseProviderDateTime(''), null);
  assert.equal(parseProviderDateTime('   '), null);
});

test('garbage gives null, never Invalid Date', () => {
  assert.equal(parseProviderDateTime('not a date'), null);
  assert.equal(providerHour('not a date'), null);
});

test('a Date passes straight through', () => {
  const d = new Date('2026-12-11T18:10:00.000Z');
  assert.equal(parseProviderDateTime(d)!.getTime(), d.getTime());
  assert.equal(parseProviderDateTime(new Date('nope')), null);
});

test('the Or form falls back without throwing', () => {
  const fb = new Date('2000-01-01T00:00:00.000Z');
  assert.equal(parseProviderDateTimeOr(null, fb).getTime(), fb.getTime());
  assert.equal(parseProviderDateTimeOr('2026-12-11T18:10:00', fb).toISOString(), '2026-12-11T18:10:00.000Z');
});

// ── Rendering, the other half of the invariant ───────────────────────────────

test('the rendered date is the provider date in any viewer timezone', () => {
  assert.equal(formatFlightDate('2026-12-11T18:10:00'), 'Dec 11, 2026');
});

test('the rendered time is the provider time', () => {
  assert.equal(formatFlightTime('2026-12-11T18:10:00'), '6:10 PM');
  assert.equal(formatFlightTime24('2026-12-11T18:10:00'), '18:10');
});

test('rendering a stored Date round-trips', () => {
  const stored = parseProviderDateTime('2026-12-11T18:10:00')!;
  assert.equal(formatFlightTime24(stored), '18:10');
  assert.equal(formatFlightDate(stored), 'Dec 11, 2026');
});

test('a missing time renders empty, not "Invalid Date"', () => {
  assert.equal(formatFlightDate(null), '');
  assert.equal(formatFlightTime(undefined), '');
  assert.equal(formatFlightTime24('garbage'), '');
});

console.log(`\n${passed} passed`);
