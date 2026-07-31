/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FareMind — End-to-End Booking Validator (read-only QA tool)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Checks a booking against the PROVIDER, not just against itself.
 *
 * scripts/reconcile-financials.mjs verifies that our own columns add up. That cannot
 * catch a booking where we stored the wrong provider fare — the arithmetic is still
 * self-consistent. This tool pulls Mystifly TripDetails + CouponStatus and compares the
 * airline's own numbers, itinerary, tickets and fare rules against what we persisted and
 * what the customer was charged.
 *
 * READ-ONLY. Makes no writes and no billable provider calls (TripDetails and
 * CouponStatus are both reads).
 *
 * Usage:
 *   PROD_DB_URL="postgres://…" \
 *   MYSTIFLY_API_URL=… MYSTIFLY_SESSION_ID=… \
 *   node backend/scripts/validate-booking-e2e.mjs [options]
 *
 *     --ref FMXXXXXX     one booking by FareMind reference
 *     --recent N         the N most recent bookings (default 10)
 *     --all              every booking
 *     --json             machine-readable output
 *
 * Check groups:
 *   FARE       provider fare  vs providerPayableTotal
 *   FEES       service fee, third-party, and the customer total composition
 *   PAYMENT    Stripe captured vs the total we displayed
 *   ITINERARY  provider segments vs booking_segments (route, flight, date, cabin)
 *   TICKETS    provider e-tickets (live ones only) vs booking_tickets
 *   RULES      provider refundable/changeable + fees vs the BookingPnr snapshot
 *   SERVICING  which of void / refund / reissue the provider says is possible now
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pg = require('pg');

// ── config ──
const SERVICE_FEE_PER_PAX = 10;    // SERVICE_FEE rule (FIXED_PER_TRAVELER)
const MONEY_TOL = 1.0;             // dollars
const CENT_TOL = 0.05;             // provider-vs-provider rounding

const MF_URL = process.env.MYSTIFLY_API_URL || 'https://restapidemo.myfarebox.com';
const MF_SESSION = process.env.MYSTIFLY_SESSION_ID || '';

// ── args ──
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const REF = arg('--ref');
const ALL = argv.includes('--all');
const AS_JSON = argv.includes('--json');
const RECENT = parseInt(arg('--recent') || '10', 10);

const cs = process.env.PROD_DB_URL || process.env.DATABASE_URL;
if (!cs) { console.error('Set PROD_DB_URL (or DATABASE_URL).'); process.exit(1); }
if (!MF_SESSION) { console.error('Set MYSTIFLY_SESSION_ID so provider reads can authenticate.'); process.exit(1); }

const db = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });

const n = (v) => (v == null ? 0 : Number(v));
const r2 = (x) => Math.round(x * 100) / 100;
const money = (x, cur = 'USD') => `${cur} ${r2(x).toFixed(2)}`;
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';

let checks = 0, fails = 0, warns = 0;
const report = [];

function check(group, label, pass, detail, warnOnly = false) {
  checks++;
  const status = pass ? 'PASS' : warnOnly ? 'WARN' : 'FAIL';
  if (!pass) { if (warnOnly) warns++; else fails++; }
  report.push({ group, label, status, detail });
  if (AS_JSON) return;
  const mark = pass ? `${G}✓${X}` : warnOnly ? `${Y}⚠${X}` : `${R}✗${X}`;
  const colour = pass ? D : warnOnly ? Y : R;
  console.log(`   ${mark} ${group.padEnd(9)} ${label.padEnd(22)} ${colour}${detail}${X}`);
}

async function mf(path) {
  const res = await fetch(`${MF_URL}${path}`, { headers: { Authorization: `Bearer ${MF_SESSION}` } });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return null; }
}

/** TripDetails across its version variants — v3 errors on some bookings. */
async function tripDetails(mfRef) {
  for (const base of ['/api/TripDetails/', '/api/v2/TripDetails/', '/api/v1.1/TripDetails/']) {
    const r = await mf(`${base}${encodeURIComponent(mfRef)}`);
    const ti = r?.Data?.TripDetailsResult?.TravelItinerary || r?.Data?.TravelItinerary;
    if (ti) return ti;
  }
  return null;
}

/** Only e-tickets the airline still considers live — a reissue leaves dead ones behind. */
function liveEtickets(ti) {
  const out = [];
  for (const p of ti?.PassengerInfos || []) {
    for (const tk of p?.ETickets || []) {
      const type = String(tk?.ETicketType || '');
      if (type && /reissued|refunded|voided|exchanged|cancell?ed/i.test(type)) continue;
      if (tk?.ETicketNumber) out.push(String(tk.ETicketNumber));
    }
  }
  return [...new Set(out)];
}

