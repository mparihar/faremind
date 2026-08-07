import pg from 'pg';
const c=new pg.Client({connectionString:'postgresql://postgres:bvlZtqcimfEoxvnUVKLkXuyLWyXUdcCK@metro.proxy.rlwy.net:21302/railway',ssl:{rejectUnauthorized:false}});
await c.connect();
const b=(await c.query(`select id, mystifly_mf_ref mf, master_pnr, airline_pnr, booking_status, ticketing_status, trip_type,
   origin_airport o, destination_airport d, total_amount, currency, provider_payable_total, service_fee_amount,
   airline_fare_family, booking_class, booking_source, created_at
   from master_bookings where master_booking_reference='FM78J1NG'`)).rows[0];
console.log('── our record ──'); console.log(b ?? '(not found)');
if (b) {
  console.log('\n── pnr rows ──');
  console.table((await c.query(`select pnr_code,pnr_type,airline_pnr,status,provider from booking_pnrs where booking_id=$1`,[b.id])).rows);
  console.log('── tickets ──');
  console.table((await c.query(`select e_ticket_number,ticket_status from booking_tickets where booking_id=$1`,[b.id])).rows);
  console.log('── segments ──');
  console.table((await c.query(`select direction,flight_number,origin_airport ori,destination_airport dst,
     departure_datetime::text dep from booking_segments where booking_id=$1 order by direction,segment_order`,[b.id])).rows);
  console.log('── meals recorded ──');
  console.table((await c.query(`select direction,meal_code,meal_label from booking_meals where booking_id=$1`,[b.id])).rows);
}
await c.end();
const MF='https://restapidemo.myfarebox.com';
const a=await fetch(`${MF}/api/CreateSession`,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({UserName:'FareMind_API',Password:'Welcome@123',AccountNumber:'MCN006482'})});
const s=(await a.json())?.Data?.SessionId;
const r=await fetch(`${MF}/api/TripDetails/${b.mf}`,{headers:{'Content-Type':'application/json',Authorization:`Bearer ${s}`}});
console.log(`\n═══ RAW TripDetails  HTTP ${r.status}  ${b.mf} ═══\n`);
console.log(JSON.stringify(await r.json(),null,2));
