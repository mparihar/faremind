/**
 * Run: cd backend && npx tsx --test src/services/itinerary-sync.test.ts
 *
 * The fixture is the real TripDetails shape for MF35472726 (FMVTT9ZQ / E7MZOA)
 * after its reissue. It is the case that matters: the provider returns the new
 * itinerary AND the one it replaced, every segment reads FlightStatus "HK", and
 * the ItemRPH values repeat across the two groups. Only Itineraries[].Type tells
 * them apart. Taking all of them would have produced four segments against our
 * two — and if the counts had lined up, written the superseded flights over the
 * live ones.
 */
import assert from 'node:assert';
import { mapProviderSegments, pairByRoute } from './itinerary-sync';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const seg = (flightNumber: string, from: string, to: string, dep: string, arr: string) => ({
  FlightNumber: flightNumber, MarketingAirlineCode: 'AI', OperatingAirlineCode: 'AI',
  DepartureAirportLocationCode: from, ArrivalAirportLocationCode: to,
  DepartureDateTime: dep, ArrivalDateTime: arr,
  CabinClass: 'Y', FlightStatus: 'HK', AirlinePNR: 'E7MZOA',
});

/** MF35472726 as the provider actually returns it post-reissue. */
const REISSUED = {
  Data: { TripDetailsResult: { TravelItinerary: {
    MFRef: 'MF35472726', TicketStatus: 'Ticketed',
    Itineraries: [
      { Type: 'TravelItinerary', ItineraryInfo: { ReservationItems: [
        { ...seg('1745', 'DEL', 'BOM', '2026-12-02T05:25:00', '2026-12-02T07:50:00'), ItemRPH: 1 },
        { ...seg('2422', 'BOM', 'DEL', '2026-12-10T01:00:00', '2026-12-10T03:15:00'), ItemRPH: 2 },
      ] } },
      { Type: 'ExchangedItinerary', ItineraryInfo: { ReservationItems: [
        { ...seg('1785', 'DEL', 'BOM', '2026-11-14T12:00:00', '2026-11-14T14:20:00'), ItemRPH: 1 },
        { ...seg('1851', 'BOM', 'DEL', '2026-12-12T15:35:00', '2026-12-12T18:00:00'), ItemRPH: 2 },
      ] } },
    ],
  } } },
};

console.log('a reissued booking');

test('only the current itinerary is returned', () => {
  const segs = mapProviderSegments(REISSUED);
  assert.equal(segs.length, 2, 'the exchanged pair must not be included');
  assert.deepEqual(segs.map((s) => s.flightNumber), ['1745', '2422']);
});

test('the superseded flights are never produced', () => {
  const numbers = mapProviderSegments(REISSUED).map((s) => s.flightNumber);
  assert.ok(!numbers.includes('1785'), '1785 is the exchanged flight');
  assert.ok(!numbers.includes('1851'), '1851 is the exchanged flight');
});

test('dates come from the current itinerary, not the replaced one', () => {
  const [out] = mapProviderSegments(REISSUED);
  // The stored row says 14 Nov; the live ticket is 2 Dec. Getting this backwards
  // would send a passenger to the airport three weeks early.
  // Pinned to UTC: `new Date('2026-12-02T05:25:00')` would resolve against the
  // runner's zone, so this assertion would pass in CI and drift in production.
  assert.equal(out.departureDateTime!.toISOString(), '2026-12-02T05:25:00.000Z');
});

test('fields map across', () => {
  const [out] = mapProviderSegments(REISSUED);
  assert.equal(out.airlineCode, 'AI');
  assert.equal(out.originAirport, 'DEL');
  assert.equal(out.destinationAirport, 'BOM');
  assert.equal(out.cabin, 'Y');
});

console.log('\nthe shapes that are not reissues');

test('a single untyped itinerary group is taken as-is', () => {
  const plain = { Data: { TripDetailsResult: { TravelItinerary: { Itineraries: [
    { ItineraryInfo: { ReservationItems: [seg('1735', 'DEL', 'PNQ', '2026-08-19T13:10:00', '2026-08-19T15:15:00')] } },
  ] } } } };
  assert.deepEqual(mapProviderSegments(plain).map((s) => s.flightNumber), ['1735']);
});

