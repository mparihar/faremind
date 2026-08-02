/**
 * Run: npx tsx src/lib/providers/__tests__/rt-journey-split.test.ts
 *
 * Booking FMM1FLR7 (AA, DEL-YYZ 13 Oct / 5 Nov 2026) came back from search with
 * a return segment inside the outbound OD option, so the confirmation told the
 * customer their trip was DEL to LGA, over 23 days, with a 529-hour "layover".
 */
import assert from 'node:assert';
import { normalizeMystiflyRoundTripOffer } from '../mystifly-round-trip-normalizer';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const seg = (fn: string, from: string, to: string, dep: string, arr: string) => ({
  MarketingAirlineCode: 'AA', OperatingAirlineCode: 'AA', FlightNumber: fn,
  DepartureAirportLocationCode: from, ArrivalAirportLocationCode: to,
  DepartureDateTime: dep, ArrivalDateTime: arr,
  CabinClassCode: 'Y', JourneyDuration: '120', Baggage: '1PC',
});

/** Exactly what the provider returned for FMM1FLR7: grouped 3 + 1. */
const misgrouped = {
  FareSourceCode: 'FSC-TEST',
  ValidatingAirlineCode: 'AA',
  AirItineraryPricingInfo: { ItinTotalFare: { TotalFare: { Amount: '2032.14', CurrencyCode: 'USD' } } },
  OriginDestinationOptions: [
    { FlightSegments: [
      seg('293',  'DEL', 'JFK', '2026-10-13T23:30:00', '2026-10-14T06:10:00'),
      seg('4623', 'LGA', 'YYZ', '2026-10-14T10:18:00', '2026-10-14T12:07:00'),
      seg('4623', 'YYZ', 'LGA', '2026-11-05T13:45:00', '2026-11-05T15:28:00'),
    ] },
    { FlightSegments: [
      seg('292', 'JFK', 'DEL', '2026-11-05T20:35:00', '2026-11-06T21:35:00'),
    ] },
  ],
};

console.log('round-trip journey split');

test('a 22-day gap is treated as the destination stay, not a layover', () => {
  const o = normalizeMystiflyRoundTripOffer(misgrouped);
  assert.ok(o, 'offer should normalize');
  assert.equal(o!.outboundJourney.segments.length, 2, 'outbound keeps DEL-JFK and LGA-YYZ');
  assert.equal(o!.returnJourney.segments.length, 2, 'return gains YYZ-LGA alongside JFK-DEL');
});

test('the outbound now ends at the destination the customer searched', () => {
  const o = normalizeMystiflyRoundTripOffer(misgrouped);
  assert.equal(o!.outboundJourney.departureAirport, 'DEL');
  assert.equal(o!.outboundJourney.arrivalAirport, 'YYZ', 'was LGA — the trip read as DEL-LGA');
});

test('the return starts at the destination and ends home', () => {
  const o = normalizeMystiflyRoundTripOffer(misgrouped);
  assert.equal(o!.returnJourney.departureAirport, 'YYZ');
  assert.equal(o!.returnJourney.arrivalAirport, 'DEL');
});

test('the outbound no longer spans 23 days', () => {
  const o = normalizeMystiflyRoundTripOffer(misgrouped);
  const hours = (new Date(o!.outboundJourney.arrivalTime).getTime()
    - new Date(o!.outboundJourney.departureTime).getTime()) / 3_600_000;
  assert.ok(hours < 48, `outbound spanned ${Math.round(hours)}h`);
});

test('a normal round trip is left exactly as the provider grouped it', () => {
  const normal = {
    ...misgrouped,
    OriginDestinationOptions: [
      { FlightSegments: [
        seg('293',  'DEL', 'JFK', '2026-10-13T23:30:00', '2026-10-14T06:10:00'),
        seg('4623', 'JFK', 'YYZ', '2026-10-14T10:18:00', '2026-10-14T12:07:00'),
      ] },
      { FlightSegments: [
        seg('4624', 'YYZ', 'JFK', '2026-11-05T13:45:00', '2026-11-05T15:28:00'),
        seg('292',  'JFK', 'DEL', '2026-11-05T20:35:00', '2026-11-06T21:35:00'),
      ] },
    ],
  };
  const o = normalizeMystiflyRoundTripOffer(normal);
  assert.equal(o!.outboundJourney.segments.length, 2);
  assert.equal(o!.returnJourney.segments.length, 2);
  assert.equal(o!.outboundJourney.arrivalAirport, 'YYZ');
});

test('a same-day 8-hour connection is still a layover, not a boundary', () => {
  const longConnection = {
    ...misgrouped,
    OriginDestinationOptions: [
      { FlightSegments: [
        seg('293',  'DEL', 'JFK', '2026-10-13T23:30:00', '2026-10-14T06:10:00'),
        seg('4623', 'JFK', 'YYZ', '2026-10-14T14:10:00', '2026-10-14T16:00:00'),
      ] },
      { FlightSegments: [seg('292', 'YYZ', 'DEL', '2026-11-05T20:35:00', '2026-11-06T21:35:00')] },
    ],
  };
  const o = normalizeMystiflyRoundTripOffer(longConnection);
  assert.equal(o!.outboundJourney.segments.length, 2, 'an 8h connection must not split the journey');
});

// ── The guarantee: we regroup the provider's segments, never author our own ──

test('every segment is the one the provider sent, in the order it sent them', () => {
  const providerOrder = [
    ...misgrouped.OriginDestinationOptions[0].FlightSegments,
    ...misgrouped.OriginDestinationOptions[1].FlightSegments,
  ];
  const o = normalizeMystiflyRoundTripOffer(misgrouped);
  const ours: any[] = [...o!.outboundJourney.segments, ...o!.returnJourney.segments];

  assert.equal(ours.length, providerOrder.length, 'no segment added or dropped');
  ours.forEach((seg, i) => {
    const p = providerOrder[i];
    assert.ok(String(seg.flightNumber).includes(p.FlightNumber), `segment ${i} flight number`);
    assert.equal(seg.departure.airport, p.DepartureAirportLocationCode, `segment ${i} origin`);
    assert.equal(seg.arrival.airport, p.ArrivalAirportLocationCode, `segment ${i} destination`);
    assert.equal(seg.departure.time, p.DepartureDateTime, `segment ${i} departure time`);
    assert.equal(seg.arrival.time, p.ArrivalDateTime, `segment ${i} arrival time`);
  });
});

test('no phantom segment is invented for the New York airport change', () => {
  // JFK → LGA is covered on the ground by the passenger. It is not a flight and
  // must never be rendered as one.
  const o = normalizeMystiflyRoundTripOffer(misgrouped);
  const all: any[] = [...o!.outboundJourney.segments, ...o!.returnJourney.segments];
  assert.equal(all.length, 4, 'exactly the four segments the airline sold');
  const ground = all.find((s) =>
    (s.departure.airport === 'JFK' && s.arrival.airport === 'LGA')
    || (s.departure.airport === 'LGA' && s.arrival.airport === 'JFK'));
  assert.equal(ground, undefined, 'the ground transfer must not appear as a flight');
});

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES ABOVE' : ''}`);