function providerFare(ti) {
  const rows = ti?.TripDetailsPTC_FareBreakdowns || [];
  let base = 0, tax = 0, total = 0, currency = null, pax = 0;
  for (const r of rows) {
    const f = r?.TripDetailsPassengerFare || {};
    const qty = parseInt(r?.PassengerTypeQuantity?.Quantity, 10) || 1;
    base += (parseFloat(f?.EquiFare?.Amount) || 0) * qty;
    tax += (parseFloat(f?.Tax?.Amount) || 0) * qty;
    total += (parseFloat(f?.TotalFare?.Amount) || 0) * qty;
    currency = currency || f?.TotalFare?.CurrencyCode || f?.EquiFare?.CurrencyCode;
    pax += qty;
  }
  return { base: r2(base), tax: r2(tax), total: r2(total), currency: currency || 'USD', pax, rows: rows.length };
}

function providerSegments(ti) {
  const out = [];
  for (const it of ti?.Itineraries || []) {
    for (const s of it?.ItineraryInfo?.ReservationItems || []) {
      out.push({
        origin: s?.DepartureAirportLocationCode,
        destination: s?.ArrivalAirportLocationCode,
        flightNumber: String(s?.FlightNumber ?? ''),
        airline: s?.MarketingAirlineCode,
        departure: s?.DepartureDateTime,
        cabin: s?.CabinClass,
        baggage: s?.Baggage,
        airlinePnr: s?.AirlinePNR,
        status: s?.FlightStatus,
      });
    }
  }
  return out;
}

function providerRules(ti) {
  const r = (ti?.TripDetailsPTC_FareBreakdowns || [])[0] || {};
  const refund = r?.AirRefundCharges || {};
  const exch = r?.AirExchangeCharges || {};
  const refundFee = (refund?.RefundCharges || [])
    .flatMap((c) => (c?.ChargesBeforeDeparture || []).map((x) => parseFloat(x?.Charges) || 0));
  const changeFee = (exch?.ExchangeCharges || []).map((c) => parseFloat(c?.ChargeBeforeDeparture) || 0);
  return {
    refundable: String(refund?.IsRefundableBeforeDeparture || ''),
    changeable: String(exch?.IsExchangeableBeforeDeparture || ''),
    refundFee: refundFee.length ? Math.max(...refundFee) : null,
    changeFee: changeFee.length ? Math.max(...changeFee) : null,
  };
}

