/**
 * Audit (and if needed repair) flight timestamps against the provider strings.
 *
 *   PROD_DB_URL="postgres://…" node backend/scripts/backfill-flight-times.mjs           # dry run
 *   PROD_DB_URL="postgres://…" node backend/scripts/backfill-flight-times.mjs --apply
 *   …                                                                --ref FMP6VJN2
 *
 * ── Read this before changing anything here ──────────────────────────────────
 *
 * `departure_datetime`, `arrival_datetime`, `departure_date` and `return_date`
 * are `timestamp WITHOUT time zone`. They hold the airport wall clock as bare
 * numerals — "2026-12-11 18:10:00" for a BCN departure at 18:10 — with no
 * offset stored and none implied.
 *
 * node-postgres does NOT round-trip a JS Date against such a column. It
 * serialises a Date using the *process's* local zone, so passing
 * `new Date("2026-12-11T18:10:00Z")` from a UTC-6 machine writes "12:10:00",
 * six hours off, silently. Reading is skewed the same way in reverse, which
 * makes a correct row look broken and invites exactly the "repair" that breaks
 * it. An earlier run of this script did that to 56 rows.
 *
 * So this file never hands a Date to the driver in either direction:
 *   write — bind a 'YYYY-MM-DD HH:MM:SS' string and cast with ::timestamp
 *   read  — select `column::text` and compare strings
 *
 * Prisma is not affected; it writes the Date's UTC face, which is the same
 * convention the app reads back. Only raw pg needs this care.
 */
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const refArg = process.argv.indexOf('--ref');
const ONLY_REF = refArg > -1 ? process.argv[refArg + 1] : null;

const url = process.env.PROD_DB_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('Set PROD_DB_URL (or DATABASE_URL).');
  process.exit(1);
}

// No timezone on Earth is further than UTC±14.
const MAX_TZ_HOURS = 14;

/** Provider string -> the naive form postgres stores: "YYYY-MM-DD HH:MM:SS". */
function wallClock(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, hh = '00', mi = '00', ss = '00'] = m;
  return `${y}-${mo}-${d} ${hh}:${mi}:${ss}`;
}

/** Hours between two naive wall clocks, sign = want - have. */
function hoursApart(want, have) {
  const p = s => Date.parse(`${s.replace(' ', 'T')}Z`);
  return (p(want) - p(have)) / 3600000;
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query(`
  select s.id, s.booking_id, s.segment_order, s.direction, s.raw_segment_payload,
         s.departure_datetime::text as dep_text,
         s.arrival_datetime::text   as arr_text,
         mb.master_booking_reference as ref
    from booking_segments s
    join master_bookings mb on mb.id = s.booking_id
  ${ONLY_REF ? 'where mb.master_booking_reference = $1' : ''}
   order by mb.created_at desc, s.segment_order asc
`, ONLY_REF ? [ONLY_REF] : []);

let drifted = 0, clean = 0, unsourceable = 0, outOfBand = 0;
const segUpdates = [];
const bookingFirstSeg = new Map();

for (const r of rows) {
  const raw = r.raw_segment_payload;
  const depWant = wallClock(raw?.departure?.time ?? raw?.DepartureDateTime);
  const arrWant = wallClock(raw?.arrival?.time ?? raw?.ArrivalDateTime);

  if (!depWant && !arrWant) {
    unsourceable++;
    console.log(`  ?? ${r.ref} seg${r.segment_order}: no provider strings in raw payload — skipped`);
    continue;
  }

  const depHave = r.dep_text;
  const arrHave = r.arr_text;
  const depOff = depWant && depHave && depWant !== depHave;
  const arrOff = arrWant && arrHave && arrWant !== arrHave;

  if (!depOff && !arrOff) { clean++; continue; }

  const deltaH = depOff ? hoursApart(depWant, depHave) : 0;

  // A timezone artifact is always within one Earth offset. Anything larger is a
  // different flight, not a misparse — most likely a reissue, where the segment
  // rows hold the new itinerary while raw_segment_payload still holds the
  // original. Rewriting those would roll the booking back to flights the
  // passenger no longer holds.
  if (Math.abs(deltaH) > MAX_TZ_HOURS) {
    outOfBand++;
    console.log(`  ** ${r.ref} seg${r.segment_order} ${r.direction}: ${deltaH.toFixed(1)} h apart — NOT a timezone shift, left alone`);
    console.log(`       raw payload "${depWant}"  vs  stored "${depHave}"  (reissued? verify with the provider)`);
    continue;
  }

  drifted++;
  console.log(`  !! ${r.ref} seg${r.segment_order} ${r.direction}  (off by ${deltaH.toFixed(1)} h)`);
  console.log(`       departure  stored "${depHave}"  ->  "${depWant}"`);
  if (arrOff) console.log(`       arrival    stored "${arrHave}"  ->  "${arrWant}"`);
  segUpdates.push({ id: r.id, dep: depWant, arr: arrWant });
  if (r.segment_order === 0) {
    bookingFirstSeg.set(`${r.booking_id}|${r.direction}`,
      { bookingId: r.booking_id, direction: r.direction, dep: depWant });
  }
}

console.log(`\nsegments: ${rows.length} scanned · ${drifted} drifted · ${clean} already correct · ${unsourceable} unsourceable · ${outOfBand} out-of-band (skipped)`);

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.');
  await client.end();
  process.exit(0);
}

await client.query('begin');
try {
  for (const u of segUpdates) {
    await client.query(
      `update booking_segments
          set departure_datetime = coalesce($2::timestamp, departure_datetime),
              arrival_datetime   = coalesce($3::timestamp, arrival_datetime),
              updated_at = now()
        where id = $1`,
      [u.id, u.dep, u.arr],
    );
  }

  let bookingUpdates = 0;
  for (const { bookingId, direction, dep } of bookingFirstSeg.values()) {
    const col = direction === 'RETURN' ? 'return_date' : 'departure_date';
    const res = await client.query(
      `update master_bookings set ${col} = $2::timestamp, updated_at = now()
        where id = $1 and (${col} is null or ${col} <> $2::timestamp)`,
      [bookingId, dep],
    );
    bookingUpdates += res.rowCount;
  }

  await client.query('commit');
  console.log(`\napplied: ${segUpdates.length} segment rows, ${bookingUpdates} booking rows`);
} catch (err) {
  await client.query('rollback');
  console.error('\nrolled back:', err.message);
  process.exitCode = 1;
}

await client.end();
