/**
 * Fare-family ranking regression: BEFORE vs AFTER, on live provider data.
 *
 *   cd backend && npx tsx scripts/fare-family-regression.ts [ORIG DEST CABIN]
 *   cd backend && npx tsx scripts/fare-family-regression.ts --all
 *
 * The scoring engines are NOT modified by the fare-family work. What changed is
 * what we feed them. This harness runs both engines twice over the same live
 * offers — once with the pre-fix inputs, once with the corrected ones — and
 * diffs per-dimension scores and badge assignment, so every ranking movement
 * can be attributed to a specific input correction.
 *
 * BEFORE (what production does today)
 *   comfort.fareClassName = undefined      → scoreComfort falls through to 60
 *   baggage.checked       = kg >= 20 ? 1:0 → a real 15Kg allowance reads as 0
 *   fare panel            = 7 templates, all at the same price
 *
 * AFTER (corrected)
 *   comfort.fareClassName = airline fare family ("SAVER", "FLEX", …)
 *   baggage.checked       = any weight > 0 is one allowance
 *   fare panel            = the airline's real ladder, real prices
 *
 * Read-only. No DB, no booking, no writes.
 */
import { rankFlightOffers } from '../src/ranking/core/rankOffers';
import type { RankingOffer, SearchContext } from '../src/ranking/types';
import { computeAiScores, type FareInput, type FlightContext } from '../src/services/ai-fare-scorer';
import { normalizeMystiflyOffer } from '../src/services/normalizer';
import { legacyCheckedBags } from './lib/legacy-inputs';

const MF = process.env.MYSTIFLY_BASE_URL || 'https://restapidemo.myfarebox.com';
const TOKEN = process.env.MYSTIFLY_SESSION_TOKEN || '809C4C04-03BB-4EA1-8EC5-C98ECCEC704D-6828';

const DIM = ['price', 'schedule', 'duration', 'stops', 'baggage', 'comfort', 'flexibility'] as const;

const pad = (s: any, n: number) => String(s).padEnd(n);
const num = (v: number, n = 6) => v.toFixed(1).padStart(n);

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

/** Replay the orchestrator's v2.2 segment merge, then the real normalizer. */
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

/** RankingOffer for the 10-dimension engine, in either input mode. */
function toRankingOffer(f: any, corrected: boolean): RankingOffer {
  return {
    offerId: f.id,
    provider: f.provider,
    airline: f.airline.name,
    airlineCode: f.airline.code,
    totalPrice: f.totalPrice,
    currency: f.currency,
    durationMinutes: f.totalDuration,
    segments: f.segments.map((s: any) => ({
      origin: s.departure.airport, destination: s.arrival.airport,
      departureTime: s.departure.time, arrivalTime: s.arrival.time,
      airlineCode: f.airline.code, flightNumber: s.flightNumber,
      durationMinutes: s.duration, aircraft: s.aircraft,
    })),
    baggage: {
      carryOn: f.baggage?.carryOn ?? 0,
      // The one baggage difference between modes.
      checked: corrected ? (f.baggage?.checked ?? 0) : legacyCheckedBags(f.checkedBaggageAllowance),
    },
    fareRules: {
      refundable: f.fareRules?.refundable ?? false,
      changeable: f.fareRules?.changeable ?? false,
      cancellationFee: f.fareRules?.cancellationFee,
      changeFee: f.fareRules?.changeFee,
    },
    comfort: {
      cabinClass: (f.cabinClass || 'economy').toLowerCase(),
      // The one comfort difference between modes.
      fareClassName: corrected ? (f.airlineFareFamily || undefined) : undefined,
    },
    ancillaries: { mealService: false },
    stops: f.stops,
  } as RankingOffer;
}

function ctxFor(origin: string, dest: string, cabin: string): SearchContext {
  return {
    origin, destination: dest,
    departureDate: '2026-09-10', returnDate: '2026-10-03',
    tripType: 'round_trip' as any,
    cabin: (cabin === 'C' ? 'business' : cabin === 'S' ? 'premium_economy' : cabin === 'F' ? 'first' : 'economy') as any,
    currency: 'USD',
    passengers: { adults: 1, children: 0, infants: 0 } as any,
    travelerProfile: 'leisure' as any,
  };
}

// ── Engine A: 10-dimension search ranking ────────────────────────────────────

