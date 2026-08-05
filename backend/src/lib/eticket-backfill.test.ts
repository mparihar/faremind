/**
 * Run: cd backend && npx tsx src/lib/eticket-backfill.test.ts
 *
 * The fixture is FMJHI8HG / MF35566226 exactly as Mystifly returns it. Stored
 * positionally, its three coupons landed one passenger out — Rishi held Ashish's,
 * Ashish held Puja's, Puja held none — and Get Reissue Quote came back "Eticket
 * number is wrong" because the adult was presented with the child's coupon.
 */
import assert from 'node:assert';
import { extractEticketsByPassenger, matchProviderEticket } from './eticket-backfill';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const TRIP = { Data: { TripDetailsResult: { TravelItinerary: { PassengerInfos: [
  { Passenger: { PassengerType: 'ADT', NameNumber: 529623,
      PaxName: { PassengerFirstName: 'RISHI', PassengerLastName: 'PARIHAR' } },
    ETickets: [{ ItemRPH: 1, ETicketNumber: 'TKT529623', ETicketType: 'Ticketed' }] },
  { Passenger: { PassengerType: 'CHD', NameNumber: 529624,
      PaxName: { PassengerFirstName: 'ASHISH', PassengerLastName: 'JAIN' } },
    ETickets: [{ ItemRPH: 1, ETicketNumber: 'TKT529624', ETicketType: 'Ticketed' }] },
  { Passenger: { PassengerType: 'INF', NameNumber: 529625,
      PaxName: { PassengerFirstName: 'PUJA', PassengerLastName: 'SINGH' } },
    ETickets: [{ ItemRPH: 1, ETicketNumber: 'TKT529625', ETicketType: 'Ticketed' }] },
] } } } };

console.log('eticket assignment');

test('each coupon comes back attached to its own passenger', () => {
  const e = extractEticketsByPassenger(TRIP);
  assert.equal(e.length, 3);
  assert.deepEqual(e.map(x => [x.firstName, x.passengerType, x.eTicket]), [
    ['RISHI', 'ADT', 'TKT529623'],
    ['ASHISH', 'CHD', 'TKT529624'],
    ['PUJA', 'INF', 'TKT529625'],
  ]);
});

test('the FMJHI8HG regression: the adult gets 529623, not the child\'s 529624', () => {
  const e = extractEticketsByPassenger(TRIP);
  const rishi = matchProviderEticket({ firstName: 'Rishi', lastName: 'Parihar', passengerType: 'adult' }, e);
  assert.equal(rishi?.eTicket, 'TKT529623');
  assert.notEqual(rishi?.eTicket, 'TKT529624');
});

test('the child and infant land on their own coupons too', () => {
  const e = extractEticketsByPassenger(TRIP);
  assert.equal(matchProviderEticket({ firstName: 'Ashish', lastName: 'Jain', passengerType: 'child' }, e)?.eTicket, 'TKT529624');
  assert.equal(matchProviderEticket({ firstName: 'Puja', lastName: 'Singh', passengerType: 'infant' }, e)?.eTicket, 'TKT529625');
});

test('our lower-case names match the provider\'s upper-case', () => {
  const e = extractEticketsByPassenger(TRIP);
  assert.equal(matchProviderEticket({ firstName: 'rishi', lastName: 'PARIHAR', passengerType: 'ADT' }, e)?.eTicket, 'TKT529623');
});

test('surnames shared across passengers still resolve by first name', () => {
  const trip = { Data: { TripDetailsResult: { TravelItinerary: { PassengerInfos: [
    { Passenger: { PassengerType: 'ADT', PaxName: { PassengerFirstName: 'KULDIP', PassengerLastName: 'KUMAR' } },
      ETickets: [{ ETicketNumber: 'TKT1', ETicketType: 'Ticketed' }] },
    { Passenger: { PassengerType: 'CHD', PaxName: { PassengerFirstName: 'KARTIK', PassengerLastName: 'KUMAR' } },
      ETickets: [{ ETicketNumber: 'TKT2', ETicketType: 'Ticketed' }] },
  ] } } } };
  const e = extractEticketsByPassenger(trip);
  assert.equal(matchProviderEticket({ firstName: 'Kuldip', lastName: 'Kumar', passengerType: 'adult' }, e)?.eTicket, 'TKT1');
  assert.equal(matchProviderEticket({ firstName: 'Kartik', lastName: 'kumar', passengerType: 'child' }, e)?.eTicket, 'TKT2');
});

