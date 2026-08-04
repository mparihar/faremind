/**
 * Run: cd backend && npx tsx --test src/lib/passenger-title.test.ts
 *
 * FM83B9T2 booked a female infant and the airline ticketed her MS. The booking
 * path was sending the literal `INF`, which Mystifly accepts and then resolves
 * to a title of its own. An infant takes a child's title:
 *
 *   Adult   Mr   / Ms
 *   Child   Mstr / Miss
 *   Infant  Mstr / Miss
 */
import assert from 'node:assert';
import { passengerTitle, passengerTitleCased, normalizePaxType } from './passenger-title';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

console.log('the rule');

test('adult', () => {
  assert.equal(passengerTitle('male', 'adult'), 'Mr');
  assert.equal(passengerTitle('female', 'adult'), 'Ms');
});

test('child takes MSTR / MISS', () => {
  assert.equal(passengerTitle('male', 'child'), 'Mstr');
  assert.equal(passengerTitle('female', 'child'), 'Miss');
});

test('infant takes the same as a child, never INF', () => {
  assert.equal(passengerTitle('male', 'infant'), 'Mstr');
  assert.equal(passengerTitle('female', 'infant'), 'Miss');
});

test('FM83B9T2: the female infant is Miss, not Ms', () => {
  // The exact regression. She was ticketed MS.
  assert.equal(passengerTitle('female', 'infant'), 'Miss');
  assert.notEqual(passengerTitle('female', 'infant'), 'Ms');
});

test('no passenger type ever yields the literal INF', () => {
  for (const type of ['adult', 'child', 'infant', 'ADT', 'CHD', 'INF', 'i', 'c', '', null, undefined]) {
    for (const g of ['male', 'female', 'M', 'F', '', null]) {
      assert.notEqual(passengerTitle(g, type as any), 'INF' as any, `${type}/${g}`);
    }
  }
});

console.log('\ninput shapes the callers actually pass');

test('provider codes and long forms both normalise', () => {
  assert.equal(normalizePaxType('INF'), 'INF');
  assert.equal(normalizePaxType('infant'), 'INF');
  assert.equal(normalizePaxType('CHD'), 'CHD');
  assert.equal(normalizePaxType('child'), 'CHD');
  assert.equal(normalizePaxType('ADT'), 'ADT');
  assert.equal(normalizePaxType('adult'), 'ADT');
});

test('single-letter gender is understood', () => {
  assert.equal(passengerTitle('F', 'infant'), 'Miss');
  assert.equal(passengerTitle('M', 'infant'), 'Mstr');
});

test('an unknown type is treated as an adult, not as a minor', () => {
  assert.equal(passengerTitle('female', 'senior'), 'Ms');
  assert.equal(passengerTitle('male', undefined), 'Mr');
});

test('missing gender falls to the male form rather than throwing', () => {
  assert.equal(passengerTitle(null, 'infant'), 'Mstr');
  assert.equal(passengerTitle('', 'adult'), 'Mr');
});

console.log('\nthe PTR casing');

test('title case mirrors the upper-case rule exactly', () => {
  assert.equal(passengerTitleCased('female', 'infant'), 'Miss');
  assert.equal(passengerTitleCased('male', 'infant'), 'Mstr');
  assert.equal(passengerTitleCased('female', 'child'), 'Miss');
  assert.equal(passengerTitleCased('male', 'adult'), 'Mr');
  assert.equal(passengerTitleCased('female', 'adult'), 'Ms');
});

test('a PTR addresses a passenger the same way the ticket does', () => {
  // These two disagreed before: book sent INF, the PTR sent Miss.
  for (const [g, t] of [['female', 'infant'], ['male', 'infant'], ['female', 'child'], ['male', 'child'], ['female', 'adult'], ['male', 'adult']] as const) {
    assert.equal(passengerTitleCased(g, t), passengerTitle(g, t));
  }
});

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES ABOVE' : ''}`);
