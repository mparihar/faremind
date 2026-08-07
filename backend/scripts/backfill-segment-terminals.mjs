#!/usr/bin/env node
/**
 * Fill in airport terminals on bookings made before terminals were captured.
 *
 * Mystifly's search response carries no terminal field, so book time had nothing
 * to persist and every segment stored null — 0 of 86 production segments had a
 * terminal, while the confirmation page, the itinerary email, the download and
 * both consoles were all written to print "Terminal 3". TripDetails returns
 * DepartureTerminal / ArrivalTerminal for every leg, so the data exists at the
 * provider and only needs fetching.
 *
 * Going forward the book route takes terminals from the TripDetails call it
 * already makes, and the ticketing poll fills any it misses. This is only for
 * rows written before that.
 *
 * Dry run by default. Nothing is written without --apply.
 *
 *   node backend/scripts/backfill-segment-terminals.mjs               # report
 *   node backend/scripts/backfill-segment-terminals.mjs --apply
 *   node backend/scripts/backfill-segment-terminals.mjs --ref FM4OW3RM --apply
 *
 * Env: DATABASE_URL (or PROD_DB_URL), MYSTIFLY_API_URL, MYSTIFLY_USERNAME,
 *      MYSTIFLY_PASSWORD, MYSTIFLY_ACCOUNT_NUMBER.
 *
 * Segments are matched to the provider's by ROUTE, never by position: a round
 * trip is stored as two journeys and returned as one flat list, so counting
 * would put the outbound's terminal on the return. A booking whose routes do
 * not line up is skipped and reported rather than guessed at — a wrong terminal
 * is worse than none, because a passenger acts on it.
 */
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const refArg = process.argv.indexOf('--ref');
const ONLY_REF = refArg > -1 ? process.argv[refArg + 1] : null;

const DB = process.env.DATABASE_URL || process.env.PROD_DB_URL;
const BASE = process.env.MYSTIFLY_API_URL || 'https://restapidemo.myfarebox.com';
const USER = process.env.MYSTIFLY_USERNAME;
const PASS = process.env.MYSTIFLY_PASSWORD;
const ACCT = process.env.MYSTIFLY_ACCOUNT_NUMBER;

if (!DB) { console.error('DATABASE_URL (or PROD_DB_URL) is required.'); process.exit(1); }
if (!USER || !PASS || !ACCT) {
  console.error('MYSTIFLY_USERNAME, MYSTIFLY_PASSWORD and MYSTIFLY_ACCOUNT_NUMBER are required.');
  process.exit(1);
}

const norm = (v) => String(v ?? '').trim();
const routeKey = (o, d) => `${norm(o).toUpperCase()}->${norm(d).toUpperCase()}`;

/**
 * The bare terminal, without the provider's prefix.
 *
 * Mystifly is not consistent: most legs return "3", but Bangkok and Jakarta
 * return "T3". Stored verbatim the column would hold both conventions and the
 * display layer would print "Terminal T3" for some airports. Mirrors terminalOf
 * in src/lib/terminal.ts — keep the two in step.
 */
const terminalOf = (v) => {
  const t = norm(v);
  if (!t) return null;
  return t.replace(/^\s*(terminal|term\.?|t)\s*[:\-]?\s*/i, '').trim() || t;
};

