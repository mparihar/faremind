/**
 * Run: npx tsx src/lib/__tests__/journey-time.test.ts
 *
 * Providers send local airport times with no offset. Subtracting them treats
 * both clocks as one, so a DEL→YYZ journey read 15h09m for a 24h39m trip, and
 * the same trip reversed read 34h03m for 24h33m — understated eastbound and
 * overstated westbound by the 9h30m between the two zones.
 */
import assert from 'node:assert';
import { airportTimeZone, allKnownZones } from '../airport-timezones';
import { airportEpochMs, elapsedMinutes, journeyDurationMinutes } from '../journey-time';
import { AIRPORTS } from '@/data/airports';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err: any) { console.error(`  FAIL  ${name}\n        ${err.message}`); process.exitCode = 1; }
}

const at = (time: string, airport: string) => ({ time, airport });

console.log('airport timezones');

test('every declared zone is one this runtime accepts', () => {
  for (const zone of allKnownZones()) {
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: zone }), zone);
  }
});

test('every airport in the table resolves to a zone', () => {
  const missing = (AIRPORTS as any[]).filter((a) => !airportTimeZone(a.code, a.country));
  assert.equal(missing.length, 0, `unmapped: ${missing.map((a) => a.code).join(' ')}`);
});

test('an unknown code returns null rather than a guess', () => {
  assert.equal(airportTimeZone('ZZZ'), null);
  assert.equal(airportTimeZone(''), null);
  assert.equal(airportTimeZone(null), null);
});

test('airports that differ from their country are mapped individually', () => {
  // Phoenix keeps no DST; the rest of Mountain time does.
  assert.equal(airportTimeZone('PHX'), 'America/Phoenix');
  assert.equal(airportTimeZone('DEN'), 'America/Denver');
  // Four US zones plus Hawaii and Alaska.
  assert.equal(airportTimeZone('JFK'), 'America/New_York');
  assert.equal(airportTimeZone('ORD'), 'America/Chicago');
  assert.equal(airportTimeZone('LAX'), 'America/Los_Angeles');
  assert.equal(airportTimeZone('HNL'), 'Pacific/Honolulu');
  assert.equal(airportTimeZone('ANC'), 'America/Anchorage');
});

console.log('\nlocal time → instant');

const offsetMinutes = (local: string, code: string) => {
  const zone = airportTimeZone(code)!;
  return Math.round((Date.parse(`${local}:00Z`) - airportEpochMs(local, zone)!) / 60000);
};

test('whole, half and quarter-hour offsets all resolve', () => {
  assert.equal(offsetMinutes('2026-09-24T10:00', 'LHR'), 60);    // BST
  assert.equal(offsetMinutes('2026-09-24T10:00', 'DEL'), 330);   // IST, +5:30
  assert.equal(offsetMinutes('2026-09-24T10:00', 'KTM'), 345);   // Nepal, +5:45
  assert.equal(offsetMinutes('2026-09-24T10:00', 'SIN'), 480);
});

test('daylight saving is applied for the date in question', () => {
  assert.equal(offsetMinutes('2026-07-15T12:00', 'JFK'), -240);  // EDT
  assert.equal(offsetMinutes('2026-01-15T12:00', 'JFK'), -300);  // EST
  assert.equal(offsetMinutes('2026-01-15T12:00', 'SYD'), 660);   // AEDT
  assert.equal(offsetMinutes('2026-07-15T12:00', 'SYD'), 600);   // AEST
  // Phoenix never shifts.
  assert.equal(offsetMinutes('2026-07-15T12:00', 'PHX'), -420);
  assert.equal(offsetMinutes('2026-01-15T12:00', 'PHX'), -420);
});

console.log('\nthe reported journey');

test('DEL → YYZ is 24h39m, not the 15h09m we showed', () => {
  const m = elapsedMinutes(at('2026-09-23T23:30:00', 'DEL'), at('2026-09-24T14:39:00', 'YYZ'));
  assert.equal(m, 24 * 60 + 39);
});

test('YYZ → DEL is 24h33m, not the 34h03m we showed', () => {
  const m = elapsedMinutes(at('2026-10-08T10:57:00', 'YYZ'), at('2026-10-09T21:00:00', 'DEL'));
  assert.equal(m, 24 * 60 + 33);
});

test('the two directions are within an hour of each other, as they must be', () => {
  const out = elapsedMinutes(at('2026-09-23T23:30:00', 'DEL'), at('2026-09-24T14:39:00', 'YYZ'))!;
  const back = elapsedMinutes(at('2026-10-08T10:57:00', 'YYZ'), at('2026-10-09T21:00:00', 'DEL'))!;
  assert.ok(Math.abs(out - back) < 60, `${out} vs ${back}`);
});

test('a same-zone hop is unaffected', () => {
  // DEL → BOM, both Asia/Kolkata. 06:00 to 08:10 is 2h10m either way you count.
  const m = elapsedMinutes(at('2026-11-18T06:00:00', 'DEL'), at('2026-11-18T08:10:00', 'BOM'));
  assert.equal(m, 130);
});

console.log('\nfalling back rather than guessing');

test('an unknown airport yields null so the caller keeps its own value', () => {
  assert.equal(elapsedMinutes(at('2026-09-23T23:30:00', 'DEL'), at('2026-09-24T14:39:00', 'ZZZ')), null);
  assert.equal(elapsedMinutes(at('2026-09-23T23:30:00', 'ZZZ'), at('2026-09-24T14:39:00', 'YYZ')), null);
});

test('unreadable or reversed times yield null, never a negative duration', () => {
  assert.equal(elapsedMinutes(at('not-a-date', 'DEL'), at('2026-09-24T14:39:00', 'YYZ')), null);
  assert.equal(elapsedMinutes(at('', 'DEL'), at('2026-09-24T14:39:00', 'YYZ')), null);
  // Arrival before departure — data we cannot trust.
  assert.equal(elapsedMinutes(at('2026-09-24T14:39:00', 'YYZ'), at('2026-09-23T23:30:00', 'DEL')), null);
});

test('journeyDurationMinutes spans first departure to last arrival', () => {
  const segments = [
    { departure: at('2026-09-23T23:30:00', 'DEL'), arrival: at('2026-09-24T06:10:00', 'JFK') },
    { departure: at('2026-09-24T12:56:00', 'LGA'), arrival: at('2026-09-24T14:39:00', 'YYZ') },
  ];
  assert.equal(journeyDurationMinutes(segments), 24 * 60 + 39);
  assert.equal(journeyDurationMinutes([]), null);
});

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES ABOVE' : ''}`);
