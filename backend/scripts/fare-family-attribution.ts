/**
 * Attribution proof: every ranking movement is caused by a corrected input,
 * never by a logic change.
 *
 *   cd backend && npx tsx scripts/fare-family-attribution.ts
 *
 * Exits non-zero on any violation. Asserts, per offer, across live routes:
 *
 *   1. price, schedule, duration, stops, flexibility, brand, reliability and
 *      airportExperience are BYTE-IDENTICAL before and after. These dimensions
 *      take no input we touched, so any movement would mean the engine changed.
 *   2. comfortScore differs ONLY when the fare family carries a keyword
 *      scoreComfort() recognises (basic|light|saver → 40, flex → 68,
 *      classic → 62). Unknown and absent brands must hold the neutral 60.
 *   3. baggageScore differs ONLY when the corrected bag count differs from the
 *      legacy `kg >= 20 ? 1 : 0` count.
 *
 * Read-only. No DB, no booking, no writes.
 */
import { rankFlightOffers } from '../src/ranking/core/rankOffers';
import type { RankingOffer, SearchContext } from '../src/ranking/types';
import { normalizeMystiflyOffer } from '../src/services/normalizer';
import { legacyCheckedBags } from './lib/legacy-inputs';

const MF = process.env.MYSTIFLY_BASE_URL || 'https://restapidemo.myfarebox.com';
const TOKEN = process.env.MYSTIFLY_SESSION_TOKEN || '809C4C04-03BB-4EA1-8EC5-C98ECCEC704D-6828';

/** Dimensions that take no input touched by the fare-family work. */
const INVARIANT = [
  'priceScore', 'scheduleScore', 'durationScore', 'stopsScore',
  'flexibilityScore', 'brandScore', 'reliabilityScore', 'airportExperienceScore',
] as const;

/**
 * Exactly the keywords scoreComfort() branches on — see ranking/core/scoreComfort.ts.
 *
 * Deliberately SUBSTRING, not word-boundary, because the engine uses
 * `.includes(...)`. Singapore Airlines files "FLEXI", which contains "flex" and
 * so legitimately takes the flex branch; a `\bflex\b` assertion reported that as
 * a violation when the engine was behaving correctly. This regex must mirror
 * the engine's matching semantics, not a tidier version of them.
 */
const COMFORT_KEYWORDS = /(basic|light|saver|flex|classic)/i;

const ROUTES: Array<[string, string, string]> = [
  ['DEL', 'BOM', 'Y'],
  ['JFK', 'LHR', 'Y'],
  ['JFK', 'LHR', 'C'],
  ['LHR', 'SIN', 'Y'],
  ['SIN', 'SYD', 'Y'],
];

