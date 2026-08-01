/**
 * Where do the provider's fares go? Counts survivors at each pipeline stage.
 *
 *   cd backend && npx tsx scripts/trace-result-count.ts [ORIG DEST DEPART RETURN ADULTS]
 *
 * Replays the real path — provider search → orchestrator merge → normalizer →
 * mergeAndRankFlights() dedup — and reports what each stage drops, so a result
 * count in the UI can be traced back to a specific cause.
 *
 * Read-only. No DB, no booking, no writes.
 */
import { normalizeMystiflyOffer, mergeAndRankFlights } from '../src/services/normalizer';

const MF = process.env.MYSTIFLY_BASE_URL || 'https://restapidemo.myfarebox.com';
const TOKEN = process.env.MYSTIFLY_SESSION_TOKEN || '809C4C04-03BB-4EA1-8EC5-C98ECCEC704D-6828';

const [origin = 'DEL', dest = 'BOM', dep = '2026-11-23', ret = '2026-12-11', adultsArg = '2'] = process.argv.slice(2);
const adults = parseInt(adultsArg, 10) || 1;

async function run(cap: string) {
  const res = await fetch(`${MF}/api/v2.2/Search/Flight`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      OriginDestinationInformations: [
        { DepartureDateTime: `${dep}T00:00:00`, OriginLocationCode: origin, DestinationLocationCode: dest },
        { DepartureDateTime: `${ret}T00:00:00`, OriginLocationCode: dest, DestinationLocationCode: origin },
      ],
      TravelPreferences: { MaxStopsQuantity: 'All', CabinPreference: 'Y', AirTripType: 'Return' },
      PricingSourceType: 'All', IsRefundable: false,
      PassengerTypeQuantities: [{ Code: 'ADT', Quantity: adults }],
      RequestOptions: cap, NearByAirports: false, IsResidentFare: false,
      Target: 'Test', IsInfantWithSeat: false,
    }),
  });
  const d: any = (await res.json())?.Data;
  if (!d) return null;

  const segMap = new Map<number, any>((d.FlightSegmentList || []).map((s: any) => [s.SegmentRef, s]));
  const refMap = new Map<number, any>((d.ItineraryReferenceList || []).map((r: any) => [r.ItineraryRef, r]));
  const fareMap = new Map<number, any>((d.FlightFaresList || []).map((f: any) => [f.FareRef, f]));
  const penMap = new Map<number, any>((d.PenaltiesInfoList || []).map((p: any) => [p.PenaltiesInfoRef, p]));

  const raw = d.PricedItineraries || [];

  const denorm = raw.map((itin: any) => {
    const legs = new Map<string, any[]>();
    for (const od of itin.OriginDestinations || []) {
      const leg = od.LegIndicator || '0';
      if (!legs.has(leg)) legs.set(leg, []);
      const seg = segMap.get(od.SegmentRef);
      const ref = refMap.get(od.ItineraryRef);
      if (!seg) continue;
      legs.get(leg)!.push({
        ...seg,
        MarketingAirlineCode: seg.MarketingCarriercode || '',
        FlightNumber: seg.MarketingFlightNumber || '',
        OperatingAirline: { Code: seg.OperatingCarrierCode || '' },
        CabinClassCode: ref?.CabinClassCode || 'Y',
        Baggage: ref?.CheckinBaggage?.[0]?.Value || '',
        CabinBaggage: ref?.CabinBaggage?.[0]?.Value || '',
        SeatsRemaining: ref?.SeatsRemaining,
        FareBasisCode: ref?.FareBasisCodes || '',
        FareFamily: ref?.FareFamily || '',
        RBD: ref?.RBD || '',
      });
    }
    const fare = fareMap.get(itin.FareRef);
    const pen = penMap.get(itin.PenaltiesInfoRef)?.Penaltydetails?.[0];
    const pf = fare?.PassengerFare?.[0];
    return {
      FareSourceCode: itin.FareSourceCode,
      ValidatingCarrier: itin.ValidatingCarrier,
      DirectionInd: 'Return',
      OriginDestinationOptions: [...legs.entries()]
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, s]) => ({ FlightSegments: s })),
      AirItineraryPricingInfo: {
        FareType: fare?.FareType,
        ItinTotalFare: {
          BaseFare: { Amount: pf?.BaseFare, CurrencyCode: fare?.Currency },
          TotalFare: { Amount: pf?.TotalFare, CurrencyCode: fare?.Currency },
        },
        _taxBreakUp: pf?.TaxBreakUp || [],
      },
      _penalties: pen ? {
        refundAllowed: pen.RefundAllowed, changeAllowed: pen.ChangeAllowed,
        refundPenaltyAmount: parseFloat(pen.RefundPenaltyAmount || '0'),
        changePenaltyAmount: parseFloat(pen.ChangePenaltyAmount || '0'),
        penaltyCurrency: pen.Currency,
      } : undefined,
    };
  });

  let normFailed = 0;
  const flights = denorm.map((x: any) => {
    try { return normalizeMystiflyOffer(x); } catch { normFailed++; return null; }
  }).filter(Boolean) as any[];

  // mergeAndRankFlights drops invalid offers first, then dedups.
  const invalid = flights.filter((f) => !(f.totalPrice > 0) || !(f.totalDuration > 0) || f.segments.length === 0).length;
  const merged = mergeAndRankFlights(flights);

  // Reproduce the dedup key so we can see WHAT is collapsing.
  const keyOf = (f: any) =>
    `${f.airline.code}-${f.segments[0]?.departure.time}-${f.segments[0]?.departure.airport}-${f.totalPrice}-${f.fareRules.refundable ? 'R' : 'NR'}`;
  const buckets = new Map<string, any[]>();
  for (const f of flights) {
    if (!(f.totalPrice > 0) || !(f.totalDuration > 0) || f.segments.length === 0) continue;
    const k = keyOf(f);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(f);
  }
  const collapsed = [...buckets.values()].filter((v) => v.length > 1);

  return { cap, raw: raw.length, groups: (d.GroupedItems || []).length, normFailed, invalid, flights: flights.length, merged: merged.length, buckets, collapsed };
}

