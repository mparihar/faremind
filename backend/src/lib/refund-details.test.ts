/**
 * Run: cd backend && npx tsx src/lib/refund-details.test.ts
 *
 * Fixtures are the real TripDetails breakdown for MF35565926 (FM83B9T2), the
 * booking that proved this: the same RefundQuote fails without RefundDetails
 * and succeeds with it (PTRId 22982).
 */
import assert from 'node:assert';
import { buildRefundDetails, ticketNumbersByType } from './refund-details';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const TRIP = {
  Data: { TripDetailsResult: { TravelItinerary: { TripDetailsPTC_FareBreakdowns: [
    { PassengerTypeQuantity: { Code: 'ADT', Quantity: 1 },
      TripDetailsPassengerFare: { EquiFare: { Amount: '40.01' }, Tax: { Amount: '122.93' },
        TotalFare: { Amount: '162.94', CurrencyCode: 'USD' } } },
    { PassengerTypeQuantity: { Code: 'CHD', Quantity: 1 },
      TripDetailsPassengerFare: { EquiFare: { Amount: '31.62' }, Tax: { Amount: '122.51' },
        TotalFare: { Amount: '154.13', CurrencyCode: 'USD' } } },
    { PassengerTypeQuantity: { Code: 'INF', Quantity: 1 },
      TripDetailsPassengerFare: { EquiFare: { Amount: '8.68' }, Tax: { Amount: '8.51' },
        TotalFare: { Amount: '17.19', CurrencyCode: 'USD' } } },
  ] } } },
};

console.log('refund details');

test('one row per passenger type, with the provider\'s own figures', () => {
  const d = buildRefundDetails(TRIP);
  assert.equal(d.length, 3);
  assert.deepEqual(d[0], {
    PassengerType: 'ADT', BaseFare: 40.01, Tax: 122.93, TotalFare: 162.94,
    Currency: 'USD', PaxCount: 1,
  });
  assert.equal(d[2].PassengerType, 'INF');
  assert.equal(d[2].TotalFare, 17.19);
});

test('nothing is invented — the totals are the provider\'s, not a sum we chose', () => {
  const d = buildRefundDetails(TRIP);
  // 40.01 + 122.93 = 162.94, and the provider agrees; we send their number.
  assert.equal(d[0].TotalFare, 162.94);
});

test('ticket numbers attach per passenger type when known', () => {
  const byType = ticketNumbersByType([
    { passengerType: 'ADT', eTicket: 'TKT529614' },
    { passengerType: 'CHD', eTicket: 'TKT529615' },
    { passengerType: 'INF', eTicket: 'TKT529616' },
  ]);
  const d = buildRefundDetails(TRIP, byType);
  assert.equal(d[0].TicketNumber, 'TKT529614');
  assert.equal(d[1].TicketNumber, 'TKT529615');
  assert.equal(d[2].TicketNumber, 'TKT529616');
});

test('no ticket numbers is still a valid payload', () => {
  const d = buildRefundDetails(TRIP, {});
  assert.equal(d.length, 3);
  assert.equal(d[0].TicketNumber, undefined);
});

test('a multi-passenger PTC keeps its count', () => {
  const d = buildRefundDetails({ Data: { TripDetailsResult: { TravelItinerary: {
    TripDetailsPTC_FareBreakdowns: [{ PassengerTypeQuantity: { Code: 'ADT', Quantity: 3 },
      TripDetailsPassengerFare: { EquiFare: { Amount: '10' }, Tax: { Amount: '5' },
        TotalFare: { Amount: '15', CurrencyCode: 'INR' } } }] } } } });
  assert.equal(d[0].PaxCount, 3);
  assert.equal(d[0].Currency, 'INR');
});

test('the older TripDetails shapes are read too', () => {
  const flat = { Data: { TravelItinerary: { TripDetailsPTC_FareBreakdowns:
    TRIP.Data.TripDetailsResult.TravelItinerary.TripDetailsPTC_FareBreakdowns } } };
  assert.equal(buildRefundDetails(flat).length, 3);
});

test('a total is derived only when the provider omits one', () => {
  const d = buildRefundDetails({ Data: { TripDetailsResult: { TravelItinerary: {
    TripDetailsPTC_FareBreakdowns: [{ PassengerTypeQuantity: { Code: 'ADT', Quantity: 1 },
      TripDetailsPassengerFare: { EquiFare: { Amount: '100' }, Tax: { Amount: '20' } } }] } } } });
  assert.equal(d[0].TotalFare, 120);
});

test('a zero-value row is dropped rather than sent as zeroes', () => {
  // Sending an empty row is what the refusal is about; it must not be padded.
  const d = buildRefundDetails({ Data: { TripDetailsResult: { TravelItinerary: {
    TripDetailsPTC_FareBreakdowns: [{ PassengerTypeQuantity: { Code: 'ADT', Quantity: 1 },
      TripDetailsPassengerFare: {} }] } } } });
  assert.equal(d.length, 0);
});

test('a missing or shapeless payload gives an empty array, not a throw', () => {
  assert.deepEqual(buildRefundDetails(null), []);
  assert.deepEqual(buildRefundDetails({}), []);
  assert.deepEqual(buildRefundDetails({ Data: { TripDetailsResult: {} } }), []);
  assert.deepEqual(ticketNumbersByType(undefined as any), {});
});

console.log(`\n${passed} passed`);
