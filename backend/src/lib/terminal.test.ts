/**
 * Run: cd backend && npx tsx src/lib/terminal.test.ts
 *
 * FM4OW3RM is the booking this exists for. TripDetails returned DEL T3 → JFK T8,
 * then LGA Terminal B → YYZ T3 — a walk between two New York airports — and the
 * confirmation page, the itinerary email, the download and both consoles all
 * showed nothing, because Mystifly's SEARCH response has no terminal field and
 * that is what book time persists. 0 of 86 production segments had a terminal.
 *
 * The risk in fixing it is misassignment. A round trip is held as two segment
 * arrays and arrives from the provider as one flat list, so index 1 means
 * different legs on the two sides; a terminal put on the wrong leg is worse than
 * no terminal, because a passenger acts on it.
 */
import assert from 'node:assert';
import {
  terminalOf, terminalLabel, terminalShort, terminalAndGate,
  segmentRouteWithTerminals, applySegmentTerminals,
} from './terminal';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const seg = (from: string, to: string) => ({
  departure: { airport: from }, arrival: { airport: to },
}) as any;

console.log('terminals');

// ── Reading a terminal ──────────────────────────────────────────────────────

test('"0" is a real terminal and survives', () => {
  // Singapore and others use Terminal 0. A truthiness check on the raw value
  // drops it, and the passenger is sent to find a terminal we declined to name.
  assert.equal(terminalOf('0'), '0');
  assert.equal(terminalShort('0'), 'T0');
  assert.equal(terminalLabel('0'), 'Terminal 0');
});

test('letters work as well as numbers — LGA Terminal B', () => {
  assert.equal(terminalShort('B'), 'TB');
  assert.equal(terminalLabel('B'), 'Terminal B');
});

test('nothing to say yields null, never an empty label', () => {
  for (const v of [null, undefined, '', '   ']) {
    assert.equal(terminalOf(v), null, `for ${JSON.stringify(v)}`);
    assert.equal(terminalLabel(v), null);
    assert.equal(terminalShort(v), null);
  }
});

test('a provider that sends the word does not produce "Terminal Terminal 3"', () => {
  for (const v of ['Terminal 3', 'TERMINAL 3', 'T3', 'term 3', 'Terminal: 3']) {
    assert.equal(terminalLabel(v), 'Terminal 3', `for "${v}"`);
  }
});

test('whitespace is trimmed rather than rendered', () => {
  assert.equal(terminalShort('  3 '), 'T3');
});

// ── Route + terminal ────────────────────────────────────────────────────────

test('a terminal is never shown detached from its airport', () => {
  assert.equal(
    segmentRouteWithTerminals({ originAirport: 'DEL', originTerminal: '3', destinationAirport: 'JFK', destinationTerminal: '8' }),
    'DEL T3 → JFK T8');
});

test('the offer field names work too', () => {
  assert.equal(
    segmentRouteWithTerminals({ departure: { airport: 'LGA', terminal: 'B' }, arrival: { airport: 'YYZ', terminal: '3' } }),
    'LGA TB → YYZ T3');
});

test('a partial terminal still names both airports', () => {
  assert.equal(
    segmentRouteWithTerminals({ originAirport: 'DEL', destinationAirport: 'JFK', destinationTerminal: '8' }),
    'DEL → JFK T8');
});

test('no airports means no string rather than " → "', () => {
  assert.equal(segmentRouteWithTerminals({}), null);
  assert.equal(segmentRouteWithTerminals(null), null);
});

test('a gate is reported as a gate, not as a terminal', () => {
  assert.equal(terminalAndGate('8', 'B22'), 'Terminal 8 · Gate B22');
  assert.equal(terminalAndGate(null, 'B22'), 'Gate B22');
  assert.equal(terminalAndGate('8', null), 'Terminal 8');
  assert.equal(terminalAndGate(null, null), null);
});

// ── Applying provider terminals — the misassignment risk ────────────────────

const FM4OW3RM = () => ({
  outboundJourney: { segments: [seg('DEL', 'JFK'), seg('LGA', 'YYZ')] },
  returnJourney:   { segments: [seg('YYZ', 'LGA'), seg('JFK', 'DEL')] },
});

