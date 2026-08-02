// Temporary probe — DELETE after use.
import fs from 'node:fs';

// --- load .env manually (no dotenv dependency assumptions) ---
const envText = fs.readFileSync(new URL('./.env', import.meta.url), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

const API = env.MYSTIFLY_API_URL || 'https://restapidemo.myfarebox.com';
const TARGET = env.MYSTIFLY_TARGET || 'Test';

console.log('API URL :', API);
console.log('TARGET  :', TARGET);
console.log('USER    :', env.MYSTIFLY_USERNAME);
console.log('ACCOUNT :', env.MYSTIFLY_ACCOUNT_NUMBER);
console.log('');

async function createSession() {
  const res = await fetch(`${API}/api/CreateSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      UserName: env.MYSTIFLY_USERNAME,
      Password: env.MYSTIFLY_PASSWORD,
      AccountNumber: env.MYSTIFLY_ACCOUNT_NUMBER,
    }),
  });
  const j = await res.json();
  const sid = j?.Data?.SessionId;
  if (!sid) {
    console.log('AUTH FAILED', res.status, JSON.stringify(j).slice(0, 800));
    process.exit(1);
  }
  return sid;
}

// Request shape copied verbatim from backend/src/services/mystifly.ts searchFlights()
function buildSearchRQ(cabin) {
  return {
    OriginDestinationInformations: [
      {
        DepartureDateTime: '2026-09-10T00:00:00',
        OriginLocationCode: 'BCN',
        DestinationLocationCode: 'MUC',
      },
    ],
    TravelPreferences: {
      MaxStopsQuantity: 'All',
      CabinPreference: cabin,
      AirTripType: 'OneWay',
    },
    PricingSourceType: 'All',
    IsRefundable: false,
    PassengerTypeQuantities: [{ Code: 'ADT', Quantity: 1 }],
    RequestOptions: 'Thousand',
    NearByAirports: false,
    IsResidentFare: false,
    Target: TARGET,
    IsInfantWithSeat: false,
  };
}

async function search(token, cabin) {
  const res = await fetch(`${API}/api/v2.2/Search/Flight`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(buildSearchRQ(cabin)),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { __raw: text.slice(0, 2000) }; }
  return { status: res.status, json };
}

function analyze(cabin, status, json) {
  const d = json?.Data ?? json;
  console.log(`\n${'='.repeat(70)}\nCABIN = ${cabin}   HTTP ${status}\n${'='.repeat(70)}`);

  const err = d?.Errors ?? d?.Error ?? json?.Errors ?? json?.Error;
  if (err && (Array.isArray(err) ? err.length : Object.keys(err || {}).length)) {
    console.log('ERRORS:', JSON.stringify(err).slice(0, 800));
  }
  console.log('Top-level Data keys:', d && typeof d === 'object' ? Object.keys(d).join(', ') : String(d));

  const irl = d?.ItineraryReferenceList || [];
  const fsl = d?.FlightSegmentList || [];
  const ffl = d?.FlightFaresList || [];
  const gi  = d?.GroupedItems || [];
  const pi  = d?.PricedItineraries || [];

  console.log(`Counts -> ItineraryReferenceList=${irl.length} FlightSegmentList=${fsl.length} FlightFaresList=${ffl.length} GroupedItems=${gi.length} PricedItineraries=${pi.length}`);

  if (irl.length === 0) {
    // dump a small sample to prove emptiness / show error envelope
    console.log('EMPTY BODY SAMPLE:', JSON.stringify(json).slice(0, 1200));
    return;
  }

  console.log('Sample ItineraryReferenceList[0] keys:', Object.keys(irl[0]).join(', '));
  console.log('Sample ItineraryReferenceList[0]:', JSON.stringify(irl[0]).slice(0, 1200));

  const cabinCounts = {};
  const familyCounts = {};
  const carrierCounts = {};
  const carrierCabin = {};
  const carrierFamily = {};

  // segment lookup by key
  const segById = {};
  for (const s of fsl) {
    const key = s.FlightSegmentKey ?? s.SegmentKey ?? s.Key ?? s.Id ?? s.ReferenceKey;
    if (key != null) segById[String(key)] = s;
  }

  for (const it of irl) {
    const cc = it.CabinClass ?? it.CabinType ?? '(none)';
    cabinCounts[cc] = (cabinCounts[cc] || 0) + 1;
    const ff = it.FareFamily ?? '(none)';
    familyCounts[ff] = (familyCounts[ff] || 0) + 1;

    // carriers: collect from referenced segments
    const segRefs = [];
    const collect = (v) => {
      if (v == null) return;
      if (Array.isArray(v)) { v.forEach(collect); return; }
      if (typeof v === 'object') { Object.values(v).forEach(collect); return; }
      segRefs.push(String(v));
    };
    collect(it.SegmentRefs ?? it.FlightSegmentRefs ?? it.OriginDestinationOptions ?? it.Segments ?? it.FlightSegmentKeys);

    const carriers = new Set();
    for (const r of segRefs) {
      const s = segById[r];
      if (!s) continue;
      const c = s.MarketingAirlineCode ?? s.OperatingAirlineCode ?? s.MarketingAirline ?? s.AirlineCode;
      if (c) carriers.add(String(c));
    }
    // fallback: ValidatingCarrier on the itinerary itself
    const vc = it.ValidatingCarrier ?? it.ValidatingAirlineCode;
    if (vc) carriers.add(String(vc));

    for (const c of carriers) {
      carrierCounts[c] = (carrierCounts[c] || 0) + 1;
      (carrierCabin[c] ||= new Set()).add(cc);
      (carrierFamily[c] ||= new Set()).add(ff);
    }
  }

  console.log('\nDistinct CabinClass values (count):');
  for (const [k, v] of Object.entries(cabinCounts).sort((a, b) => b[1] - a[1])) console.log(`   ${k} : ${v}`);

  console.log('\nDistinct FareFamily values (count):');
  for (const [k, v] of Object.entries(familyCounts).sort((a, b) => b[1] - a[1])) console.log(`   ${JSON.stringify(k)} : ${v}`);

  console.log('\nCarriers (itineraries touched):');
  for (const [k, v] of Object.entries(carrierCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k} : ${v}  cabins=[${[...(carrierCabin[k] || [])].join(',')}]  families=[${[...(carrierFamily[k] || [])].map(x => JSON.stringify(x)).join(',')}]`);
  }

  // Segment-level airline set (independent of ref resolution)
  const segCarriers = {};
  for (const s of fsl) {
    const c = s.MarketingAirlineCode ?? s.OperatingAirlineCode ?? s.MarketingAirline ?? s.AirlineCode ?? '(?)';
    segCarriers[c] = (segCarriers[c] || 0) + 1;
  }
  console.log('\nSegment-level marketing carriers:', JSON.stringify(segCarriers));
  if (fsl.length) console.log('Sample FlightSegmentList[0]:', JSON.stringify(fsl[0]).slice(0, 900));

  // dump raw for cabin Y so we can dig further
  fs.writeFileSync(new URL(`./.probe-out-${cabin}.json`, import.meta.url), JSON.stringify(json));
}

const token = await createSession();
console.log('Session OK, token len', token.length);

for (const cabin of ['Y', 'C', 'F']) {
  const { status, json } = await search(token, cabin);
  analyze(cabin, status, json);
}
