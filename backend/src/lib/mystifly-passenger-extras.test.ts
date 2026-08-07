/**
 * Run: cd backend && npx tsx src/lib/mystifly-passenger-extras.test.ts
 *
 * Add-ons are chosen on four surfaces — web checkout, the booking page, the AI
 * bot and the agent console — and were assembled separately at each book path.
 * /api/book sent none of them at all; the checkout route sent baggage only, and
 * recovered the id by stripping a literal 'baggage-' prefix, so anything keyed
 * differently became NaN.
 *
 * These assert the shapes each surface actually produces, so one mapper keeps
 * serving all of them.
 */
import assert from 'node:assert';
import { buildPassengerExtras, providerServiceIdOf } from './mystifly-passenger-extras';
import { toBookExtraServices } from './mystifly-extra-services';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const forPax = (ancs: any[], extra: any = {}) => buildPassengerExtras({
  passengerId: 'p1', passengerIndex: 0, selectedAncillaries: ancs, ...extra,
});

console.log('passenger extras mapper');

// ── Ids, whatever the surface calls them ────────────────────────────────────

test('every prefix in use resolves to the provider id', () => {
  // Stripping one literal prefix is what turned the others into NaN.
  assert.equal(providerServiceIdOf({ providerServiceId: 'extra-2' }), '2');
  assert.equal(providerServiceIdOf({ providerServiceId: 'baggage-17' }), '17');
  assert.equal(providerServiceIdOf({ providerServiceId: 'meal-svc-7' }), '7');
});

test('rawProviderData wins over the prefix', () => {
  assert.equal(providerServiceIdOf({
    providerServiceId: 'extra-999', rawProviderData: { extraServiceId: '2' },
  }), '2');
  assert.equal(providerServiceIdOf({ rawProviderData: { ServiceId: 17 } }), '17');
});

test('a non-numeric id yields null rather than NaN', () => {
  // 'meal-VGML' is a free SSR code, not a purchasable service.
  assert.equal(providerServiceIdOf({ providerServiceId: 'meal-VGML' }), null);
  assert.equal(providerServiceIdOf({ providerServiceId: 'ase_abc' }), null);
  assert.equal(providerServiceIdOf({}), null);
});

// ── What books, and what must not ───────────────────────────────────────────

test('a paid bag books', () => {
  const e = forPax([{ provider: 'MYSTIFLY', ancillaryType: 'EXTRA_CHECKED_BAG',
    providerServiceId: 'extra-2', included: false, rawProviderData: { extraServiceId: '2' } }]);
  assert.deepEqual(toBookExtraServices(e.extraServices ?? []), [{ ExtraServiceId: 2 }]);
});

test('a paid MEAL books too — it was being ignored entirely', () => {
  const e = forPax([{ provider: 'MYSTIFLY', ancillaryType: 'MEAL',
    providerServiceId: 'extra-7', included: false, rawProviderData: { extraServiceId: '7' } }]);
  assert.deepEqual(toBookExtraServices(e.extraServices ?? []), [{ ExtraServiceId: 7 }]);
});

test('a free IATA meal SSR never becomes a paid extra', () => {
  // Sending it as one asks the airline to charge for a preference.
  const e = forPax([{ provider: 'MYSTIFLY', ancillaryType: 'MEAL',
    providerServiceId: 'meal-VGML', included: false, rawProviderData: { ssrCode: 'VGML' } }]);
  assert.equal(e.extraServices, undefined);
});

test('a bag already in the fare is not bought again', () => {
  const e = forPax([{ provider: 'MYSTIFLY', ancillaryType: 'CHECKED_BAG',
    providerServiceId: 'extra-9', included: true, rawProviderData: { extraServiceId: '9' } }]);
  assert.equal(e.extraServices, undefined);
});

test('another provider\'s service is not sent to Mystifly', () => {
  const e = forPax([{ provider: 'DUFFEL', ancillaryType: 'EXTRA_CHECKED_BAG',
    providerServiceId: 'ase_123', included: false }]);
  assert.equal(e.extraServices, undefined);
});

// ── Ownership ───────────────────────────────────────────────────────────────

test('another passenger\'s bag does not attach to this one', () => {
  const e = forPax([{ provider: 'MYSTIFLY', ancillaryType: 'EXTRA_CHECKED_BAG',
    providerServiceId: 'extra-4', included: false, passengerId: 'p2',
    rawProviderData: { extraServiceId: '4' } }]);
  assert.equal(e.extraServices, undefined);
});

test('an unowned service applies to everyone — GROUP_PAX and solo bookings', () => {
  const e = forPax([{ provider: 'MYSTIFLY', ancillaryType: 'EXTRA_CHECKED_BAG',
    providerServiceId: 'extra-5', included: false, passengerId: null,
    rawProviderData: { extraServiceId: '5' } }]);
  assert.deepEqual(e.extraServices, ['5']);
});

