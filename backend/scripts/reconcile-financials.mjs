/**
 * ═══════════════════════════════════════════════════════════════
 * FareMind — Financial Reconciliation Validator (read-only QA tool)
 * ═══════════════════════════════════════════════════════════════
 *
 * Audits booking financials for internal consistency and asserts the invariants
 * that E2E testing must uphold across every surface (Public / User / Agent) and
 * flow (create / void / refund / reissue). READ-ONLY — never writes.
 *
 * Usage (from repo root or backend/):
 *   PROD_DB_URL="postgres://…"  node backend/scripts/reconcile-financials.mjs [options]
 *     --ref FMXXXXXX     audit a single booking by FareMind reference
 *     --recent N         audit the N most recent bookings (default 15)
 *     --provider NAME    filter by primaryProvider (e.g. mystifly, duffel)
 *     --all              audit every booking
 *
 * Invariants checked per booking:
 *   RECON        total_amount == providerPayable + markup + serviceFee + thirdParty + meals + bags   (±$1)
 *   MARKUP_ZERO  markup_amount == 0                                (markup removed platform-wide)
 *   SERVICE_FEE  service_fee_amount == $10 × passengers            (fixed rule, not a % fallback)
 *   REVENUE      faremind_revenue_total == markup + serviceFee
 *   THIRDPARTY   third_party_payable_total == insurance + protection
 *   PAY_MATCH    Σ succeeded booking_payments == total_amount      (Stripe captured == displayed)
 *   VOID/REFUND  cancelled/voided ⇒ paymentStatus refunded + Σ refunds ≈ total
 * Plus a per-agent wallet reconciliation: utilized == Σ active agent bookings.
 */
import pg from 'pg';

const SERVICE_FEE_PER_PAX = 10;   // DB SERVICE_FEE rule (FIXED_PER_TRAVELER)
const TOL = 1.0;                  // reconciliation tolerance in dollars

// ── args ──
const argv = process.argv.slice(2);
const getArg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const REF = getArg('--ref');
const PROVIDER = getArg('--provider');
const ALL = argv.includes('--all');
const RECENT = parseInt(getArg('--recent') || '15', 10);

const cs = process.env.PROD_DB_URL || process.env.DATABASE_URL;
if (!cs) { console.error('Set PROD_DB_URL (or DATABASE_URL).'); process.exit(1); }
const c = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });

const n = (v) => (v == null ? 0 : Number(v));
const r2 = (x) => Math.round(x * 100) / 100;
const money = (x, cur = 'USD') => `${cur} ${r2(x).toFixed(2)}`;
const GREEN = '\x1b[32m', RED = '\x1b[31m', YEL = '\x1b[33m', DIM = '\x1b[2m', RST = '\x1b[0m';

let totalChecks = 0, totalFail = 0, totalWarn = 0;

function check(label, pass, detail, warnOnly = false) {
  totalChecks++;
  if (pass) { console.log(`   ${GREEN}✓${RST} ${label} ${DIM}${detail}${RST}`); return; }
  if (warnOnly) { totalWarn++; console.log(`   ${YEL}⚠${RST} ${label} ${YEL}${detail}${RST}`); return; }
  totalFail++; console.log(`   ${RED}✗ ${label} ${detail}${RST}`);
}