function engineA(flights: any[], origin: string, dest: string, cabin: string, topN: number) {
  const ctx = ctxFor(origin, dest, cabin);
  const before = rankFlightOffers({ searchContext: ctx, offers: flights.map((f) => toRankingOffer(f, false)) });
  const after = rankFlightOffers({ searchContext: ctx, offers: flights.map((f) => toRankingOffer(f, true)) });

  const byId = new Map(flights.map((f) => [f.id, f]));
  const beforeRank = new Map(before.rankedOffers.map((o: any) => [o.offerId, o]));
  const afterRank = new Map(after.rankedOffers.map((o: any) => [o.offerId, o]));

  console.log(`\n  ── Engine A · 10-dimension search ranking (weights: ${before.audit?.weightsUsed ? JSON.stringify(before.audit.weightsUsed) : 'profile default'}) ──`);
  console.log(`     ${pad('#', 3)} ${pad('fare family', 18)} ${pad('price', 9)} ${DIM.map((d) => pad(d, 13)).join('')} final`);

  const rows = after.rankedOffers.slice(0, topN);
  for (const a of rows) {
    const b = beforeRank.get(a.offerId);
    const f = byId.get(a.offerId);
    const cells = DIM.map((d) => {
      const key = `${d}Score` as keyof typeof a.scoreBreakdown;
      const bv = b ? (b.scoreBreakdown as any)[key] ?? 0 : 0;
      const av = (a.scoreBreakdown as any)[key] ?? 0;
      const delta = av - bv;
      return pad(`${num(bv, 4)}→${num(av, 4)}${Math.abs(delta) > 0.05 ? '*' : ' '}`, 13);
    }).join('');
    const bFinal = b ? b.finalScore : 0;
    console.log(`     ${pad(a.rank, 3)} ${pad(f?.airlineFareFamily || '(none)', 18)} ${pad('$' + f?.totalPrice, 9)} ${cells} ${num(bFinal, 5)}→${num(a.finalScore, 5)}`);
  }

  // Order movement
  const beforeOrder = before.rankedOffers.map((o: any) => o.offerId);
  const afterOrder = after.rankedOffers.map((o: any) => o.offerId);
  let moved = 0;
  for (let i = 0; i < Math.min(beforeOrder.length, afterOrder.length); i++) {
    if (beforeOrder[i] !== afterOrder[i]) moved++;
  }
  const topChanged = beforeOrder[0] !== afterOrder[0];
  console.log(`     positions changed: ${moved}/${afterOrder.length}   #1 changed: ${topChanged ? 'YES' : 'no'}`);
  if (topChanged) {
    const bf = byId.get(beforeOrder[0]);
    const af = byId.get(afterOrder[0]);
    console.log(`       before #1: ${bf?.airlineFareFamily || '(none)'} $${bf?.totalPrice} bag=${bf?.checkedBaggageAllowance}`);
    console.log(`       after  #1: ${af?.airlineFareFamily || '(none)'} $${af?.totalPrice} bag=${af?.checkedBaggageAllowance}`);
  }
  return { before, after };
}

// ── Engine B: 9-dimension fare panel ─────────────────────────────────────────

/** The seven fare_tier_templates as they were seeded — all at multiplier 1.0. */
const LEGACY_TEMPLATES = [
  { name: 'Economy Basic', cabin: 'economy', checked: 0, refundable: false, refundFeeUsd: null, changeable: false, changeFeeUsd: null, seatSelection: 'fee' as const },
  { name: 'Economy Standard', cabin: 'economy', checked: 1, refundable: false, refundFeeUsd: null, changeable: true, changeFeeUsd: 50, seatSelection: 'fee' as const },
  { name: 'Economy Flex', cabin: 'economy', checked: 1, refundable: true, refundFeeUsd: 0, changeable: true, changeFeeUsd: 0, seatSelection: 'free' as const },
  { name: 'Premium Economy Classic', cabin: 'premium_economy', checked: 2, refundable: false, refundFeeUsd: null, changeable: true, changeFeeUsd: 75, seatSelection: 'free' as const },
  { name: 'Premium Economy Flex', cabin: 'premium_economy', checked: 2, refundable: true, refundFeeUsd: 0, changeable: true, changeFeeUsd: 0, seatSelection: 'free' as const },
  { name: 'Business Classic', cabin: 'business', checked: 2, refundable: true, refundFeeUsd: 0, changeable: true, changeFeeUsd: 0, seatSelection: 'free' as const },
  { name: 'Business Extra', cabin: 'business', checked: 2, refundable: true, refundFeeUsd: 0, changeable: true, changeFeeUsd: 0, seatSelection: 'free' as const },
];

