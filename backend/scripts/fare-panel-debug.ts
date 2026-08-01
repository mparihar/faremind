/**
 * Fare-panel debug: why does an itinerary show N cards?
 *
 *   cd backend && npx tsx scripts/fare-panel-debug.ts [ORIG DEST DEPART RETURN]
 *
 * Answers, for one real search, the twelve questions needed to tell whether a
 * missing fare family was never returned by Mystifly, or was returned and then
 * lost somewhere in our pipeline.
 *
 * Read-only. No DB, no booking, no writes.
 */
import { normalizeMystiflyOffer, mergeAndRankFlights } from '../src/services/normalizer';

const MF = process.env.MYSTIFLY_BASE_URL || 'https://restapidemo.myfarebox.com';
const TOKEN = process.env.MYSTIFLY_SESSION_TOKEN || '809C4C04-03BB-4EA1-8EC5-C98ECCEC704D-6828';

const [origin = 'DEL', dest = 'BOM', dep = '2026-11-23', ret = '2026-12-11'] = process.argv.slice(2);

async function search(cap: string) {
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
      PassengerTypeQuantities: [{ Code: 'ADT', Quantity: 1 }],
      RequestOptions: cap, NearByAirports: false, IsResidentFare: false,
      Target: 'Test', IsInfantWithSeat: false,
    }),
  });
  return (await res.json())?.Data;
}

function toFlights(d: any): any[] {
  if (!d) return [];
  const segMap = new Map<number, any>((d.FlightSegmentList || []).map((s: any) => [s.SegmentRef, s]));
  const refMap = new Map<number, any>((d.ItineraryReferenceList || []).map((r: any) => [r.ItineraryRef, r]));
  const fareMap = new Map<number, any>((d.FlightFaresList || []).map((f: any) => [f.FareRef, f]));
  const penMap = new Map<number, any>((d.PenaltiesInfoList || []).map((p: any) => [p.PenaltiesInfoRef, p]));

  return (d.PricedItineraries || []).map((itin: any) => {
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
    try {
      const f: any = normalizeMystiflyOffer({
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
      });
      f._fareBasis = [...legs.values()].flat().map((s: any) => s.FareBasisCode).filter(Boolean).join(',');
      return f;
    } catch { return null; }
  }).filter(Boolean);
}

async function main() {
  for (const cap of ['TwoHundred', 'Thousand']) {
    const d = await search(cap);
    const flights = toFlights(d);

    console.log(`\n${'═'.repeat(86)}`);
    console.log(`${origin}↔${dest}  ${dep} / ${ret}   RequestOptions=${cap}`);
    console.log('═'.repeat(86));

    // 1-2
    console.log(`1. raw offers returned by Mystifly     : ${(d?.PricedItineraries || []).length}`);
    const groups = new Map<string, any[]>();
    for (const f of flights) {
      if (!groups.has(f.itineraryKey)) groups.set(f.itineraryKey, []);
      groups.get(f.itineraryKey)!.push(f);
    }
    console.log(`2. distinct complete itineraries       : ${groups.size}`);

    // 11 — what the dedup does
    const merged = mergeAndRankFlights(flights);
    console.log(`   after mergeAndRankFlights()         : ${merged.length}  (dropped ${flights.length - merged.length})`);

    const laddered = [...groups.entries()].filter(([, v]) => v.length > 1);
    console.log(`   itineraries with >1 offer           : ${laddered.length}`);

    // 3-10 — the richest ladder on this route, which is what a panel would show
    const [key, offers] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
    if (!offers || offers.length === 0) { console.log('   no offers'); continue; }

    const segs = offers[0].segments.map((s: any) => `${s.flightNumber} ${s.departure.airport}→${s.arrival.airport}`).join('  |  ');
    console.log(`\n3. offers on the richest itinerary     : ${offers.length}`);
    console.log(`   ${segs}`);
    console.log(`   itineraryKey=${String(key).slice(0, 70)}…\n`);

    console.log(`   ${'family'.padEnd(16)} ${'cabin'.padEnd(9)} ${'RBD'.padEnd(4)} ${'fareBasis'.padEnd(18)} ${'price'.padStart(9)} ${'bag'.padEnd(7)} ${'cabinBag'.padEnd(8)} refund/change`);
    for (const o of [...offers].sort((a, b) => a.totalPrice - b.totalPrice)) {
      console.log(
        `   ${String(o.airlineFareFamily || '(none)').padEnd(16)} ${String(o.cabinClass).padEnd(9)} ` +
        `${String(o.bookingClass || '-').padEnd(4)} ${String(o._fareBasis || '-').slice(0, 17).padEnd(18)} ` +
        `${('$' + o.totalPrice).padStart(9)} ${String(o.checkedBaggageAllowance || '-').padEnd(7)} ` +
        `${String(o.cabinBaggageAllowance || '-').padEnd(8)} ` +
        `${o.fareRules.refundable ? 'refundable' : 'non-refund'}/${o.fareRules.changeable ? 'changeable' : 'non-change'}`,
      );
    }

    // 12 — what survives dedup for this itinerary = what the panel renders
    const survivors = merged.filter((m: any) => m.itineraryKey === key);
    console.log(`\n12. cards the panel would render       : ${survivors.length}`);
    for (const s of [...survivors].sort((a: any, b: any) => a.totalPrice - b.totalPrice)) {
      console.log(`    ${String(s.airlineFareFamily || '(none → labelled by cabin)').padEnd(30)} $${s.totalPrice}`);
    }
    const lost = offers.length - survivors.length;
    if (lost > 0) console.log(`    ⚠ ${lost} offer(s) collapsed by dedup before reaching the panel`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