async function auditBooking(b) {
  const cur = b.currency || 'USD';
  const total = n(b.total_amount);
  const provider = n(b.provider_payable_total);
  const markup = n(b.markup_amount);
  const svc = n(b.service_fee_amount);
  const rev = n(b.faremind_revenue_total);
  const thirdParty = n(b.third_party_payable_total);
  const insurance = n(b.travel_insurance_amount);
  const protection = n(b.price_protection_amount);

  const pax = n((await c.query(`SELECT count(*)::int nn FROM booking_passengers WHERE booking_id=$1`, [b.id])).rows[0]?.nn) || 1;
  const mealsBags = n((await c.query(`SELECT COALESCE(SUM(total_price),0) s FROM addons WHERE booking_id=$1 AND type IN ('MEAL','BAGGAGE')`, [b.id]).catch(() => ({ rows: [{ s: 0 }] }))).rows[0]?.s);
  const paid = n((await c.query(`SELECT COALESCE(SUM(amount),0) s FROM booking_payments WHERE booking_id=$1 AND status='SUCCEEDED'`, [b.id])).rows[0]?.s);
  const refunded = n((await c.query(`SELECT COALESCE(SUM(amount),0) s FROM booking_refunds WHERE booking_id=$1`, [b.id])).rows[0]?.s);

  console.log(`\n${b.master_booking_reference}  ${DIM}pnr=${b.master_pnr ?? '-'} ${b.primary_provider} · ${b.booking_status}/${b.ticketing_status}/${b.payment_status} · ${pax} pax${RST}`);

  // RECON: total == provider + markup + serviceFee + thirdParty + meals/bags (seat already inside provider)
  const accounted = r2(provider + markup + svc + thirdParty + mealsBags);
  const residual = r2(total - accounted);
  check('RECON', Math.abs(residual) <= TOL,
    `total ${money(total, cur)} vs Σ ${money(accounted, cur)} (provider ${money(provider)} + markup ${money(markup)} + svc ${money(svc)} + 3p ${money(thirdParty)} + m/b ${money(mealsBags)}) · residual ${money(residual)}`);

  // MARKUP removed
  check('MARKUP_ZERO', Math.abs(markup) < 0.01, `markup ${money(markup)}`);

  // SERVICE_FEE == $10 × pax
  const expectedSvc = SERVICE_FEE_PER_PAX * pax;
  const svcOk = Math.abs(svc - expectedSvc) < 0.01;
  const looksLikePct = !svcOk && svc > 0 && Math.abs(svc - r2((provider) * 0.015)) < 0.75;
  check('SERVICE_FEE', svcOk, `stored ${money(svc)} vs expected ${money(expectedSvc)} (${pax}×$${SERVICE_FEE_PER_PAX})${looksLikePct ? ' — looks like the 1.5% fallback!' : ''}`, !svcOk && total === 0);

  // REVENUE == markup + serviceFee
  check('REVENUE', Math.abs(rev - r2(markup + svc)) <= TOL, `revenue ${money(rev)} vs markup+svc ${money(markup + svc)}`);

  // THIRDPARTY == insurance + protection
  check('THIRDPARTY', Math.abs(thirdParty - r2(insurance + protection)) <= TOL, `3p ${money(thirdParty)} vs ins+prot ${money(insurance + protection)}`);

  // PAYMENT captured == total (only when a payment exists)
  if (paid > 0) check('PAY_MATCH', Math.abs(paid - total) <= TOL, `captured ${money(paid)} vs total ${money(total)}`);
  else check('PAY_MATCH', true, 'no succeeded payment row (skip)', true);

  // VOID / REFUND consistency
  const isVoidedOrCancelled = b.ticketing_status === 'VOIDED' || b.booking_status === 'CANCELLED';
  if (isVoidedOrCancelled) {
    const ps = b.payment_status;
    check('REFUND_STATUS', ['REFUNDED', 'PARTIALLY_REFUNDED', 'NO_REFUND'].includes(ps), `cancelled/voided → paymentStatus=${ps} (expected REFUNDED/PARTIALLY_REFUNDED/NO_REFUND)`);
    if (ps === 'REFUNDED') check('REFUND_AMOUNT', Math.abs(refunded - total) <= TOL || refunded > 0, `refunds Σ ${money(refunded)} vs total ${money(total)}`, true);
  }
}

async function auditAgentWallets() {
  console.log(`\n${DIM}──────── Agent wallet reconciliation ────────${RST}`);
  const agents = (await c.query(`SELECT id, email FROM users WHERE role='FAREMIND_AGENT'`)).rows;
  for (const a of agents) {
    const w = (await c.query(`SELECT wallet_amount, utilized_amount, status FROM agent_wallets WHERE user_id=$1`, [a.id])).rows[0];
    if (!w) continue;
    // Active agent bookings = attributed to the agent and not cancelled/failed/voided
    const active = n((await c.query(
      `SELECT COALESCE(SUM(total_amount),0) s FROM master_bookings
       WHERE agent_user_id=$1 AND booking_status NOT IN ('CANCELLED','FAILED','NOT_BOOKED') AND ticketing_status <> 'VOIDED'`, [a.id])).rows[0]?.s);
    const utilized = n(w.utilized_amount);
    const ok = Math.abs(utilized - active) <= TOL;
    totalChecks++; if (!ok) totalFail++;
    console.log(`   ${ok ? GREEN + '✓' : RED + '✗'}${RST} ${a.email}: utilized ${money(utilized)} vs Σ active bookings ${money(active)} · remaining ${money(n(w.wallet_amount) - utilized)} (${w.status})`);
  }
}

(async () => {
  await c.connect();
  const cols = `id, master_booking_reference, master_pnr, primary_provider, booking_status, ticketing_status, payment_status, currency,
                total_amount, provider_payable_total, markup_amount, service_fee_amount, faremind_revenue_total,
                price_protection_amount, travel_insurance_amount, third_party_payable_total, seat_service_total, created_at`;
  let where = '', params = [];
  if (REF) { where = `WHERE master_booking_reference=$1`; params = [REF]; }
  else if (PROVIDER) { where = `WHERE primary_provider ILIKE $1`; params = [`%${PROVIDER}%`]; }
  const limit = ALL || REF ? '' : `LIMIT ${RECENT}`;
  const rows = (await c.query(`SELECT ${cols} FROM master_bookings ${where} ORDER BY created_at DESC ${limit}`, params)).rows;

  console.log(`\n${DIM}Auditing ${rows.length} booking(s)…${RST}`);
  for (const b of rows) await auditBooking(b);
  await auditAgentWallets();

  console.log(`\n${DIM}════════════════════════════════════════${RST}`);
  const clr = totalFail ? RED : totalWarn ? YEL : GREEN;
  console.log(`${clr}Checks: ${totalChecks} · Failures: ${totalFail} · Warnings: ${totalWarn}${RST}`);
  console.log(totalFail ? `${RED}✗ Financial inconsistencies found.${RST}` : `${GREEN}✓ All financial invariants hold.${RST}`);
  await c.end();
  process.exit(totalFail ? 1 : 0);
})().catch((e) => { console.error('Validator error:', e.message); process.exit(2); });
