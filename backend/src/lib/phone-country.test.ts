/**
 * Run: cd backend && npx tsx src/lib/phone-country.test.ts
 *
 * Mystifly reported CountryCode arriving as "US" on every booking reference. It
 * is the numeric dialling code, digits only. AreaCode was worse — hard-coded '1'
 * on every booking regardless of country, so an Indian number carried a US area
 * code.
 *
 * The split now comes from libphonenumber-js and the real numbering plans, so
 * these assert against actual country rules rather than a table of our own.
 */
import assert from 'node:assert';
import { bookPhoneFields, dialCodeForCountry } from './phone-country';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

console.log('phone fields for the Book request');

// ── The reported defect ─────────────────────────────────────────────────────

test('a US number yields 1, not "US"', () => {
  const f = bookPhoneFields('+19723456789');
  assert.equal(f.countryCode, '1');
  assert.notEqual(f.countryCode, 'US');
});

test('an Indian number yields 91, and never a US area code', () => {
  const f = bookPhoneFields('+919826240929');
  assert.equal(f.countryCode, '91');
  assert.notEqual(f.areaCode, '1');
});

// ── Area codes, from the numbering plan ─────────────────────────────────────

test('NANP area code is the three-digit code', () => {
  assert.deepEqual(bookPhoneFields('+19723456789'),
    { countryCode: '1', areaCode: '972', phoneNumber: '3456789' });
  assert.deepEqual(bookPhoneFields('+12125551234'),
    { countryCode: '1', areaCode: '212', phoneNumber: '5551234' });
});

test('India STD code on a landline', () => {
  // Mumbai is 22 — two digits, where NANP is always three.
  const f = bookPhoneFields('+912212345678');
  assert.equal(f.countryCode, '91');
  assert.equal(f.areaCode, '22');
  assert.equal(f.phoneNumber, '12345678');
});

test('UK area code on a London landline', () => {
  const f = bookPhoneFields('+442071234567');
  assert.equal(f.countryCode, '44');
  assert.equal(f.areaCode, '20');
  assert.equal(f.phoneNumber, '71234567');
});

test('a mobile carries its operator block in the same position', () => {
  // We do not separate mobile from landline, so the national destination code
  // applies to both — for a mobile that is the operator block.
  const f = bookPhoneFields('+919826240929');
  assert.equal(f.countryCode, '91');
  assert.equal(f.areaCode.length > 0, true);
  assert.equal(f.areaCode + f.phoneNumber, '9826240929');
});

// ── The invariant that protects the traveller ───────────────────────────────

test('the three parts always rebuild the number, whatever the country', () => {
  // Whichever way Mystifly reassembles them, nothing is dropped or duplicated.
  const cases: Array<[string, string]> = [
    ['+19723456789', '19723456789'],
    ['+919826240929', '919826240929'],
    ['+912212345678', '912212345678'],
    ['+442071234567', '442071234567'],
    ['+971501234567', '971501234567'],
    ['+6591234567', '6591234567'],
  ];
  for (const [input, expected] of cases) {
    const f = bookPhoneFields(input);
    assert.equal(f.countryCode + f.areaCode + f.phoneNumber, expected, `for ${input}`);
  }
});

test('every field is digits only — no +, spaces, brackets or dashes', () => {
  for (const n of ['+1 (972) 345-6789', '+91 98262 40929', '00442071234567']) {
    const f = bookPhoneFields(n);
    for (const [k, v] of Object.entries(f)) {
      assert.match(v, /^[0-9]*$/, `${k} on ${n} was "${v}"`);
    }
  }
});

test('a 00 prefix is read the same as +', () => {
  assert.equal(bookPhoneFields('0019723456789').countryCode, '1');
  assert.equal(bookPhoneFields('0019723456789').areaCode, '972');
});

// ── Bare numbers and hints ──────────────────────────────────────────────────

test('a country hint resolves a number with no dialling code', () => {
  const f = bookPhoneFields('9723456789', 'US');
  assert.equal(f.countryCode, '1');
  assert.equal(f.areaCode, '972');
});

test('the hint accepts a country name as well as an ISO code', () => {
  assert.equal(dialCodeForCountry('India'), '91');
  assert.equal(dialCodeForCountry('IN'), '91');
  assert.equal(dialCodeForCountry('United States'), '1');
  assert.equal(dialCodeForCountry('USA'), '1');
  assert.equal(dialCodeForCountry('United Kingdom'), '44');
});

test('the phone wins over the hint when they disagree', () => {
  // An Indian passport holder with a US mobile has a US phone; the phone block
  // describes the phone, not the passport.
  assert.equal(bookPhoneFields('+19723456789', 'India').countryCode, '1');
});

// ── Never block a booking ───────────────────────────────────────────────────

test('an unparseable number still yields digits and does not throw', () => {
  const f = bookPhoneFields('not a phone', 'US');
  assert.match(f.countryCode, /^[0-9]+$/);
  assert.match(f.phoneNumber, /^[0-9]*$/);
});

test('empty input falls back rather than failing', () => {
  assert.equal(bookPhoneFields('', null).countryCode, '1');
  assert.equal(bookPhoneFields(null, null).countryCode, '1');
});

test('an unknown country name does not throw', () => {
  assert.equal(dialCodeForCountry('Atlantis'), '');
  assert.equal(dialCodeForCountry(''), '');
  assert.equal(dialCodeForCountry(null), '');
});

console.log(`\n${passed} passed`);
