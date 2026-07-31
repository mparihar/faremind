/**
 * End-to-end check of the fare-family pipeline against LIVE Mystifly data.
 *
 *   cd backend && npx tsx scripts/verify-fare-family.ts [ORIGIN] [DEST]
 *
 * Fetches a real v2.2 search, replays the orchestrator's segment merge, runs the
 * real normalizeMystiflyOffer(), then groups by itineraryKey to show the fare
 * ladder a customer would see. Read-only — no booking, no DB.
 */
import { normalizeMystiflyOffer } from '../src/services/normalizer';

const MF = process.env.MYSTIFLY_BASE_URL || 'https://restapidemo.myfarebox.com';
const TOKEN = process.env.MYSTIFLY_SESSION_TOKEN || '809C4C04-03BB-4EA1-8EC5-C98ECCEC704D-6828';

const [origin = 'DEL', dest = 'BOM'] = process.argv.slice(2);

async function main() {

  const res = await fetch(`${MF}/api/v2.2/Search/Flight`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      OriginDestinationInformations: [
        { DepartureDateTime: '2026-09-10T00:00:00', OriginLocationCode: origin, DestinationLocationCode: dest },
        { DepartureDateTime: '2026-10-03T00:00:00', OriginLocationCode: dest, DestinationLocationCode: origin },
      ],
      TravelPreferences: { MaxStopsQuantity: 'All', CabinPreference: 'Y', AirTripType: 'Return' },
      PricingSourceType: 'All', IsRefundable: false,
      PassengerTypeQuantities: [{ Code: 'ADT', Quantity: 1 }],
      RequestOptions: 'Thousand', NearByAirports: false, IsResidentFare: false,
      Target: 'Test', IsInfantWithSeat: false,
    }),
  });
  const d: any = (await res.json())?.Data;
  if (!d) { console.error('no Data in response'); process.exit(1); }

  const segMap = new Map<number, any>((d.FlightSegmentList || []).map((s: any) => [s.SegmentRef, s]));
  const itinRefMap = new Map<number, any>((d.ItineraryReferenceList || []).map((r: any) => [r.ItineraryRef, r]));
  const fareMap = new Map<number, any>((d.FlightFaresList || []).map((f: any) => [f.FareRef, f]));
  const penMap = new Map<number, any>((d.PenaltiesInfoList || []).map((p: any) => [p.PenaltiesInfoRef, p]));

  // Replay the orchestrator's merge (services/orchestrator.ts searchMystifly).
  const denormalized = (d.PricedItineraries || []).map((itin: any) => {
    const legGroups = new Map<string, any[]>();
    for (const od of itin.OriginDestinations || []) {
      const leg = od.LegIndicator || '0';
      if (!legGroups.has(leg)) legGroups.set(leg, []);
      const seg = segMap.get(od.SegmentRef);
      const itinRef = itinRefMap.get(od.ItineraryRef);
      if (!seg) continue;
      legGroups.get(leg)!.push({
        ...seg,
        MarketingAirlineCode: seg.MarketingCarriercode || '',
        FlightNumber: seg.MarketingFlightNumber || '',
        OperatingAirline: { Code: seg.OperatingCarrierCode || '' },
        CabinClassCode: itinRef?.CabinClassCode || 'Y',
        Baggage: itinRef?.CheckinBaggage?.[0]?.Value || '',
        CabinBaggage: itinRef?.CabinBaggage?.[0]?.Value || '',
        SeatsRemaining: itinRef?.SeatsRemaining,
        FareBasisCode: itinRef?.FareBasisCodes || '',
        FareFamily: itinRef?.FareFamily || '',
        RBD: itinRef?.RBD || '',
      });
    }
    const fare = fareMap.get(itin.FareRef);
    const pen = penMap.get(itin.PenaltiesInfoRef)?.Penaltydetails?.[0];
    const pf = fare?.PassengerFare?.[0];
    return {
      FareSourceCode: itin.FareSourceCode,
      ValidatingCarrier: itin.ValidatingCarrier,
      DirectionInd: 'Return',
      OriginDestinationOptions: [...legGroups.entries()]
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, segs]) => ({ FlightSegments: segs })),
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

  const flights = denormalized.map((x: any) => {
    try { return normalizeMystiflyOffer(x); } catch { return null; }
  }).filter(Boolean) as any[];

  console.log(`${origin}↔${dest}: ${flights.length} offers normalized\n`);

  const missing = flights.filter((f) => !f.airlineFareFamily).length;
  console.log(`airlineFareFamily populated: ${flights.length - missing}/${flights.length}`);
  const tiers: Record<string, number> = {};
  const families: Record<string, string> = {};
  for (const f of flights) {
    tiers[f.normalizedFareTier] = (tiers[f.normalizedFareTier] || 0) + 1;
    if (f.airlineFareFamily) families[f.airlineFareFamily] = f.normalizedFareTier;
  }
  console.log('normalized tier spread:', JSON.stringify(tiers));
  console.log('\nairline brand → internal tier (brand is what the customer sees):');
  for (const [fam, tier] of Object.entries(families).sort()) {
    console.log(`  ${fam.padEnd(20)} → ${tier}`);
  }

  // The fare panel groups by itineraryKey — same metal, different fare families.
  const groups = new Map<string, any[]>();
  for (const f of flights) {
    if (!groups.has(f.itineraryKey)) groups.set(f.itineraryKey, []);
    groups.get(f.itineraryKey)!.push(f);
  }
  const ladders = [...groups.values()].filter((g) => new Set(g.map((x) => x.airlineFareFamily)).size > 1);
  console.log(`\nflights with a real fare ladder: ${ladders.length} of ${groups.size}`);
  for (const g of ladders.slice(0, 3)) {
    const s = g[0].segments[0];
    console.log(`\n  ── ${s.airline?.code ?? g[0].airline.code}${s.flightNumber} ${s.departure.airport}→${s.arrival.airport} ──`);
    for (const f of [...g].sort((a, b) => a.totalPrice - b.totalPrice)) {
      console.log(`     $${String(f.totalPrice).padStart(8)}  ${String(f.airlineFareFamily).padEnd(18)} [${f.normalizedFareTier.padEnd(8)}] rbd=${String(f.bookingClass).padEnd(3)} bag=${String(f.checkedBaggageAllowance).padEnd(6)}(${f.baggage.checked}pc) cabin=${String(f.cabinBaggageAllowance).padEnd(5)} seats=${f.seatsRemaining ?? '-'} refundable=${f.fareRules.refundable}`);
    }
  }

}

main().catch((e) => { console.error(e); process.exit(1); });
