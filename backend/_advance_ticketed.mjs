// TEST-ONLY: advance 3 bookings to TICKETED in the DB so Cancellation/Refund can
// be exercised. Pure data update — no app logic touched. Idempotent. Delete after.
import pg from 'pg';
import { randomUUID } from 'node:crypto';
const c = new pg.Client({ connectionString: process.env.PROD_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const refs = ['FMRZ7E0L', 'FMTE4PJ8', 'FMVTT9ZQ'];
const cid = () => 'ck' + randomUUID().replace(/-/g, '').slice(0, 22);

try {
  await c.query('BEGIN');
  for (const ref of refs) {
    const mb = (await c.query('SELECT id, master_pnr FROM master_bookings WHERE master_booking_reference=$1', [ref])).rows[0];
    if (!mb) { console.log(`${ref}: NOT FOUND — skipped`); continue; }
    const digits = (mb.master_pnr || ref).replace(/\D/g, '').slice(-8).padStart(8, '0');

    // 1) MasterBooking → TICKETED / ISSUED
    await c.query(
      `UPDATE master_bookings SET booking_status='TICKETED', ticketing_status='ISSUED',
         provider_booking_status='Ticketed', updated_at=now() WHERE id=$1`, [mb.id]);

    // 2) Resolve reconciliation record (stop escalation, mark ticketed)
    await c.query(
      `UPDATE ticketing_reconciliations
         SET status='TICKETED', resolved_at=now(), resolved_by='MANUAL_TEST',
             resolution_notes='Manually advanced to TICKETED for cancellation/refund testing', updated_at=now()
       WHERE booking_id=$1`, [mb.id]);

    // 3) Ensure ticket rows carry an e-ticket number (needed by void/refund/reissue).
    const tix = (await c.query('SELECT id, e_ticket_number, ticket_number FROM booking_tickets WHERE booking_id=$1 ORDER BY created_at', [mb.id])).rows;
    let seq = 1;
    if (tix.length === 0) {
      // Create one ticket row per passenger.
      const pax = (await c.query('SELECT id FROM booking_passengers WHERE booking_id=$1 ORDER BY created_at', [mb.id])).rows;
      for (const p of pax) {
        const et = `157${digits}${String(seq).padStart(2, '0')}`; // test e-ticket (sandbox has no real one)
        await c.query(
          `INSERT INTO booking_tickets (id, booking_id, passenger_id, ticket_number, e_ticket_number, ticket_status, issued_at, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$4,'ISSUED', now(), now(), now())`, [cid(), mb.id, p.id, et]);
        seq++;
      }
      console.log(`${ref}: created ${pax.length} ticket row(s) with test e-tickets`);
    } else {
      for (const t of tix) {
        if (!t.e_ticket_number && !t.ticket_number) {
          const et = `157${digits}${String(seq).padStart(2, '0')}`;
          await c.query(`UPDATE booking_tickets SET e_ticket_number=$2, ticket_number=$2, ticket_status='ISSUED', issued_at=now(), updated_at=now() WHERE id=$1`, [t.id, et]);
        } else {
          await c.query(`UPDATE booking_tickets SET ticket_status='ISSUED', issued_at=COALESCE(issued_at, now()), updated_at=now() WHERE id=$1`, [t.id]);
        }
        seq++;
      }
      console.log(`${ref}: updated ${tix.length} existing ticket row(s) to ISSUED`);
    }
  }
  await c.query('COMMIT');
  console.log('\n✅ Committed. Verifying…\n');
} catch (e) {
  await c.query('ROLLBACK').catch(() => {});
  console.error('❌ Failed, rolled back:', e.message);
  await c.end();
  process.exit(1);
}

// Verify
for (const ref of refs) {
  const r = (await c.query(
    `SELECT mb.master_booking_reference ref, mb.master_pnr, mb.booking_status, mb.ticketing_status,
            (SELECT count(*)::int FROM booking_tickets bt WHERE bt.booking_id=mb.id AND bt.e_ticket_number IS NOT NULL) tix_with_etkt,
            (SELECT string_agg(e_ticket_number, ', ') FROM booking_tickets bt WHERE bt.booking_id=mb.id) etkts
     FROM master_bookings mb WHERE mb.master_booking_reference=$1`, [ref])).rows[0];
  console.log(`${r.ref} pnr=${r.master_pnr} → ${r.booking_status}/${r.ticketing_status} | tickets w/ eTkt=${r.tix_with_etkt} [${r.etkts ?? '-'}]`);
}
await c.end();