const PROVIDER = [
  { origin: 'DEL', destination: 'JFK', originTerminal: '3', destinationTerminal: '8' },
  { origin: 'LGA', destination: 'YYZ', originTerminal: 'B', destinationTerminal: '3' },
  { origin: 'YYZ', destination: 'LGA', originTerminal: '3', destinationTerminal: 'B' },
  { origin: 'JFK', destination: 'DEL', originTerminal: '8', destinationTerminal: '3' },
];

test('the real FM4OW3RM itinerary lands on the right legs', () => {
  const rt = FM4OW3RM();
  const n = applySegmentTerminals(null, rt, PROVIDER);
  assert.equal(n, 8);
  assert.equal(rt.outboundJourney.segments[0].departure.terminal, '3');   // DEL
  assert.equal(rt.outboundJourney.segments[0].arrival.terminal, '8');     // JFK
  assert.equal(rt.outboundJourney.segments[1].departure.terminal, 'B');   // LGA
  assert.equal(rt.returnJourney.segments[1].arrival.terminal, '3');       // DEL
});

test('return terminals do not land on the outbound', () => {
  // Positional pairing would do exactly this: the provider list is flat, ours
  // is two arrays, so provider[2] (YYZ→LGA, a RETURN leg) would be written onto
  // outbound index 2 if anything counted rather than matched.
  const rt = FM4OW3RM();
  applySegmentTerminals(null, rt, PROVIDER);
  assert.equal(rt.returnJourney.segments[0].departure.terminal, '3');     // YYZ
  assert.equal(rt.returnJourney.segments[0].arrival.terminal, 'B');       // LGA
});

test('a route flown twice consumes terminals in provider order', () => {
  const flight = { segments: [seg('BOM', 'DXB'), seg('BOM', 'DXB')] } as any;
  applySegmentTerminals(flight, null, [
    { origin: 'BOM', destination: 'DXB', originTerminal: '2', destinationTerminal: '1' },
    { origin: 'BOM', destination: 'DXB', originTerminal: '2', destinationTerminal: '3' },
  ]);
  assert.equal(flight.segments[0].arrival.terminal, '1');
  assert.equal(flight.segments[1].arrival.terminal, '3');
});

test('a route the provider never mentioned is left alone', () => {
  const flight = { segments: [seg('DEL', 'BOM')] } as any;
  applySegmentTerminals(flight, null, PROVIDER);
  assert.equal(flight.segments[0].departure.terminal, undefined);
});

test('one-way segments are handled', () => {
  const flight = { segments: [seg('DEL', 'JFK')] } as any;
  assert.equal(applySegmentTerminals(flight, null, PROVIDER), 2);
  assert.equal(flight.segments[0].departure.terminal, '3');
});

test('casing and padding in the route do not prevent a match', () => {
  const flight = { segments: [{ departure: { airport: ' del ' }, arrival: { airport: 'jfk' } }] } as any;
  applySegmentTerminals(flight, null, PROVIDER);
  assert.equal(flight.segments[0].departure.terminal, '3');
});

test('a provider that sends no terminals changes nothing', () => {
  const rt = FM4OW3RM();
  assert.equal(applySegmentTerminals(null, rt, []), 0);
  assert.equal(applySegmentTerminals(null, rt, null), 0);
  assert.equal(applySegmentTerminals(null, rt, undefined), 0);
  assert.equal(rt.outboundJourney.segments[0].departure.terminal, undefined);
});

test('a half-known leg writes only the half it knows', () => {
  const flight = { segments: [seg('DEL', 'JFK')] } as any;
  applySegmentTerminals(flight, null, [
    { origin: 'DEL', destination: 'JFK', originTerminal: null, destinationTerminal: '8' },
  ]);
  assert.equal(flight.segments[0].departure.terminal, undefined);
  assert.equal(flight.segments[0].arrival.terminal, '8');
});

test('malformed input does not throw', () => {
  assert.doesNotThrow(() => applySegmentTerminals(null, null, PROVIDER));
  assert.doesNotThrow(() => applySegmentTerminals({}, {}, PROVIDER));
  assert.doesNotThrow(() => applySegmentTerminals({ segments: [{}] }, null, PROVIDER));
});

console.log(`\n${passed} passed`);