function engineB(ladder: any[], fctx: FlightContext) {
  const anchorPrice = ladder[0].totalPrice;

  // BEFORE: 7 templates projected onto one offer at multiplier 1.0 — every row
  // the same price, so normPrice() returns 1.0 for all of them.
  const beforeInputs: FareInput[] = LEGACY_TEMPLATES.map((t, i) => ({
    id: `legacy_${i}`, totalPrice: anchorPrice, checked: t.checked,
    refundable: t.refundable, refundFeeUsd: t.refundFeeUsd,
    changeable: t.changeable, changeFeeUsd: t.changeFeeUsd,
    seatSelection: t.seatSelection, cabin: t.cabin, name: t.name,
  }));

  // AFTER: the airline's real ladder.
  const afterInputs: FareInput[] = ladder.map((f, i) => ({
    id: `real_${i}`, totalPrice: f.totalPrice,
    checked: f.baggage?.checked ?? 0,
    refundable: f.fareRules?.refundable === true, refundFeeUsd: f.fareRules?.cancellationFee ?? null,
    changeable: f.fareRules?.changeable === true, changeFeeUsd: f.fareRules?.changeFee ?? null,
    seatSelection: 'fee', cabin: (f.cabinClass || 'economy'), name: f.airlineFareFamily || 'Economy',
  }));

  const beforeScored = computeAiScores(beforeInputs, fctx);
  const afterScored = computeAiScores(afterInputs, fctx);

  const show = (label: string, inputs: FareInput[], scored: any[]) => {
    console.log(`\n     ${label}`);
    console.log(`       ${pad('fare', 24)} ${pad('price', 9)} ${pad('bag', 4)} ${pad('price', 6)}${pad('bagg', 6)}${pad('refund', 7)}${pad('change', 7)}${pad('seat', 6)} ${pad('final', 6)} badges`);
    for (const inp of inputs) {
      const s = scored.find((x) => x.id === inp.id);
      if (!s) continue;
      const b = s.breakdown;
      console.log(`       ${pad(inp.name, 24)} ${pad('$' + inp.totalPrice, 9)} ${pad(inp.checked, 4)} ${num(b.priceScore, 5)} ${num(b.baggageScore, 5)} ${num(b.refundScore, 6)} ${num(b.changeScore, 6)} ${num(b.seatScore, 5)} ${num(b.finalScore, 6)} ${s.badges.join(',') || '—'}`);
    }
  };

  console.log(`\n  ── Engine B · 9-dimension fare panel ──`);
  show('BEFORE — 7 seeded templates, one offer, all same price:', beforeInputs, beforeScored);
  show("AFTER — the airline's real ladder:", afterInputs, afterScored);

  const badgeMap = (inputs: FareInput[], scored: any[]) => {
    const m: Record<string, string> = {};
    for (const s of scored) {
      const inp = inputs.find((i) => i.id === s.id);
      for (const badge of s.badges) if (!m[badge]) m[badge] = inp?.name ?? '?';
    }
    return m;
  };
  const bb = badgeMap(beforeInputs, beforeScored);
  const ab = badgeMap(afterInputs, afterScored);
  console.log(`\n     badge assignment:`);
  for (const badge of ['ai_pick', 'best_value', 'cheapest', 'most_flexible', 'best_comfort', 'premium_upgrade']) {
    console.log(`       ${pad(badge, 16)} before=${pad(bb[badge] ?? '—', 26)} after=${ab[badge] ?? '—'}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const ROUTES: Array<[string, string, string, string]> = [
  ['DEL', 'BOM', 'Y', 'domestic short-haul · economy'],
  ['JFK', 'LHR', 'Y', 'long-haul · economy (mixed cabins returned)'],
  ['JFK', 'LHR', 'C', 'long-haul · business'],
  ['JFK', 'LHR', 'F', 'long-haul · first'],
  ['LHR', 'SIN', 'Y', 'ultra long-haul · economy'],
];

async function main() {
  const argv = process.argv.slice(2);
  const routes = argv[0] === '--all' || argv.length === 0
    ? ROUTES
    : [[argv[0], argv[1], argv[2] || 'Y', 'ad hoc'] as [string, string, string, string]];

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║  FARE-FAMILY RANKING REGRESSION — BEFORE vs AFTER on live Mystifly data  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
  console.log('\nScoring engines are byte-identical in both runs. Only the INPUTS differ:');
  console.log('  comfort.fareClassName : undefined            → airline fare family');
  console.log('  baggage.checked       : kg >= 20 ? 1 : 0     → any weight > 0 is 1 allowance');
  console.log('  fare panel            : 7 same-price templates → real airline ladder');
  console.log('\n  "*" marks a dimension whose score moved.');

  for (const [origin, dest, cabin, label] of routes) {
    const d = await search(origin, dest, cabin);
    const flights = toFlights(d);
    console.log(`\n\n${'═'.repeat(78)}`);
    console.log(`ROUTE ${origin}↔${dest}  cabin=${cabin}  (${label})  — ${flights.length} offers`);
    console.log('═'.repeat(78));
    if (flights.length === 0) { console.log('  no offers returned'); continue; }

    const withFamily = flights.filter((f) => f.airlineFareFamily).length;
    const bagChanged = flights.filter((f) =>
      legacyCheckedBags(f.checkedBaggageAllowance) !== (f.baggage?.checked ?? 0)).length;
    console.log(`  offers carrying a fare family : ${withFamily}/${flights.length}`);
    console.log(`  offers whose bag count changed: ${bagChanged}/${flights.length}`);

    engineA(flights, origin, dest, cabin, 8);

    // Fare panel: the largest real ladder on this route.
    const groups = new Map<string, any[]>();
    for (const f of flights) {
      if (!groups.has(f.itineraryKey)) groups.set(f.itineraryKey, []);
      groups.get(f.itineraryKey)!.push(f);
    }
    const ladder = [...groups.values()]
      .sort((a, b) => new Set(b.map((x) => x.airlineFareFamily)).size - new Set(a.map((x) => x.airlineFareFamily)).size)[0];
    if (ladder && ladder.length > 1) {
      engineB([...ladder].sort((a, b) => a.totalPrice - b.totalPrice), {
        durationMinutes: ladder[0].totalDuration, stops: ladder[0].stops, layoverMinutes: [],
      });
    } else {
      console.log('\n  ── Engine B · fare panel: no multi-fare ladder on this route ──');
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
