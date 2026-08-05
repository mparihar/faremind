/**
 * Repair flight timestamps that were parsed in the machine's timezone.
 *
 *   PROD_DB_URL="postgres://…" node backend/scripts/backfill-flight-times.mjs           # dry run
 *   PROD_DB_URL="postgres://…" node backend/scripts/backfill-flight-times.mjs --apply
 *   …                                                                --ref FMP6VJN2
 *
 * Every booking_segments row keeps the provider's own strings in
 * `raw_segment_payload`, so the correct value is recoverable rather than
 * guessed: re-derive from that payload, pinning the wall clock to UTC the way
 * `provider-time.ts` now does on the write path.
 *
 * Rows whose raw payload is missing or shapeless are reported and skipped — a
 * timestamp we cannot source is left alone rather than overwritten with a
 * plausible-looking one.
 *
 * master_bookings.departure_date / return_date are re-derived from the first
 * segment of the outbound and return journeys respectively.
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

/** Pin an ISO-ish wall clock to UTC. Mirrors parseProviderDateTime. */
function pin(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?/.exec(s.trim());
  if (!m) return null;
  const at = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0),
    +String(m[7] ?? '0').padEnd(3, '0'));
  return Number.isNaN(at) ? null : new Date(at);
}

const iso = d => (d ? d.toISOString() : '—');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const where = ONLY_REF ? 'where mb.master_booking_reference = $1' : '';
const params = ONLY_REF ? [ONLY_REF] : [];

const { rows } = await client.query(`
  select s.id, s.booking_id, s.journey_id, s.segment_order, s.direction,
         s.departure_datetime, s.arrival_datetime, s.raw_segment_payload,
         mb.master_booking_reference as ref, mb.departure_date, mb.return_date
    from booking_segments s
    join master_bookings mb on mb.id = s.booking_id
  ${where}
   order by mb.created_at desc, s.segment_order asc
`, params);

// No timezone on Earth is further than UTC±14.
const MAX_TZ_HOURS = 14;
let drifted = 0, clean = 0, unsourceable = 0, outOfBand = 0;
const segUpdates = [];
const bookingFirstSeg = new Map(); // "ref|direction" -> corrected departure Date

for (const r of rows) {
  const raw = r.raw_segment_payload;
  const depRaw = raw?.departure?.time ?? raw?.DepartureDateTime ?? null;
  const arrRaw = raw?.arrival?.time ?? raw?.ArrivalDateTime ?? null;

  if (!depRaw && !arrRaw) {
    unsourceable++;
    console.log(`  ?? ${r.ref} seg${r.segment_order}: no provider strings in raw payload — skipped`);
    continue;
  }

  const depWant = pin(depRaw);
  const arrWant = pin(arrRaw);
  const depHave = r.departure_datetime;
  const arrHave = r.arrival_datetime;

  const depOff = depWant && depHave && depWant.getTime() !== depHave.getTime();
  const arrOff = arrWant && arrHave && arrWant.getTime() !== arrHave.getTime();

  if (!depOff && !arrOff) { clean++; continue; }

  const deltaH = depOff ? (depWant.getTime() - depHave.getTime()) / 3600000 : 0;

  // A timezone artifact is always within one Earth offset. Anything larger is a
  // different flight, not a misparse — most likely a reissue, where the segment
  // rows were updated to the new itinerary while raw_segment_payload still holds
  // the original. Rewriting those from the raw payload would silently roll the
  // booking back to the flights the passenger no longer holds.
  if (Math.abs(deltaH) > MAX_TZ_HOURS) {
    outOfBand++;
    console.log(`  ** ${r.ref} seg${r.segment_order} ${r.direction}: ${deltaH.toFixed(1)} h apart — NOT a timezone shift, left alone`);
    console.log(`       raw payload "${depRaw}"  vs  stored ${iso(depHave)}`);
    console.log(`       (reissued booking? verify against the provider before touching this row)`);
    continue;
  }

  drifted++;
  console.log(`  !! ${r.ref} seg${r.segment_order} ${r.direction}`);
  console.log(`       provider "${depRaw}" → ${iso(depWant)}   stored ${iso(depHave)}   (off by ${deltaH.toFixed(1)} h)`);
  if (arrOff) console.log(`       arrival  "${arrRaw}" → ${iso(arrWant)}   stored ${iso(arrHave)}`);
  segUpdates.push({ id: r.id, dep: depWant, arr: arrWant });
  if (r.segment_order === 0) {
    bookingFirstSeg.set(`${r.booking_id}|${r.direction}`,
      { ref: r.ref, bookingId: r.booking_id, direction: r.direction, dep: depWant });
  }
}

console.log(`\nsegments: ${rows.length} scanned · ${drifted} drifted · ${clean} already correct · ${unsourceable} unsourceable`);

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.');
  await client.end();
  process.exit(0);
}

await client.query('begin');
try {
  for (const u of segUpdates) {
    await client.query(
      `update booking_segments set departure_datetime = coalesce($2, departure_datetime),
                                   arrival_datetime   = coalesce($3, arrival_datetime),
                                   updated_at = now()
        where id = $1`,
      [u.id, u.dep, u.arr],
    );
  }

  // Re-derive the booking-level dates from the corrected first segments.
  let bookingUpdates = 0;
  for (const { bookingId, direction, dep } of bookingFirstSeg.values()) {
    const col = direction === 'RETURN' ? 'return_date' : 'departure_date';
    const res = await client.query(
      `update master_bookings set ${col} = $2, updated_at = now()
        where id = $1 and (${col} is null or ${col} <> $2)`,
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