async function validate(b) {
  const cur = b.currency || 'USD';
  const mfRef = b.mystifly_mf_ref || b.provider_order_id || b.master_pnr;

  // booking_source is the authoritative surface. Fall back to the older, agent-only
  // created_by_role for rows written before that column existed.
  const surface = b.booking_source
    || (b.created_by_role ? `${b.created_by_role} (legacy)` : b.agent_user_id ? 'UNLABELLED (agent attached)' : 'UNLABELLED');

  if (!AS_JSON) {
    console.log(`\n${B}${b.master_booking_reference}${X}  ${D}pnr=${b.master_pnr ?? '-'} · ${b.primary_provider} · ${b.booking_status}/${b.ticketing_status}/${b.payment_status} · surface=${surface}${X}`);
  }

  if (String(b.primary_provider || '').toLowerCase() !== 'mystifly') {
    check('PROVIDER', 'supported', true, `${b.primary_provider} — provider comparison not implemented, skipping`, true);
    return;
  }
  if (!mfRef) { check('PROVIDER', 'reference', false, 'no Mystifly reference on the booking'); return; }

  const ti = await tripDetails(mfRef);
  if (!ti) { check('PROVIDER', 'TripDetails', false, `no itinerary returned for ${mfRef}`); return; }

  // ── our side ──
  const pax = n((await db.query('SELECT count(*)::int c FROM booking_passengers WHERE booking_id=$1', [b.id])).rows[0]?.c) || 1;
  const paid = n((await db.query("SELECT COALESCE(SUM(amount),0) s FROM booking_payments WHERE booking_id=$1 AND status='SUCCEEDED'", [b.id])).rows[0]?.s);
  // ::text deliberately — departure_datetime is `timestamp without time zone` holding a
  // local wall clock, and node-postgres would hand back a Date built in the host's zone.
  // Round-tripping that through toISOString() shifts an evening departure into the next
  // UTC day and invents a mismatch that does not exist.
  const ourSegs = (await db.query(
    `SELECT origin_airport o, destination_airport d, flight_number f, airline_code a,
            departure_datetime::text dt, cabin
       FROM booking_segments WHERE booking_id=$1 ORDER BY segment_order ASC`, [b.id])).rows;
  const ourTickets = (await db.query(
    'SELECT COALESCE(NULLIF(e_ticket_number,\'\'), NULLIF(ticket_number,\'\')) t FROM booking_tickets WHERE booking_id=$1', [b.id]))
    .rows.map((r) => r.t).filter(Boolean);
  const pnr = (await db.query(
    'SELECT refundable, changeable, cancellation_fee, change_fee FROM booking_pnrs WHERE booking_id=$1 ORDER BY created_at ASC LIMIT 1', [b.id])).rows[0];

  // ── FARE: the check reconcile-financials structurally cannot make ──
  const pf = providerFare(ti);
  const ourProvider = n(b.provider_payable_total);
  check('FARE', 'provider total', Math.abs(pf.total - ourProvider) <= MONEY_TOL,
    `airline ${money(pf.total, pf.currency)} vs stored providerPayableTotal ${money(ourProvider, cur)}`);
  check('FARE', 'breakdown adds up', Math.abs(pf.base + pf.tax - pf.total) <= CENT_TOL,
    `base ${money(pf.base)} + tax ${money(pf.tax)} = ${money(pf.base + pf.tax)} vs total ${money(pf.total)}`);
  check('FARE', 'currency', pf.currency === cur, `airline ${pf.currency} vs booking ${cur}`, pf.currency !== cur);
  check('FARE', 'passenger count', pf.pax === pax, `airline prices ${pf.pax} pax vs ${pax} on the booking`);

  // ── FEES + total composition ──
  const svc = n(b.service_fee_amount);
  const markup = n(b.markup_amount);
  const thirdParty = n(b.third_party_payable_total);
  const total = n(b.total_amount);
  check('FEES', 'service fee', Math.abs(svc - SERVICE_FEE_PER_PAX * pax) < 0.01,
    `${money(svc)} vs expected ${money(SERVICE_FEE_PER_PAX * pax)} (${pax}×$${SERVICE_FEE_PER_PAX})`);
  check('FEES', 'markup removed', Math.abs(markup) < 0.01, `markup ${money(markup)}`);
  const accounted = r2(ourProvider + markup + svc + thirdParty);
  check('FEES', 'customer total', Math.abs(total - accounted) <= MONEY_TOL,
    `charged ${money(total, cur)} vs provider+fees ${money(accounted, cur)} · unexplained ${money(total - accounted, cur)}`);

  // ── PAYMENT ──
  if (paid > 0) {
    check('PAYMENT', 'captured', Math.abs(paid - total) <= MONEY_TOL, `Stripe ${money(paid, cur)} vs displayed ${money(total, cur)}`);
  } else {
    check('PAYMENT', 'captured', true, 'no succeeded payment row', true);
  }

  // ── ITINERARY ──
  const ps = providerSegments(ti);
  check('ITINERARY', 'segment count', ps.length === ourSegs.length, `airline ${ps.length} vs stored ${ourSegs.length}`);
  let matched = 0;
  const mismatches = [];
  for (const seg of ps) {
    const hit = ourSegs.find((o) => o.o === seg.origin && o.d === seg.destination && String(o.f).replace(/^[A-Z]{2}/, '') === seg.flightNumber);
    if (hit) {
      matched++;
      // Both sides are compared as wall-clock text — no Date parsing, no zone shift.
      const ourDate = String(hit.dt || '').slice(0, 10);
      const theirDate = String(seg.departure || '').slice(0, 10);
      if (ourDate && theirDate && ourDate !== theirDate) {
        mismatches.push(`${seg.origin}->${seg.destination} date airline ${theirDate} vs stored ${ourDate}`);
      }
    } else {
      mismatches.push(`${seg.origin}->${seg.destination} #${seg.flightNumber} not found in booking_segments`);
    }
  }
  check('ITINERARY', 'segments match', matched === ps.length && mismatches.length === 0,
    mismatches.length ? mismatches.join(' | ') : `${matched}/${ps.length} matched on route + flight + date`);

  // ── TICKETS ──
  const live = liveEtickets(ti);
  const staleStored = ourTickets.filter((t) => live.length > 0 && !live.includes(t));
  check('TICKETS', 'e-ticket present', live.length > 0, live.length ? `airline holds ${live.join(', ')}` : 'airline reports no live e-ticket');
  if (live.length > 0) {
    check('TICKETS', 'stored matches live', staleStored.length === 0,
      staleStored.length ? `stored ${staleStored.join(', ')} not live at the airline (superseded?)` : `stored numbers match`);
  }
  const provTktStatus = String(ti?.TicketStatus || '');
  check('TICKETS', 'ticketing status', /ticketed/i.test(provTktStatus) === (b.ticketing_status === 'ISSUED'),
    `airline "${provTktStatus}" vs stored ticketingStatus ${b.ticketing_status}`, true);

  // ── RULES: the promises frozen onto the booking at book time ──
  const pr = providerRules(ti);
  if (pnr) {
    const provRefundable = /yes/i.test(pr.refundable);
    const provChangeable = /yes/i.test(pr.changeable);
    check('RULES', 'refundable', provRefundable === !!pnr.refundable,
      `airline "${pr.refundable}" vs stored ${pnr.refundable}`);
    check('RULES', 'changeable', provChangeable === !!pnr.changeable,
      `airline "${pr.changeable}" vs stored ${pnr.changeable}`);
    if (pr.refundFee != null && pnr.cancellation_fee != null) {
      check('RULES', 'cancellation fee', Math.abs(pr.refundFee - n(pnr.cancellation_fee)) <= MONEY_TOL,
        `airline ${money(pr.refundFee)} vs stored ${money(n(pnr.cancellation_fee))}`, true);
    }
    if (pr.changeFee != null && pnr.change_fee != null) {
      check('RULES', 'change fee', Math.abs(pr.changeFee - n(pnr.change_fee)) <= MONEY_TOL,
        `airline ${money(pr.changeFee)} vs stored ${money(n(pnr.change_fee))}`, true);
    }
  } else {
    check('RULES', 'pnr snapshot', false, 'no BookingPnr row — fare rules were never frozen onto this booking');
  }

  // ── SERVICING: what the provider says is possible right now ──
  const voidWindow = ti?.VoidingWindow ? new Date(ti.VoidingWindow) : null;
  const voidOpen = voidWindow ? voidWindow.getTime() > Date.now() : null;
  const coupon = await mf(`/api/CouponStatus/${encodeURIComponent(mfRef)}`);
  const segs = (coupon?.Data?.CouponDetailsResult?.CouponStatus?.lstEticket || []).flatMap((t) => t?.lstSegment || []);
  const open = segs.filter((s) => /open/i.test(String(s?.CouponStatus || ''))).length;
  check('SERVICING', 'void window',
    voidOpen !== false,
    voidWindow ? `${voidOpen ? 'OPEN until' : 'CLOSED at'} ${ti.VoidingWindow} — ${voidOpen ? 'void is available' : 'refund is the only path'}` : 'no VoidingWindow returned',
    true);
  check('SERVICING', 'coupons open', segs.length > 0 && open === segs.length,
    segs.length ? `${open}/${segs.length} coupons OPEN${open === segs.length ? '' : ' — airline says not valid for REFUND/VOID/REISSUE'}` : 'no coupon data',
    true);
}

