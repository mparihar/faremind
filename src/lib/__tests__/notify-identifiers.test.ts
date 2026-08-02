/**
 * Run: npx tsx src/lib/__tests__/notify-identifiers.test.ts
 *
 * Renders the REAL frontend email templates and asserts the three booking
 * identifiers are never substituted for one another.
 *
 * The defect these guard: templates wrote `d.airline_pnr || d.pnr` and
 * `d.booking_reference ?? d.pnr`, and `d.pnr` carries the MYSTIFLY reference.
 * A booking whose locator was not yet published mailed the customer
 * "Airline PNR: MF35534926" — a code no airline desk can find — and the admin
 * mail headed itself "New Booking Confirmed – MF35534926" under a
 * "FareMind Reference" label.
 */
import assert from 'node:assert';
import { airlinePnrLabel, fareMindRef, looksLikeMystiflyRef } from '../booking-identifiers';
import { buildCustomerEmail, buildSupportEmail } from '../notify';

const MYSTIFLY_REF = 'MF35534926';
const AIRLINE_PNR = 'EYUG8L';
const FAREMIND_REF = 'FMCA2CIN';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

console.log('booking-identifiers');

test('the locator rejects a Mystifly reference rather than displaying it', () => {
  assert.equal(airlinePnrLabel(MYSTIFLY_REF), 'Not Available');
  assert.equal(airlinePnrLabel(AIRLINE_PNR), AIRLINE_PNR);
  assert.equal(airlinePnrLabel(null), 'Not Available');
  assert.equal(airlinePnrLabel(undefined), 'Not Available');
  assert.equal(airlinePnrLabel(''), 'Not Available');
});

test('our reference never falls back to the provider reference', () => {
  assert.equal(fareMindRef(FAREMIND_REF), FAREMIND_REF);
  assert.equal(fareMindRef(MYSTIFLY_REF), '', 'an MF ref is not our reference');
  assert.equal(fareMindRef(undefined), '');
  assert.equal(fareMindRef(undefined, 'N/A'), 'N/A');
});

test('MF-shape detection is case-insensitive and does not over-match', () => {
  assert.ok(looksLikeMystiflyRef('MF35534926'));
  assert.ok(looksLikeMystiflyRef('mf35534926'));
  assert.ok(!looksLikeMystiflyRef('MFCA2CIN'), 'letters after MF are not an MF ref');
  assert.ok(!looksLikeMystiflyRef(AIRLINE_PNR));
});

console.log('\nemail templates (src/lib/notify.ts)');

/**
 * The customer confirmation email embeds the itinerary rendered by
 * generateItineraryHtmlFromBooking, so passing a real booking here covers
 * fare-utils too — the template that printed "AIRLINE PNR  MF35534926".
 */
const fullBooking = {
  masterBookingReference: FAREMIND_REF,
  masterPnr: MYSTIFLY_REF,
  mystiflyMfRef: MYSTIFLY_REF,
  airlinePnr: AIRLINE_PNR,
  bookingStatus: 'CONFIRMED',
  totalAmount: 185,
  currency: 'USD',
  customerName: 'Gaurang Parihar',
  customerEmail: 'traveller@example.com',
  pnrs: [{ pnrCode: MYSTIFLY_REF, airlinePnr: AIRLINE_PNR, airlineCode: 'AI', isPrimary: true }],
  passengers: [{ firstName: 'Gaurang', lastName: 'Parihar', passengerType: 'ADULT' }],
  segments: [{
    origin: 'DEL', destination: 'PNQ', marketingAirlineCode: 'AI', flightNumber: '2971',
    departureDateTime: '2026-11-16T06:00:00', arrivalDateTime: '2026-11-16T08:00:00',
  }],
  journeys: [],
};

const base = {
  booking_reference: FAREMIND_REF,
  pnr: MYSTIFLY_REF,                 // legacy key — must never surface as either
  mystifly_ref: MYSTIFLY_REF,
  customer_name: 'Gaurang Parihar',
  customer_email: 'traveller@example.com',
  route: 'DEL - PNQ',
  origin: 'DEL', destination: 'PNQ',
  total_amount: '$185.00',
};

function surfaces(spec: any): string {
  assert.ok(spec, 'template returned null');
  return [spec.subject, spec.html, spec.text].join('\n');
}

if (typeof buildCustomerEmail === 'function') {
  test('customer email shows the airline locator, never the Mystifly ref', () => {
    const out = surfaces(buildCustomerEmail('BOOKING_CONFIRMED', { ...base, airline_pnr: AIRLINE_PNR, full_booking_data: fullBooking }));
    assert.ok(out.includes(AIRLINE_PNR), 'the airline locator must appear');
    assert.ok(out.includes(FAREMIND_REF), 'our reference must appear');
    assert.ok(!out.includes(MYSTIFLY_REF), 'the Mystifly reference must NOT reach a customer');
  });

  test('customer email says "Not Available" rather than falling back', () => {
    const out = surfaces(buildCustomerEmail('BOOKING_CONFIRMED', { ...base, airline_pnr: null, full_booking_data: { ...fullBooking, airlinePnr: null, pnrs: [{ pnrCode: MYSTIFLY_REF, airlinePnr: null, airlineCode: 'AI', isPrimary: true }] } }));
    assert.ok(!out.includes(MYSTIFLY_REF), 'an absent locator must not become the Mystifly ref');
    assert.ok(out.includes('Not Available'));
  });

  test('an MF-shaped value passed as airline_pnr is rejected', () => {
    const out = surfaces(buildCustomerEmail('BOOKING_CONFIRMED', { ...base, airline_pnr: MYSTIFLY_REF, full_booking_data: { ...fullBooking, airlinePnr: MYSTIFLY_REF, pnrs: [{ pnrCode: MYSTIFLY_REF, airlinePnr: MYSTIFLY_REF, airlineCode: 'AI', isPrimary: true }] } }));
    assert.ok(!out.includes(MYSTIFLY_REF));
  });

  test('a missing booking_reference does not become the Mystifly ref', () => {
    const out = surfaces(buildCustomerEmail('BOOKING_CONFIRMED', {
      ...base, booking_reference: undefined, airline_pnr: AIRLINE_PNR,
      full_booking_data: { ...fullBooking, masterBookingReference: undefined },
    }));
    assert.ok(!out.includes(MYSTIFLY_REF), 'the subject line must not carry an MF code');
  });
} else {
  console.log('  (buildCustomerEmail not exported — export it to cover the templates)');
}

if (typeof buildSupportEmail === 'function') {
  test('admin email headline uses OUR reference, not the provider one', () => {
    const spec = buildSupportEmail('BOOKING_CONFIRMED', { ...base, airline_pnr: AIRLINE_PNR });
    assert.ok(spec.subject.includes(FAREMIND_REF), `subject must carry ${FAREMIND_REF}, got: ${spec.subject}`);
    assert.ok(!spec.subject.includes(MYSTIFLY_REF), 'subject must not carry the MF code');
  });

  test('admin email keeps the Mystifly ref under its own label', () => {
    const spec = buildSupportEmail('BOOKING_CONFIRMED', { ...base, airline_pnr: null });
    const i = spec.html.indexOf('Airline PNR');
    if (i < 0) return;                       // this template does not show a locator
    const cell = spec.html.slice(i, i + 300);
    assert.ok(!cell.includes(MYSTIFLY_REF), 'the Airline PNR cell must never hold the MF ref');
  });
} else {
  console.log('  (buildSupportEmail not exported — export it to cover the templates)');
}

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES ABOVE' : ''}`);
