/**
 * Run: cd backend && npx tsx src/lib/connection-changes.test.ts
 *
 * FM0WD01L is the itinerary this exists for: DEL→JFK, then LGA→YYZ, on one PNR
 * and one fare. A taxi across New York with bags and a US immigration queue, and
 * nothing on the page said so — the flag the AIRPORT_CHANGE warning depends on
 * was hard-coded false in one path and read from `terminalChange` in the other.
 */
import assert from 'node:assert';
import {
  detectConnectionChanges, airportChangeLabel, airportChangeNotice,
} from './connection-changes';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const seg = (from: string, to: string, dep: string, arr: string, depT?: string, arrT?: string) => ({
  departure: { airport: from, time: dep, terminal: depT },
  arrival: { airport: to, time: arr, terminal: arrT },
});

// The real one.
const FM0WD01L = [
  seg('DEL', 'JFK', '2026-11-13T23:55:00', '2026-11-14T06:25:00'),
  seg('LGA', 'YYZ', '2026-11-14T11:04:00', '2026-11-14T13:01:00'),
];

console.log('connection changes');

test('the FM0WD01L case is detected — JFK in, LGA out', () => {
  const c = detectConnectionChanges(FM0WD01L);
  assert.equal(c.hasAirportChange, true);
  assert.equal(c.airportChanges.length, 1);
  assert.equal(c.airportChanges[0].from, 'JFK');
  assert.equal(c.airportChanges[0].to, 'LGA');
});

test('the connection time is computed across the change', () => {
  // 06:25 to 11:04 is 4h39m to cross New York.
  assert.equal(detectConnectionChanges(FM0WD01L).airportChanges[0].connectionMinutes, 279);
});

test('an ordinary same-airport connection raises nothing', () => {
  const c = detectConnectionChanges([
    seg('BOM', 'SIN', '2026-09-10T11:45:00', '2026-09-10T19:50:00'),
    seg('SIN', 'HKG', '2026-09-11T07:25:00', '2026-09-11T11:20:00'),
  ]);
  assert.equal(c.hasAirportChange, false);
  assert.equal(c.hasTerminalChange, false);
});

test('a terminal change is reported separately, not as an airport change', () => {
  // Conflating these is what hid the real thing: one flag meant both.
  const c = detectConnectionChanges([
    seg('BOM', 'SIN', '2026-09-10T11:45:00', '2026-09-10T19:50:00', '2', '0'),
    seg('SIN', 'HKG', '2026-09-11T07:25:00', '2026-09-11T11:20:00', '3', '1'),
  ]);
  assert.equal(c.hasAirportChange, false);
  assert.equal(c.hasTerminalChange, true);
  assert.equal(c.terminalChanges[0].airport, 'SIN');
  assert.equal(c.terminalChanges[0].from, '0');
  assert.equal(c.terminalChanges[0].to, '3');
});

test('an airport change subsumes any terminal difference', () => {
  // Naming both would be noise; crossing the city is the point.
  const c = detectConnectionChanges([
    seg('DEL', 'JFK', '2026-11-13T23:55:00', '2026-11-14T06:25:00', '3', '4'),
    seg('LGA', 'YYZ', '2026-11-14T11:04:00', '2026-11-14T13:01:00', 'B', 'C'),
  ]);
  assert.equal(c.airportChanges.length, 1);
  assert.equal(c.terminalChanges.length, 0);
});

test('several changes on one itinerary are all found', () => {
  const c = detectConnectionChanges([
    seg('LHR', 'JFK', '2026-01-01T09:00:00', '2026-01-01T12:00:00'),
    seg('EWR', 'ORD', '2026-01-01T16:00:00', '2026-01-01T18:00:00'),
    seg('MDW', 'LAX', '2026-01-01T21:00:00', '2026-01-01T23:00:00'),
  ]);
  assert.equal(c.airportChanges.length, 2);
  assert.deepEqual(c.airportChanges.map((x) => `${x.from}>${x.to}`), ['JFK>EWR', 'ORD>MDW']);
});

test('casing and whitespace do not create a false change', () => {
  const c = detectConnectionChanges([
    { departure: { airport: 'del' }, arrival: { airport: ' jfk ' } },
    { departure: { airport: 'JFK' }, arrival: { airport: 'YYZ' } },
  ]);
  assert.equal(c.hasAirportChange, false);
});

// ── Copy ────────────────────────────────────────────────────────────────────

test('the tile label names both airports', () => {
  assert.equal(airportChangeLabel(detectConnectionChanges(FM0WD01L)), 'Airport change JFK → LGA');
});

test('multiple changes are counted rather than listed on a tile', () => {
  const c = detectConnectionChanges([
    seg('LHR', 'JFK', '', ''), seg('EWR', 'ORD', '', ''), seg('MDW', 'LAX', '', ''),
  ]);
  assert.equal(airportChangeLabel(c), 'Airport change JFK → EWR +1 more');
});

test('the confirmation notice says what to DO, not what to avoid', () => {
  // Before booking it is a warning; afterwards it is logistics. Telling someone
  // holding a ticket to consider another flight helps nobody.
  const notice = airportChangeNotice(detectConnectionChanges(FM0WD01L))!;
  assert.match(notice, /arrive at JFK and depart from LGA/);
  assert.match(notice, /collect your bags/);
  assert.match(notice, /4h 39m/);
  assert.doesNotMatch(notice, /choose|different flight|instead/i);
});

test('nothing to say yields null rather than an empty banner', () => {
  const none = detectConnectionChanges([seg('DEL', 'BOM', '', '')]);
  assert.equal(airportChangeLabel(none), null);
  assert.equal(airportChangeNotice(none), null);
});

test('missing or malformed input does not throw', () => {
  assert.equal(detectConnectionChanges(null).hasAirportChange, false);
  assert.equal(detectConnectionChanges([]).hasAirportChange, false);
  assert.equal(detectConnectionChanges([{}, {}] as any).hasAirportChange, false);
});

console.log(`\n${passed} passed`);
