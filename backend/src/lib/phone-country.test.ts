/**
 * Run: cd backend && npx tsx src/lib/phone-country.test.ts
 *
 * Mystifly reported TravelerInfo.CountryCode arriving as "US" on every booking
 * reference. It is the phone's dialling code — 1 for the US, 91 for India — and
 * it was being filled with an ISO country that, because checkout sends no
 * country at all, was the same literal on every request.
 */
import assert from 'node:assert';
import { splitPhone, dialCodeForCountry, bookPhoneFields } from './phone-country';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

console.log('phone country codes');

// ── The reported defect ─────────────────────────────────────────────────────

test('a US number yields 1, not "US"', () => {
  const f = bookPhoneFields('+19723456789');
  assert.equal(f.countryCode, '1');
  assert.notEqual(f.countryCode, 'US');
});

test('an Indian number yields 91', () => {
  assert.equal(bookPhoneFields('+919876543210').countryCode, '91');
});

test('the codes Mystifly named, both directions', () => {
  assert.equal(dialCodeForCountry('US'), '1');
  assert.equal(dialCodeForCountry('IN'), '91');
  assert.equal(dialCodeForCountry('United States'), '1');
  assert.equal(dialCodeForCountry('India'), '91');
  assert.equal(dialCodeForCountry('USA'), '1');
});

// ── Splitting ───────────────────────────────────────────────────────────────

test('the national number comes back without the dialling code', () => {
  assert.deepEqual(splitPhone('+19723456789'), { countryCode: '1', phoneNumber: '9723456789' });
  assert.deepEqual(splitPhone('+919876543210'), { countryCode: '91', phoneNumber: '9876543210' });
});

test('a longer code is preferred over a shorter one it starts with', () => {
  // +971 (UAE) must not be read as +97 or +9.
  assert.equal(splitPhone('+971501234567').countryCode, '971');
  assert.equal(splitPhone('+441632960961').countryCode, '44');
});

test('00 prefix is treated like +', () => {
  assert.equal(splitPhone('0019723456789').countryCode, '1');
});

test('formatting characters are ignored', () => {
  assert.equal(splitPhone('+1 (972) 345-6789').countryCode, '1');
});

test('a bare national number is not carved up on a guess', () => {
  // "9723456789" is a US number without its +1. Reading the leading 972 as
  // Israel would invent a country the caller never stated.
  const s = splitPhone('9723456789');
  assert.equal(s.countryCode, '');
  assert.equal(s.phoneNumber, '9723456789');
});

test('a country hint resolves a bare number', () => {
  assert.equal(splitPhone('9723456789', 'US').countryCode, '1');
  assert.equal(bookPhoneFields('9876543210', 'India').countryCode, '91');
});

test('a prefix is never allowed to eat the whole number', () => {
  const s = splitPhone('+1234');
  assert.equal(s.phoneNumber.length >= 4, true);
});

// ── Fallbacks ───────────────────────────────────────────────────────────────

test('nothing known still yields a usable code, as before', () => {
  // The old code always sent something; a booking must not start failing
  // because a phone was missing.
  assert.equal(bookPhoneFields('', null).countryCode, '1');
  assert.equal(bookPhoneFields(null, null).countryCode, '1');
});

test('an unknown country name does not throw', () => {
  assert.equal(dialCodeForCountry('Atlantis'), '');
  assert.equal(dialCodeForCountry(''), '');
  assert.equal(dialCodeForCountry(null), '');
});

console.log(`\n${passed} passed`);
