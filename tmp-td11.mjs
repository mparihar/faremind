import pg from 'pg';
const c=new pg.Client({connectionString:'postgresql://postgres:bvlZtqcimfEoxvnUVKLkXuyLWyXUdcCK@metro.proxy.rlwy.net:21302/railway',ssl:{rejectUnauthorized:false}});
await c.connect();
const b=(await c.query(`select id, mystifly_mf_ref mf, airline_pnr, booking_status, ticketing_status, payment_status,
   trip_type, origin_airport o, destination_airport d, total_amount, currency, provider_payable_total,
   service_fee_amount, airline_fare_family, booking_class, booking_source, created_at
   from master_bookings where master_booking_reference='FMP4N1Y2'`)).rows[0];
console.log('── our record ──'); console.log(b ?? '(not found)');
if (b) {
  console.log('\n── passengers ──');
  console.table((await c.query(`select passenger_type typ,first_name,last_name,gender,date_of_birth::text dob,
     nationality,passport_number,phone from booking_passengers where booking_id=$1 order by passenger_order`,[b.id])).rows);
  console.log('── segments ──');
  console.table((await c.query(`select flight_number,origin_airport ori,destination_airport dst,
     departure_datetime::text dep,arrival_datetime::text arr from booking_segments where booking_id=$1 order by segment_order`,[b.id])).rows);
  console.log('── extras recorded (meals / seats / bags) ──');
  for (const t of ['booking_meals','booking_seats','booking_baggage']) {
    const r=await c.query(`select * from ${t} where booking_id=$1`,[b.id]).catch(()=>({rows:[],rowCount:0}));
    console.log(`  ${t}: ${r.rowCount}`);
    for (const row of r.rows) console.log('     ', JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k,v])=>v!==null&&v!==''&&!k.endsWith('_at')&&!k.endsWith('_id')))).slice(0,160));
  }
}
await c.end();
const MF='https://restapidemo.myfarebox.com';
const a=await fetch(`${MF}/api/CreateSession`,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({UserName:'FareMind_API',Password:'Welcome@123',AccountNumber:'MCN006482'})});
const s=(await a.json())?.Data?.SessionId;
const r=await fetch(`${MF}/api/TripDetails/${b.mf}`,{headers:{'Content-Type':'application/json',Authorization:`Bearer ${s}`}});
console.log(`\n═══ RAW TripDetails  HTTP ${r.status}  ${b.mf} ═══\n`);
console.log(JSON.stringify(await r.json(),null,2));
