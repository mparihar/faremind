import pg from 'pg';
const c = new pg.Client({ connectionString: 'postgresql://postgres:bvlZtqcimfEoxvnUVKLkXuyLWyXUdcCK@metro.proxy.rlwy.net:21302/railway', ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows } = await c.query(`
  select s.id, s.segment_order, s.direction, s.raw_segment_payload,
         s.departure_datetime::text as dep_text, s.arrival_datetime::text as arr_text,
         mb.master_booking_reference as ref
    from booking_segments s join master_bookings mb on mb.id=s.booking_id
   order by mb.created_at desc`);
const norm = s => typeof s === 'string' ? s.trim().replace('T',' ').slice(0,19) : null;
let ok=0, bad=0, unk=0;
for (const r of rows) {
  const want = norm(r.raw_segment_payload?.departure?.time);
  if (!want) { unk++; continue; }
  if (want === r.dep_text) ok++;
  else { bad++; if (bad<=6) console.log(`  ${r.ref} seg${r.segment_order} ${r.direction}: db "${r.dep_text}"  should be "${want}"`); }
}
console.log(`\nsegments: ${ok} correct · ${bad} wrong · ${unk} no raw payload`);
await c.end();