async function createSession() {
  const r = await fetch(`${BASE}/api/CreateSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ UserName: USER, Password: PASS, AccountNumber: ACCT }),
  });
  const j = await r.json();
  const sid = j?.Data?.SessionId ?? j?.SessionId ?? j?.TokenId;
  if (!sid) throw new Error(`CreateSession failed: ${JSON.stringify(j).slice(0, 200)}`);
  return sid;
}

/** TripDetails, with the version fallback the service uses — v3 errors on some bookings. */
async function tripDetails(sid, mfRef) {
  for (const p of ['/api/TripDetails/', '/api/v2/TripDetails/', '/api/v1.1/TripDetails/', '/api/v3/TripDetails/']) {
    try {
      const r = await fetch(`${BASE}${p}${encodeURIComponent(mfRef)}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${sid}` },
      });
      const j = await r.json();
      if (j?.Success === true || j?.Data) return j;
    } catch { /* try the next version */ }
  }
  return null;
}

/** Only the itinerary the ticket is CURRENTLY on — an ExchangedItinerary is superseded. */
function reservationItems(trip) {
  const ti = trip?.Data?.TripDetailsResult?.TravelItinerary ?? trip?.Data?.TravelItinerary ?? trip;
  const groups = ti?.Itineraries;
  if (Array.isArray(groups) && groups.length > 0) {
    const current = groups.find((g) => String(g?.Type ?? '') === 'TravelItinerary') ?? groups[0];
    return current?.ItineraryInfo?.ReservationItems ?? [];
  }
  return ti?.ItineraryInfo?.ReservationItems ?? [];
}

function providerTerminals(trip) {
  return reservationItems(trip)
    .map((r) => ({
      origin: norm(r?.DepartureAirportLocationCode),
      destination: norm(r?.ArrivalAirportLocationCode),
      originTerminal: terminalOf(r?.DepartureTerminal),
      destinationTerminal: terminalOf(r?.ArrivalTerminal),
    }))
    .filter((t) => t.origin && t.destination);
}

const client = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
await client.connect();

const bookings = await client.query(`
  SELECT m.id, m.master_booking_reference AS ref, m.master_pnr
    FROM master_bookings m
   WHERE m.primary_provider ILIKE '%mystifly%'
     AND m.master_pnr IS NOT NULL
     ${ONLY_REF ? 'AND m.master_booking_reference = $1' : ''}
     AND EXISTS (
       SELECT 1 FROM booking_segments s
        WHERE s.booking_id = m.id
          AND (s.origin_terminal IS NULL OR s.destination_terminal IS NULL))
   ORDER BY m.created_at DESC`,
  ONLY_REF ? [ONLY_REF] : []);

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${bookings.rows.length} booking(s) with missing terminals\n`);

const sid = await createSession();
let filled = 0, skipped = 0, noData = 0;

for (const b of bookings.rows) {
  const trip = await tripDetails(sid, b.master_pnr);
  if (!trip) { console.log(`  ${b.ref}  ${b.master_pnr}  — TripDetails unreadable`); noData++; continue; }

  const provider = providerTerminals(trip).filter((t) => t.originTerminal || t.destinationTerminal);
  if (provider.length === 0) { console.log(`  ${b.ref}  ${b.master_pnr}  — provider published no terminals`); noData++; continue; }

  const stored = (await client.query(
    `SELECT id, origin_airport, destination_airport, origin_terminal, destination_terminal
       FROM booking_segments WHERE booking_id = $1
      ORDER BY segment_order, departure_datetime`, [b.id])).rows;

  // Route-matched, consuming duplicates in order. A booking whose routes do not
  // line up with the provider's has been re-routed; guessing would misassign.
  const pool = new Map();
  for (const t of provider) {
    const k = routeKey(t.origin, t.destination);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(t);
  }

  const updates = [];
  let unmatched = 0;
  for (const s of stored) {
    const t = pool.get(routeKey(s.origin_airport, s.destination_airport))?.shift();
    if (!t) { unmatched++; continue; }
    const data = {};
    if (t.originTerminal && t.originTerminal !== s.origin_terminal) data.origin_terminal = t.originTerminal;
    if (t.destinationTerminal && t.destinationTerminal !== s.destination_terminal) data.destination_terminal = t.destinationTerminal;
    if (Object.keys(data).length > 0) updates.push({ id: s.id, seg: `${s.origin_airport}→${s.destination_airport}`, data });
  }

  if (unmatched > 0) {
    console.log(`  ${b.ref}  ${b.master_pnr}  — SKIPPED: ${unmatched} segment(s) have no matching provider route (re-routed?)`);
    skipped++;
    continue;
  }
  if (updates.length === 0) { console.log(`  ${b.ref}  ${b.master_pnr}  — already current`); continue; }

  const summary = updates.map((u) =>
    `${u.seg} ${[u.data.origin_terminal && `dep T${u.data.origin_terminal}`,
                 u.data.destination_terminal && `arr T${u.data.destination_terminal}`]
      .filter(Boolean).join(' ')}`).join(', ');
  console.log(`  ${b.ref}  ${b.master_pnr}  → ${summary}`);

  if (APPLY) {
    for (const u of updates) {
      const sets = [], vals = [];
      for (const [col, v] of Object.entries(u.data)) { vals.push(v); sets.push(`${col} = $${vals.length}`); }
      vals.push(u.id);
      await client.query(`UPDATE booking_segments SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    }
  }
  filled += updates.length;
}

console.log(`\n${APPLY ? 'Applied' : 'Would apply'} ${filled} terminal field(s).`);
if (skipped) console.log(`${skipped} booking(s) skipped — routes did not match the provider.`);
if (noData) console.log(`${noData} booking(s) had no terminal data at the provider.`);
if (!APPLY && filled > 0) console.log('Re-run with --apply to write.');

await client.end();