(async () => {
  await db.connect();
  const cols = `id, master_booking_reference, master_pnr, mystifly_mf_ref, provider_order_id, primary_provider,
                booking_status, ticketing_status, payment_status, currency, total_amount, provider_payable_total,
                markup_amount, service_fee_amount, third_party_payable_total,
                created_by_role, agent_user_id, user_id, created_at`;

  // booking_source is newer than some deployments — select it only where it exists so
  // the validator still runs against a database that has not taken the migration.
  const hasSource = (await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='master_bookings' AND column_name='booking_source'`
  )).rowCount > 0;
  const selectCols = hasSource ? `${cols}, booking_source` : cols;
  let where = '', params = [];
  if (REF) { where = 'WHERE master_booking_reference=$1'; params = [REF]; }
  const limit = ALL || REF ? '' : `LIMIT ${RECENT}`;
  const rows = (await db.query(`SELECT ${selectCols} FROM master_bookings ${where} ORDER BY created_at DESC ${limit}`, params)).rows;

  if (!AS_JSON) console.log(`\n${D}Validating ${rows.length} booking(s) against the provider…${X}`);
  for (const b of rows) {
    try { await validate(b); }
    catch (e) { check('ERROR', b.master_booking_reference, false, e.message); }
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ checks, fails, warns, report }, null, 2));
  } else {
    console.log(`\n${D}${'═'.repeat(70)}${X}`);
    const clr = fails ? R : warns ? Y : G;
    console.log(`${clr}Checks: ${checks} · Failures: ${fails} · Warnings: ${warns}${X}`);
    console.log(fails
      ? `${R}✗ Bookings disagree with the provider — see FAIL lines above.${X}`
      : `${G}✓ Every booking matches the provider.${X}`);
  }
  await db.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('Validator error:', e.message); process.exit(2); });