test('the legacy bare ItineraryInfo shape still works', () => {
  const legacy = { Data: { TripDetailsResult: { TravelItinerary: {
    ItineraryInfo: { ReservationItems: [seg('1735', 'DEL', 'PNQ', '2026-08-19T13:10:00', '2026-08-19T15:15:00')] },
  } } } };
  assert.deepEqual(mapProviderSegments(legacy).map((s) => s.flightNumber), ['1735']);
});

test('an itinerary of only exchanged groups yields nothing rather than the old flights', () => {
  const onlyExchanged = { Data: { TripDetailsResult: { TravelItinerary: { Itineraries: [
    { Type: 'ExchangedItinerary', ItineraryInfo: { ReservationItems: [seg('1785', 'DEL', 'BOM', '2026-11-14T12:00:00', '2026-11-14T14:20:00')] } },
  ] } } } };
  // Returning nothing makes the caller skip; returning the old flights would
  // overwrite the live ones with superseded data.
  assert.deepEqual(mapProviderSegments(onlyExchanged), []);
});

test('junk yields no segments rather than throwing', () => {
  for (const v of [null, undefined, {}, { Data: {} }, 'nope', 42]) {
    assert.deepEqual(mapProviderSegments(v as any), [], JSON.stringify(v));
  }
});

test('items missing a flight number or airports are dropped', () => {
  const partial = { Data: { TripDetailsResult: { TravelItinerary: { Itineraries: [
    { Type: 'TravelItinerary', ItineraryInfo: { ReservationItems: [
      { ...seg('1745', 'DEL', 'BOM', '2026-12-02T05:25:00', '2026-12-02T07:50:00') },
      { ...seg('', 'DEL', 'BOM', '2026-12-02T05:25:00', '2026-12-02T07:50:00') },
      { ...seg('9999', '', 'BOM', '2026-12-02T05:25:00', '2026-12-02T07:50:00') },
    ] } },
  ] } } } };
  assert.deepEqual(mapProviderSegments(partial).map((s) => s.flightNumber), ['1745']);
});

console.log('\npairing stored segments to the provider\'s');

const st = (o: string, d: string, order = 0) =>
  ({ originAirport: o, destinationAirport: d, segmentOrder: order });

test('routes match regardless of the order rows come back in', () => {
  // FMVTT9ZQ carries segmentOrder 0 on BOTH rows, so the query order is
  // arbitrary — positional pairing would put the return flight on the outbound
  // leg. Route matching does not care what order they arrive in.
  const stored = [st('BOM', 'DEL'), st('DEL', 'BOM')];
  const pairs = pairByRoute(stored, mapProviderSegments(REISSUED));
  assert.ok(pairs, 'same routing must pair');
  for (const [s, p] of pairs!) {
    assert.equal(s.originAirport, p.originAirport);
    assert.equal(s.destinationAirport, p.destinationAirport);
  }
});

test('a genuine re-routing declines to match, so the caller falls back', () => {
  const stored = [st('DEL', 'BOM'), st('BOM', 'DEL')];
  const rerouted = mapProviderSegments({ Data: { TripDetailsResult: { TravelItinerary: { Itineraries: [
    { Type: 'TravelItinerary', ItineraryInfo: { ReservationItems: [
      seg('900', 'DEL', 'GOI', '2026-12-02T05:25:00', '2026-12-02T07:50:00'),
      seg('901', 'GOI', 'DEL', '2026-12-10T01:00:00', '2026-12-10T03:15:00'),
    ] } },
  ] } } } });
  assert.equal(pairByRoute(stored, rerouted), null);
});

test('a repeated route consumes each stored row once', () => {
  const stored = [st('DEL', 'BOM', 0), st('DEL', 'BOM', 1)];
  const twice = mapProviderSegments({ Data: { TripDetailsResult: { TravelItinerary: { Itineraries: [
    { Type: 'TravelItinerary', ItineraryInfo: { ReservationItems: [
      seg('11', 'DEL', 'BOM', '2026-12-02T05:25:00', '2026-12-02T07:50:00'),
      seg('22', 'DEL', 'BOM', '2026-12-05T05:25:00', '2026-12-05T07:50:00'),
    ] } },
  ] } } } });
  const pairs = pairByRoute(stored, twice);
  assert.equal(pairs!.length, 2);
  assert.notEqual(pairs![0][0], pairs![1][0], 'a stored row must not be paired twice');
});

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES ABOVE' : ''}`);
