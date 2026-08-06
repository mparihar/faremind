/**
 * Run: cd backend && npx tsx src/lib/mystifly-extra-services.test.ts
 *
 * The fixture is the real revalidation response for BCN→MUC: ExtraServices
 * empty, ExtraServices1_1 holding four purchasable bags. We read the empty one,
 * and read it as a bare array when it is an object — either mistake alone hid
 * every paid service, so no customer was ever offered a bag or a meal.
 */
import assert from 'node:assert';
import {
  parseExtraServices, baggageServices, mealServices,
  baggageWeightKg, toBookExtraServices, mealCodeFromDescription,
} from './mystifly-extra-services';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const bag = (id: string, desc: string, amount: string) => ({
  Behavior: 'PER_PAX_OUTBOUND', CheckInType: 'AIRPORT', Description: desc,
  FlightDesignator: '', IsMandatory: false, NameNumber: 0, Relation: '',
  ServiceCost: { Amount: amount, CurrencyCode: 'USD', DecimalPlaces: 2 },
  ServiceId: id, Type: 'BAGGAGE',
});

// Exactly what the provider returned live.
const REVAL = { Data: {
  ExtraServices: { NameNumbers: [], Services: [] },
  ExtraServices1_1: { NameNumbers: [], Services: [
    bag('1', '1 bags -15Kg ', '54.89'),
    bag('2', '1 bags -20Kg ', '59.6'),
    bag('3', '1 bags -25Kg ', '61.96'),
    bag('4', '1 bags -30Kg ', '80.81'),
  ] },
} };

console.log('mystifly extra services');

// ── The two mistakes ────────────────────────────────────────────────────────

test('reads ExtraServices1_1, not the empty ExtraServices beside it', () => {
  const all = parseExtraServices(REVAL);
  assert.equal(all.length, 4);
  assert.deepEqual(all.map((s) => s.serviceId), ['1', '2', '3', '4']);
});

test('reads the array nested under .Services, not the object itself', () => {
  // The old code called Array.isArray on the object, which is false, so every
  // service was skipped even when the key was right.
  assert.equal(Array.isArray(REVAL.Data.ExtraServices1_1), false);
  assert.equal(parseExtraServices(REVAL).length, 4);
});

test('an empty ExtraServices does not shadow a populated ExtraServices1_1', () => {
  assert.equal(REVAL.Data.ExtraServices.Services.length, 0);
  assert.equal(baggageServices(REVAL).length, 4);
});

// ── Field mapping ───────────────────────────────────────────────────────────

test('cost comes from the nested ServiceCost', () => {
  const first = baggageServices(REVAL)[0];
  assert.equal(first.amount, 54.89);
  assert.equal(first.currency, 'USD');
  assert.equal(first.description, '1 bags -15Kg');
});

test('behavior resolves direction and per-booking scope', () => {
  const s = baggageServices(REVAL)[0];
  assert.equal(s.direction, 'OUTBOUND');
  assert.equal(s.perBooking, false);

  const group = parseExtraServices({ Data: { ExtraServices1_1: { Services: [
    { ...bag('9', 'x', '1'), Behavior: 'GROUP_PAX_INBOUND' },
  ] } } })[0];
  assert.equal(group.direction, 'INBOUND');
  assert.equal(group.perBooking, true);
});

test('type is matched case-insensitively — the doc writes "Meal" and "BAGGAGE"', () => {
  const svc = parseExtraServices({ Data: { ExtraServices1_1: { Services: [
    { ...bag('7', 'Child Menu 39.12 USD', '39.12'), Type: 'Meal' },
  ] } } });
  assert.equal(svc[0].type, 'MEAL');
  assert.equal(mealServices({ Data: { ExtraServices1_1: { Services: [
    { ...bag('7', 'Child Menu', '39.12'), Type: 'Meal' },
  ] } } }).length, 1);
});

test('a service with no id is dropped — it cannot be booked', () => {
  const svc = parseExtraServices({ Data: { ExtraServices1_1: { Services: [
    { ...bag('', 'no id', '10') },
  ] } } });
  assert.equal(svc.length, 0);
});

// ── Baggage weight, read not guessed ────────────────────────────────────────

test('weight is read from the provider wording, both formats', () => {
  assert.equal(baggageWeightKg('1 bags -20Kg '), 20);
  assert.equal(baggageWeightKg('Total Weight: 20kgs each || 1 Bag(s) || 44.7 USD'), 20);
});

test('no weight stated yields null rather than a fabricated number', () => {
  assert.equal(baggageWeightKg('Priority boarding'), null);
  assert.equal(baggageWeightKg(''), null);
});

// ── The Book request shape ──────────────────────────────────────────────────

test('ids go back as [{ ExtraServiceId }] with numbers, per the doc', () => {
  assert.deepEqual(toBookExtraServices(['5', 10]), [
    { ExtraServiceId: 5 }, { ExtraServiceId: 10 },
  ]);
});

test('duplicates and junk are dropped rather than sent', () => {
  assert.deepEqual(toBookExtraServices(['3', 3, '', 'abc', 0, -1]), [{ ExtraServiceId: 3 }]);
  assert.deepEqual(toBookExtraServices([]), []);
});

// ── Meal codes from prose ───────────────────────────────────────────────────

test('a meal code is read out of the description, which is all we get', () => {
  assert.equal(mealCodeFromDescription('Child Menu 39.12 USD'), 'CHML');
  assert.equal(mealCodeFromDescription('Gluten-free Menu 39.12 USD'), 'GFML');
  assert.equal(mealCodeFromDescription('Kosher menu 39.12 USD'), 'KSML');
  assert.equal(mealCodeFromDescription('Halal Menu 39.12 USD'), 'MOML');
  assert.equal(mealCodeFromDescription('No Lactose Menu 39.12 USD'), 'NLML');
  assert.equal(mealCodeFromDescription('Diabetes Menu 39.12 USD'), 'DBML');
  assert.equal(mealCodeFromDescription('Classic Menu 39.12 USD'), 'STANDARD');
});

test('an unrecognised menu still resolves rather than being dropped', () => {
  assert.equal(mealCodeFromDescription('Chef Special Menu'), 'STANDARD');
});

// ── Never throw ─────────────────────────────────────────────────────────────

test('missing or shapeless input yields an empty list', () => {
  assert.deepEqual(parseExtraServices(null), []);
  assert.deepEqual(parseExtraServices({}), []);
  assert.deepEqual(parseExtraServices({ Data: {} }), []);
  assert.deepEqual(parseExtraServices({ Data: { ExtraServices1_1: {} } }), []);
});

test('a response wrapped in `raw` is read too — that is how our routes hold it', () => {
  assert.equal(parseExtraServices({ raw: REVAL }).length, 4);
});

console.log(`\n${passed} passed`);