test('a superseded coupon is never returned', () => {
  // A reissued booking carries both numbers; sending the dead one is itself an
  // "Eticket number is wrong".
  const trip = { Data: { TripDetailsResult: { TravelItinerary: { PassengerInfos: [
    { Passenger: { PassengerType: 'ADT', PaxName: { PassengerFirstName: 'A', PassengerLastName: 'B' } },
      ETickets: [
        { ETicketNumber: 'OLD1', ETicketType: 'Reissued' },
        { ETicketNumber: 'NEW1', ETicketType: 'Ticketed' },
      ] },
  ] } } } };
  const e = extractEticketsByPassenger(trip);
  assert.equal(e.length, 1);
  assert.equal(e[0].eTicket, 'NEW1');
});

test('a passenger with no live coupon is omitted, not given a blank', () => {
  const trip = { Data: { TripDetailsResult: { TravelItinerary: { PassengerInfos: [
    { Passenger: { PassengerType: 'ADT', PaxName: { PassengerFirstName: 'A', PassengerLastName: 'B' } },
      ETickets: [{ ETicketNumber: 'X', ETicketType: 'Voided' }] },
  ] } } } };
  assert.equal(extractEticketsByPassenger(trip).length, 0);
});

test('an unknown passenger matches nothing rather than the first entry', () => {
  // Returning a wrong coupon is worse than returning none: the PTR is rejected
  // either way, but a wrong one can be rejected against another traveller.
  const e = extractEticketsByPassenger(TRIP);
  assert.equal(matchProviderEticket({ firstName: 'Nobody', lastName: 'Here', passengerType: 'adult' }, e), null);
});

test('an empty or shapeless payload yields nothing and does not throw', () => {
  assert.deepEqual(extractEticketsByPassenger(null), []);
  assert.deepEqual(extractEticketsByPassenger({}), []);
  assert.deepEqual(extractEticketsByPassenger({ Data: { TripDetailsResult: {} } }), []);
  assert.equal(matchProviderEticket({ firstName: 'A', lastName: 'B', passengerType: 'ADT' }, []), null);
});

// ── Ticketed titles ─────────────────────────────────────────────────────────

test('the title comes back as ticketed, not as we would derive it', () => {
  // Air India stores this infant as MS. Our derived title is Miss, and
  // ReIssueQuote refuses it: "Passenger details are not matching for this
  // ticket number = TKT529625". Only the ticketed title matches.
  const trip = { Data: { TripDetailsResult: { TravelItinerary: { PassengerInfos: [
    { Passenger: { PassengerType: 'INF', NameNumber: 529625,
        PaxName: { PassengerTitle: 'MS', PassengerFirstName: 'PUJA', PassengerLastName: 'SINGH' } },
      ETickets: [{ ETicketNumber: 'TKT529625', ETicketType: 'Ticketed' }] },
  ] } } } };
  const e = extractEticketsByPassenger(trip);
  assert.equal(e[0].title, 'MS');
  assert.equal(
    matchProviderEticket({ firstName: 'Puja', lastName: 'Singh', passengerType: 'infant' }, e)?.title,
    'MS',
  );
});

test('a title the provider does not give stays empty rather than invented', () => {
  // The caller keeps its derived title in that case; an empty string here must
  // not overwrite a usable one.
  const e = extractEticketsByPassenger(TRIP);
  assert.equal(e[0].title, '');
});

console.log(`\n${passed} passed`);
