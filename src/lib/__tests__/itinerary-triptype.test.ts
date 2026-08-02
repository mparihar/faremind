/**
 * Run: npx tsx src/lib/__tests__/itinerary-triptype.test.ts
 *
 * The route arrow must agree with the trip type.
 *
 * A one-way SIN → BKK booking rendered "SIN ⇄ BKK" — a return arrow over the
 * words "One Way" — on the confirmation screen, in the emailed itinerary and in
 * the PDF. A customer reading that reasonably believes they hold a return.
 */
import assert from 'node:assert';
import { generateItineraryHtmlFromBooking } from '../fare-utils';

const ROUND = '\u21c4';   // ⇄
const ONEWAY = '\u2192';  // →

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const booking = (tripType: string, returnDate: string | null) => ({
  masterBookingReference: 'FMGJCRCA',
  masterPnr: 'MF35535126',
  airlinePnr: 'EJRYHI',
  tripType,
  bookingStatus: 'CONFIRMED',
  originAirport: 'SIN',
  destinationAirport: 'BKK',
  departureDate: '2026-10-15T09:00:00',
  returnDate,
  totalAmount: 210,
  currency: 'USD',
  customerName: 'Gaurang Parihar',
  passengers: [{ firstName: 'Gaurang', lastName: 'Parihar', passengerType: 'ADULT' }],
  pnrs: [{ pnrCode: 'MF35535126', airlinePnr: 'EJRYHI', airlineCode: 'TG', isPrimary: true }],
  segments: [{
    origin: 'SIN', destination: 'BKK', marketingAirlineCode: 'TG', flightNumber: '410',
    departureDateTime: '2026-10-15T09:00:00', arrivalDateTime: '2026-10-15T10:25:00',
  }],
  journeys: [],
});

console.log('emailed itinerary — route arrow follows the trip type');

test('a ONE_WAY booking renders a one-way arrow, never a return arrow', () => {
  const html = generateItineraryHtmlFromBooking(booking('ONE_WAY', null));
  assert.ok(!html.includes(`SIN ${ROUND} BKK`), 'a one-way trip must NOT show the return arrow');
  assert.ok(html.includes(`SIN ${ONEWAY} BKK`), 'a one-way trip must show the one-way arrow');
});

test('a ONE_WAY booking is labelled "One Way"', () => {
  const html = generateItineraryHtmlFromBooking(booking('ONE_WAY', null));
  assert.ok(html.includes('One Way'), 'the trip type must read "One Way"');
  assert.ok(!html.includes('Round Trip'), 'and must not also claim "Round Trip"');
});

test('a ROUND_TRIP booking still renders the return arrow', () => {
  const html = generateItineraryHtmlFromBooking(booking('ROUND_TRIP', '2026-10-22T18:00:00'));
  assert.ok(html.includes(`SIN ${ROUND} BKK`), 'a round trip must show the return arrow');
  assert.ok(html.includes('Round Trip'));
});

test('an absent tripType is treated as one-way, not silently as a return', () => {
  // Better to understate than to promise a return sector the customer has not bought.
  const html = generateItineraryHtmlFromBooking(booking('', null));
  assert.ok(!html.includes(`SIN ${ROUND} BKK`));
});

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES ABOVE' : ''}`);
