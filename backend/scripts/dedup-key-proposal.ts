/**
 * Dedup-key proposal: what each candidate key would do to result counts.
 *
 *   cd backend && npx tsx scripts/dedup-key-proposal.ts
 *
 * The current key in mergeAndRankFlights() uses `segments[0]` only, so the
 * return journey is absent and distinct round trips collapse. This measures
 * three candidates across several routes and both provider caps, and reports
 * how many genuinely-different trips each one recovers.
 *
 *   A  current   airline + seg[0].dep.time + seg[0].dep.airport + price + refundable
 *   B  +return   A, plus the LAST segment's departure time
 *   C  full      every segment (airline+flightNo+airports+time) + price + refundable
 *
 * C is the `itineraryKey` already used to group the fare panel.
 *
 * Read-only. No DB, no booking, no writes.
 */
import { normalizeMystiflyOffer } from '../src/services/normalizer';
import { itineraryKey } from '../src/services/fare-family';

const MF = process.env.MYSTIFLY_BASE_URL || 'https://restapidemo.myfarebox.com';
const TOKEN = process.env.MYSTIFLY_SESSION_TOKEN || '809C4C04-03BB-4EA1-8EC5-C98ECCEC704D-6828';

const ROUTES: Array<[string, string, string, string, string]> = [
  ['DEL', 'BOM', '2026-11-23', '2026-12-11', 'domestic short-haul'],
  ['JFK', 'LHR', '2026-09-10', '2026-09-20', 'long-haul'],
  ['LHR', 'SIN', '2026-09-15', '2026-09-28', 'ultra long-haul'],
  ['SIN', 'SYD', '2026-09-10', '2026-09-20', 'regional long-haul'],
];

async function search(o: string, d: string, dep: string, ret: string, cap: string) {
  const res = await fetch(`${MF}/api/v2.2/Search/Flight`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      OriginDestinationInformations: [
        { DepartureDateTime: `${dep}T00:00:00`, OriginLocationCode: o, DestinationLocationCode: d },
        { DepartureDateTime: `${ret}T00:00:00`, OriginLocationCode: d, DestinationLocationCode: o },
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
      return normalizeMystiflyOffer({
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
    } catch { return null; }
  }).filter(Boolean);
}

const valid = (f: any) => f.totalPrice > 0 && f.totalDuration > 0 && f.segments.length > 0;

const keyA = (f: any) =>
  `${f.airline.code}-${f.segments[0]?.departure.time}-${f.segments[0]?.departure.airport}-${f.totalPrice}-${f.fareRules.refundable ? 'R' : 'NR'}`;

const keyB = (f: any) => {
  const last = f.segments[f.segments.length - 1];
  return `${keyA(f)}-${last?.departure.time ?? ''}`;
};

const keyC = (f: any) =>
  `${itineraryKey(f.segments)}-${f.totalPrice}-${f.fareRules.refundable ? 'R' : 'NR'}`;

/** How many offers in this bucket set fly a genuinely different set of flights? */
function distinctTrips(flights: any[]): number {
  return new Set(flights.map((f) => itineraryKey(f.segments))).size;
}

function count(flights: any[], keyFn: (f: any) => string): number {
  return new Set(flights.filter(valid).map(keyFn)).size;
}

async function main() {
  console.log('DEDUP-KEY PROPOSAL — how many distinct trips each candidate key preserves\n');
  console.log('  A = current  (outbound only)   B = A + return departure   C = full itinerary\n');
  console.log(`${'route'.padEnd(22)} ${'cap'.padEnd(11)} ${'fares'.padStart(6)} ${'realTrips'.padStart(10)} ${'A'.padStart(6)} ${'B'.padStart(6)} ${'C'.padStart(6)}  A recovers`);
  console.log('─'.repeat(92));

  for (const [o, d, dep, ret, label] of ROUTES) {
    for (const cap of ['TwoHundred', 'Thousand']) {
      const flights = toFlights(await search(o, d, dep, ret, cap)).filter(valid);
      if (!flights.length) { console.log(`${(o + '-' + d).padEnd(22)} ${cap.padEnd(11)} — no offers`); continue; }
      const real = distinctTrips(flights);
      const a = count(flights, keyA);
      const b = count(flights, keyB);
      const c = count(flights, keyC);
      const pct = real > 0 ? Math.round((a / real) * 100) : 0;
      console.log(
        `${`${o}-${d} (${label})`.slice(0, 21).padEnd(22)} ${cap.padEnd(11)} ` +
        `${String(flights.length).padStart(6)} ${String(real).padStart(10)} ` +
        `${String(a).padStart(6)} ${String(b).padStart(6)} ${String(c).padStart(6)}  ${String(pct).padStart(3)}%`,
      );
    }
  }

  console.log('\n  fares      = offers surviving the validity filter');
  console.log('  realTrips  = genuinely distinct flight combinations the provider sent');
  console.log('  A recovers = what proportion of real trips the CURRENT key preserves');
}

main().catch((e) => { console.error(e); process.exit(1); });