// ── Seats and free meals travel alongside, not instead ──────────────────────

test('seats, free meal and paid extras coexist on one passenger', () => {
  const e = buildPassengerExtras({
    passengerId: 'p1', passengerIndex: 0,
    selectedAncillaries: [{ provider: 'MYSTIFLY', ancillaryType: 'EXTRA_CHECKED_BAG',
      providerServiceId: 'extra-2', included: false, rawProviderData: { extraServiceId: '2' } }],
    seatSelections: [{ passengerId: 'p1', seatSelectionKey: 'K-12A', seatPreference: 'W' }],
    mealSelections: [{ passengerId: 'p1', mealCode: 'VGML' }],
  });
  assert.deepEqual(e.extraServices, ['2']);
  assert.deepEqual(e.seatSelectionKeys, ['K-12A']);
  assert.equal(e.seatPreference, 'W');
  assert.equal(e.mealPreference, 'VGML');
});

test('seat and meal match on index when there is no passenger id', () => {
  const e = buildPassengerExtras({
    passengerId: 'p1', passengerIndex: 1,
    seatSelections: [{ passengerIndex: 1, seatSelectionKey: 'K-3C' }],
    mealSelections: [{ passengerIndex: 1, code: 'KSML' }],
  });
  assert.deepEqual(e.seatSelectionKeys, ['K-3C']);
  assert.equal(e.mealPreference, 'KSML');
});

test('nothing chosen yields an empty object, not empty arrays', () => {
  // An empty array would still serialise onto the request.
  assert.deepEqual(buildPassengerExtras({ passengerIndex: 0 }), {});
  assert.deepEqual(forPax([]), {});
});

// ── The real store shapes — what was never matching ─────────────────────────

test('a meal reads the store field mealType, not mealCode', () => {
  // MealSelection has `mealType`. The mapper read `mealCode ?? code`, so no meal
  // preference has ever reached Mystifly on any booking — FM0U0J94 recorded
  // DBML on both legs and TripDetails carried no SSR at all.
  const e = buildPassengerExtras({
    passengerId: 'p1', passengerIndex: 0,
    mealSelections: [{ passengerId: 'p1', mealType: 'VGML' }],
  });
  assert.equal(e.mealPreference, 'VGML');
});

test('STANDARD and NONE are not meal codes', () => {
  for (const mealType of ['STANDARD', 'NONE', '']) {
    const e = buildPassengerExtras({
      passengerId: 'p1', passengerIndex: 0,
      mealSelections: [{ passengerId: 'p1', mealType }],
    });
    assert.equal(e.mealPreference, undefined, `for "${mealType}"`);
  }
});

test('a seat reads the store fields preference and seatNumber', () => {
  // SeatSelection has `preference` and `seatNumber`; the mapper read
  // `seatPreference` and `seatSelectionKey`. Nothing matched, ever.
  const e = buildPassengerExtras({
    passengerId: 'p1', passengerIndex: 0,
    seatSelections: [{ passengerId: 'p1', preference: 'window', seatNumber: '12A' }],
  });
  assert.equal(e.seatPreference, 'W');
  assert.deepEqual(e.seatSelectionKeys, ['12A']);
});

test('seat words translate to the codes Mystifly accepts', () => {
  // The contract is Any | A | W; the store holds 'window' / 'aisle'.
  const pref = (preference: string) => buildPassengerExtras({
    passengerId: 'p1', passengerIndex: 0,
    seatSelections: [{ passengerId: 'p1', preference }],
  }).seatPreference;
  assert.equal(pref('window'), 'W');
  assert.equal(pref('aisle'), 'A');
});

test('middle and no_preference send nothing rather than a wrong code', () => {
  // There is no middle code, and 'Any' would claim a preference nobody gave.
  const pref = (preference: string) => buildPassengerExtras({
    passengerId: 'p1', passengerIndex: 0,
    seatSelections: [{ passengerId: 'p1', preference }],
  }).seatPreference;
  assert.equal(pref('middle'), undefined);
  assert.equal(pref('no_preference'), undefined);
});

test('a per-segment selection yields one preference and every seat', () => {
  // The store keys selections by segment; Mystifly takes one preference per
  // traveller, so the first stated one wins and all the seats travel.
  const e = buildPassengerExtras({
    passengerId: 'p1', passengerIndex: 0,
    seatSelections: [
      { passengerId: 'p1', preference: 'window', seatNumber: '12A' },
      { passengerId: 'p1', preference: 'aisle',  seatNumber: '14C' },
    ],
  });
  assert.equal(e.seatPreference, 'W');
  assert.deepEqual(e.seatSelectionKeys, ['12A', '14C']);
});

console.log(`\n${passed} passed`);