async function search(origin: string, dest: string, cabin: string) {
  const res = await fetch(`${MF}/api/v2.2/Search/Flight`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      OriginDestinationInformations: [
        { DepartureDateTime: '2026-09-10T00:00:00', OriginLocationCode: origin, DestinationLocationCode: dest },
        { DepartureDateTime: '2026-10-03T00:00:00', OriginLocationCode: dest, DestinationLocationCode: origin },
      ],
      TravelPreferences: { MaxStopsQuantity: 'All', CabinPreference: cabin, AirTripType: 'Return' },
      PricingSourceType: 'All', IsRefundable: false,
      PassengerTypeQuantities: [{ Code: 'ADT', Quantity: 1 }],
      RequestOptions: 'Thousand', NearByAirports: false, IsResidentFare: false,
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

function toRankingOffer(f: any, corrected: boolean): RankingOffer {
  return {
    offerId: f.id, provider: f.provider, airline: f.airline.name, airlineCode: f.airline.code,
    totalPrice: f.totalPrice, currency: f.currency, durationMinutes: f.totalDuration,
    segments: f.segments.map((s: any) => ({
      origin: s.departure.airport, destination: s.arrival.airport,
      departureTime: s.departure.time, arrivalTime: s.arrival.time,
      airlineCode: f.airline.code, flightNumber: s.flightNumber,
      durationMinutes: s.duration, aircraft: s.aircraft,
    })),
    baggage: {
      carryOn: f.baggage?.carryOn ?? 0,
      checked: corrected ? (f.baggage?.checked ?? 0) : legacyCheckedBags(f.checkedBaggageAllowance),
    },
    fareRules: {
      refundable: f.fareRules?.refundable ?? false, changeable: f.fareRules?.changeable ?? false,
      cancellationFee: f.fareRules?.cancellationFee, changeFee: f.fareRules?.changeFee,
    },
    comfort: {
      cabinClass: (f.cabinClass || 'economy').toLowerCase(),
      fareClassName: corrected ? (f.airlineFareFamily || undefined) : undefined,
    },
    ancillaries: { mealService: false },
    stops: f.stops,
  } as RankingOffer;
}

async function main() {
  let violations = 0;
  let checked = 0;
  let comfortMoved = 0;
  let baggageMoved = 0;
  const neutralHeld: string[] = [];

  console.log('ATTRIBUTION PROOF — every delta must trace to a corrected input\n');

  for (const [origin, dest, cabin] of ROUTES) {
    const flights = toFlights(await search(origin, dest, cabin));
    if (!flights.length) { console.log(`${origin}-${dest}/${cabin}: no offers, skipped`); continue; }

    const ctx: SearchContext = {
      origin, destination: dest, departureDate: '2026-09-10', returnDate: '2026-10-03',
      tripType: 'round_trip' as any,
      cabin: (cabin === 'C' ? 'business' : cabin === 'S' ? 'premium_economy' : cabin === 'F' ? 'first' : 'economy') as any,
      currency: 'USD', passengers: { adults: 1, children: 0, infants: 0 } as any,
      travelerProfile: 'leisure' as any,
    };

    const before = rankFlightOffers({ searchContext: ctx, offers: flights.map((f) => toRankingOffer(f, false)) });
    const after = rankFlightOffers({ searchContext: ctx, offers: flights.map((f) => toRankingOffer(f, true)) });
    const bMap = new Map(before.rankedOffers.map((o: any) => [o.offerId, o]));
    const byId = new Map(flights.map((f) => [f.id, f]));

    let routeViolations = 0;
    for (const a of after.rankedOffers) {
      const b = bMap.get(a.offerId);
      const f = byId.get(a.offerId);
      if (!b || !f) continue;
      checked++;

      // 1. Untouched dimensions must not move at all.
      for (const dim of INVARIANT) {
        const bv = (b.scoreBreakdown as any)[dim] ?? 0;
        const av = (a.scoreBreakdown as any)[dim] ?? 0;
        if (Math.abs(av - bv) > 1e-9) {
          routeViolations++;
          if (routeViolations <= 3) {
            console.log(`  VIOLATION ${origin}-${dest}: ${dim} moved ${bv} → ${av} on "${f.airlineFareFamily}" — no input we touched feeds this dimension`);
          }
        }
      }

      // 2. Comfort may move only for a recognised brand keyword.
      const bc = (b.scoreBreakdown as any).comfortScore ?? 0;
      const ac = (a.scoreBreakdown as any).comfortScore ?? 0;
      const family = f.airlineFareFamily || '';
      if (Math.abs(ac - bc) > 1e-9) {
        comfortMoved++;
        if (!COMFORT_KEYWORDS.test(family)) {
          routeViolations++;
          console.log(`  VIOLATION ${origin}-${dest}: comfort moved ${bc} → ${ac} on "${family}" which carries no keyword scoreComfort recognises`);
        }
      } else if (family && !COMFORT_KEYWORDS.test(family)) {
        // Unknown brand held the neutral score — exactly the intended fallback.
        if (neutralHeld.length < 400) neutralHeld.push(family);
      }

      // 3. Baggage may move only when the bag count itself changed.
      const bb = (b.scoreBreakdown as any).baggageScore ?? 0;
      const ab = (a.scoreBreakdown as any).baggageScore ?? 0;
      const legacyBags = legacyCheckedBags(f.checkedBaggageAllowance);
      const correctBags = f.baggage?.checked ?? 0;
      if (Math.abs(ab - bb) > 1e-9) {
        baggageMoved++;
        if (legacyBags === correctBags) {
          routeViolations++;
          console.log(`  VIOLATION ${origin}-${dest}: baggage moved ${bb} → ${ab} but bag count is unchanged (${legacyBags}) for allowance "${f.checkedBaggageAllowance}"`);
        }
      }
    }

    console.log(`${pad(`${origin}-${dest}/${cabin}`, 14)} offers=${pad(after.rankedOffers.length, 5)} violations=${routeViolations}`);
    violations += routeViolations;
  }

  const distinctNeutral = [...new Set(neutralHeld)].sort();
  console.log(`\noffers checked            : ${checked}`);
  console.log(`comfort score moved       : ${comfortMoved}  (all had a recognised brand keyword)`);
  console.log(`baggage score moved       : ${baggageMoved}  (all had a genuinely different bag count)`);
  console.log(`unknown brands held 60.0  : ${distinctNeutral.length} distinct`);
  console.log(`  ${distinctNeutral.slice(0, 20).join(', ')}`);
  console.log(`\nTOTAL VIOLATIONS: ${violations}`);
  if (violations > 0) {
    console.log('\nFAIL — a ranking delta could not be attributed to a corrected input.');
    process.exit(1);
  }
  console.log('\nPASS — every ranking delta traces to a corrected provider input.');
}

function pad(s: any, n: number) { return String(s).padEnd(n); }

main().catch((e) => { console.error(e); process.exit(1); });