async function main() {
  console.log(`RESULT-COUNT TRACE — ${origin}→${dest} ${dep} / ${ret}, ${adults} adult(s), economy, round trip\n`);

  for (const cap of ['TwoHundred', 'Thousand']) {
    const r = await run(cap);
    if (!r) { console.log(`${cap}: no data`); continue; }

    console.log(`════ RequestOptions=${r.cap} ════`);
    console.log(`  1. provider priced fares          ${String(r.raw).padStart(5)}`);
    console.log(`  2. distinct physical flights      ${String(r.groups).padStart(5)}   (provider's own GroupedItems)`);
    console.log(`  3. normalize failures             ${String(r.normFailed).padStart(5)}`);
    console.log(`  4. dropped as invalid             ${String(r.invalid).padStart(5)}   (no price / no duration / no segments)`);
    console.log(`  5. AFTER dedup (what the UI gets) ${String(r.merged).padStart(5)}   <-- mergeAndRankFlights()`);
    console.log(`     collapsed by dedup             ${String(r.flights - r.invalid - r.merged).padStart(5)}   across ${r.collapsed.length} keys`);

    // Show the biggest collapses and what actually differed inside them.
    const worst = [...r.collapsed].sort((a, b) => b.length - a.length).slice(0, 3);
    for (const group of worst) {
      const f0 = group[0];
      const fams = [...new Set(group.map((x: any) => x.airlineFareFamily || '(none)'))];
      const fscs = new Set(group.map((x: any) => x.providerOfferId));
      console.log(`\n     ── ${group.length} fares collapsed into 1 ──`);
      console.log(`        ${f0.airline.code} dep ${f0.segments[0]?.departure.time} $${f0.totalPrice} refundable=${f0.fareRules.refundable}`);
      console.log(`        distinct fare families : ${fams.join(', ')}`);
      console.log(`        distinct FareSourceCodes: ${fscs.size}`);
      const routes = [...new Set(group.map((x: any) => x.segments.map((s: any) => `${s.flightNumber}`).join('+')))];
      console.log(`        distinct flight-number sets: ${routes.length}${routes.length > 1 ? '  <-- DIFFERENT FLIGHTS merged' : ''}`);
      if (routes.length > 1) routes.slice(0, 4).forEach((rt) => console.log(`           ${rt}`));
    }
    console.log();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
