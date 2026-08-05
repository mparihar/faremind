/**
 * Re-point booking_tickets at the right passenger's e-ticket.
 *
 *   PROD_DB_URL="postgres://…" node backend/scripts/repair-eticket-assignment.mjs
 *   PROD_DB_URL="postgres://…" node backend/scripts/repair-eticket-assignment.mjs --apply
 *
 * The backfill assigned coupons positionally: a flat list of numbers dealt onto
 * whichever ticket rows sorted first. A round trip has one row per passenger per
 * journey, so six rows met three numbers and every passenger ended up holding
 * someone else's coupon — FMJHI8HG had the adult on the child's TKT529624, and
 * Get Reissue Quote answered "Eticket number is wrong".
 *
 * This re-reads TripDetails, which states plainly whose coupon is whose, and
 * writes each passenger's own number onto all of their rows. A passenger the
 * provider does not name is left blank rather than guessed — a wrong coupon is
 * worse than none, because it can be rejected against another traveller.
 */
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const url = process.env.PROD_DB_URL || process.env.DATABASE_URL;
if (!url) { console.error('Set PROD_DB_URL (or DATABASE_URL).'); process.exit(1); }

const MF = process.env.MYSTIFLY_API_URL || 'https://restapidemo.myfarebox.com';
const CREDS = {
  UserName: process.env.MYSTIFLY_USERNAME || 'FareMind_API',
  Password: process.env.MYSTIFLY_PASSWORD || 'Welcome@123',
  AccountNumber: process.env.MYSTIFLY_ACCOUNT_NUMBER || 'MCN006482',
};

const norm = (v) => String(v ?? '').trim().toLowerCase();
const ptc = (v) => {
  const t = norm(v);
  if (t.startsWith('child') || t === 'chd' || t === 'c') return 'CHD';
  if (t.startsWith('inf') || t === 'i') return 'INF';
  return 'ADT';
};
const isLive = (t) => {
  const type = String(t?.ETicketType ?? '').trim();
  return !type || !/reissued|refunded|voided|exchanged|cancell?ed/i.test(type);
};

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const auth = await fetch(`${MF}/api/CreateSession`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CREDS),
});
const session = (await auth.json())?.Data?.SessionId;
if (!session) { console.error('CreateSession failed'); process.exit(1); }
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` };

const { rows: bookings } = await client.query(`
  select id, master_booking_reference as ref, mystifly_mf_ref as mf
    from master_bookings
   where mystifly_mf_ref is not null and primary_provider = 'mystifly'
   order by created_at desc`);

let wrong = 0, ok = 0, blank = 0;
const updates = [];

for (const b of bookings) {
  const res = await fetch(`${MF}/api/TripDetails/${encodeURIComponent(b.mf)}`, { headers: H });
  const ti = (await res.json())?.Data?.TripDetailsResult?.TravelItinerary;
  const infos = Array.isArray(ti?.PassengerInfos) ? ti.PassengerInfos : [];
  if (infos.length === 0) continue;

  const provider = [];
  for (const info of infos) {
    const pax = info?.Passenger ?? info;
    const num = (Array.isArray(info?.ETickets) ? info.ETickets : [])
      .filter(isLive).map((t) => String(t?.ETicketNumber ?? '').trim()).find((n) => n);
    if (!num) continue;
    provider.push({
      first: norm(pax?.PaxName?.PassengerFirstName),
      last: norm(pax?.PaxName?.PassengerLastName),
      type: String(pax?.PassengerType ?? '').toUpperCase(),
      eTicket: num,
    });
  }
  if (provider.length === 0) continue;

  const { rows: tickets } = await client.query(`
    select t.id, t.e_ticket_number, p.first_name, p.last_name, p.passenger_type
      from booking_tickets t join booking_passengers p on p.id = t.passenger_id
     where t.booking_id = $1`, [b.id]);

  for (const t of tickets) {
    const match =
      provider.find((e) => e.first === norm(t.first_name) && e.last === norm(t.last_name) && e.type === ptc(t.passenger_type)) ||
      provider.find((e) => e.first === norm(t.first_name) && e.last === norm(t.last_name)) ||
      (provider.filter((e) => e.first === norm(t.first_name) && e.type === ptc(t.passenger_type)).length === 1
        ? provider.find((e) => e.first === norm(t.first_name) && e.type === ptc(t.passenger_type))
        : null);

    if (!match) {
      blank++;
      console.log(`  ?? ${b.ref}  ${t.first_name} ${t.last_name} (${t.passenger_type}) — provider names no coupon, left as "${t.e_ticket_number ?? 'null'}"`);
      continue;
    }
    if (t.e_ticket_number === match.eTicket) { ok++; continue; }
    wrong++;
    console.log(`  !! ${b.ref}  ${t.first_name} ${t.last_name} (${t.passenger_type}): "${t.e_ticket_number ?? 'null'}" -> "${match.eTicket}"`);
    updates.push({ id: t.id, eTicket: match.eTicket });
  }
}

console.log(`\ntickets: ${wrong} wrong · ${ok} already correct · ${blank} unmatched (left alone)`);

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.');
  await client.end();
  process.exit(0);
}

await client.query('begin');
try {
  for (const u of updates) {
    await client.query(
      `update booking_tickets set e_ticket_number=$2, ticket_number=$2, updated_at=now() where id=$1`,
      [u.id, u.eTicket],
    );
  }
  await client.query('commit');
  console.log(`\napplied: ${updates.length} ticket rows`);
} catch (err) {
  await client.query('rollback');
  console.error('\nrolled back:', err.message);
  process.exitCode = 1;
}
await client.end();
