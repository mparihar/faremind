/**
 * Run: npx tsx src/lib/providers/__tests__/rt-flat-split.test.ts
 *
 * The production round-trip path. The backend returns a round trip as ONE
 * one-way-normalised flight containing every segment of both legs, so the
 * outbound/return boundary is recovered here.
 *
 * Booking FMM1FLR7 is the case that broke it. Segments:
 *
 *   DEL→JFK   LGA→YYZ   YYZ→LGA   JFK→DEL
 *
 * The old rule matched `segments[i].departure === segments[0].arrival` and so
 * fired on the LAST segment — it departs JFK, and the first segment arrives JFK
 * — splitting 3 + 1. The customer's outbound then read DEL→LGA across 23 days
 * with a 529-hour "layover", and the trip was labelled DEL⇄LGA, not DEL⇄YYZ.
 */
import assert from 'node:assert';
import { __testing } from '../mystifly-client';

const { findReturnLegStart } = __testing;

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const seg = (from: string, to: string, dep: string, arr: string) => ({
  id: `${from}${to}`,
  departure: { airport: from, airportName: from, city: from, time: dep },
  arrival: { airport: to, airportName: to, city: to, time: arr },
  airline: { code: 'AA', name: 'American Airlines' },
  flightNumber: 'AA000', duration: 120,
}) as any;

console.log('round-trip boundary in a flat segment list');

test('FMM1FLR7 splits 2 + 2, not 3 + 1', () => {
  const segs = [
    seg('DEL', 'JFK', '2026-10-13T23:30:00', '2026-10-14T06:10:00'),
    seg('LGA', 'YYZ', '2026-10-14T10:18:00', '2026-10-14T12:07:00'),
    seg('YYZ', 'LGA', '2026-11-05T13:45:00', '2026-11-05T15:28:00'),
    seg('JFK', 'DEL', '2026-11-05T20:35:00', '2026-11-06T21:35:00'),
  ];
  assert.equal(findReturnLegStart(segs, 'YYZ'), 2, 'return starts at the YYZ departure');
});

test('the destination signal beats the airport-code coincidence', () => {
  // The trap: the last segment departs JFK and the first arrives JFK.
  const segs = [
    seg('DEL', 'JFK', '2026-10-13T23:30:00', '2026-10-14T06:10:00'),
    seg('LGA', 'YYZ', '2026-10-14T10:18:00', '2026-10-14T12:07:00'),
    seg('YYZ', 'LGA', '2026-11-05T13:45:00', '2026-11-05T15:28:00'),
    seg('JFK', 'DEL', '2026-11-05T20:35:00', '2026-11-06T21:35:00'),
  ];
  assert.notEqual(findReturnLegStart(segs, 'YYZ'), 3, 'must not split at the final segment');
});

test('a plain round trip splits down the middle', () => {
  const segs = [
    seg('DEL', 'JFK', '2026-10-13T23:30:00', '2026-10-14T06:10:00'),
    seg('JFK', 'YYZ', '2026-10-14T10:18:00', '2026-10-14T12:07:00'),
    seg('YYZ', 'JFK', '2026-11-05T13:45:00', '2026-11-05T15:28:00'),
    seg('JFK', 'DEL', '2026-11-05T20:35:00', '2026-11-06T21:35:00'),
  ];
  assert.equal(findReturnLegStart(segs, 'YYZ'), 2);
});

test('a non-stop each way splits after the first segment', () => {
  const segs = [
    seg('DEL', 'BOM', '2026-11-18T06:00:00', '2026-11-18T08:00:00'),
    seg('BOM', 'DEL', '2026-12-05T18:00:00', '2026-12-05T20:00:00'),
  ];
  assert.equal(findReturnLegStart(segs, 'BOM'), 1);
});

test('without a destination it falls back to the longest gap', () => {
  const segs = [
    seg('DEL', 'JFK', '2026-10-13T23:30:00', '2026-10-14T06:10:00'),
    seg('LGA', 'YYZ', '2026-10-14T10:18:00', '2026-10-14T12:07:00'),
    seg('YYZ', 'LGA', '2026-11-05T13:45:00', '2026-11-05T15:28:00'),
    seg('JFK', 'DEL', '2026-11-05T20:35:00', '2026-11-06T21:35:00'),
  ];
  assert.equal(findReturnLegStart(segs, undefined), 2, 'the 22-day stay is the boundary');
});

test('a long layover under the stay threshold does not split the leg', () => {
  // 8h at JFK is a wait, not a holiday.
  const segs = [
    seg('DEL', 'JFK', '2026-10-13T23:30:00', '2026-10-14T06:10:00'),
    seg('JFK', 'YYZ', '2026-10-14T14:10:00', '2026-10-14T16:00:00'),
    seg('YYZ', 'DEL', '2026-11-05T20:35:00', '2026-11-06T21:35:00'),
  ];
  assert.equal(findReturnLegStart(segs, 'YYZ'), 2, 'return starts at the YYZ departure, not mid-outbound');
});

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES ABOVE' : ''}`);
