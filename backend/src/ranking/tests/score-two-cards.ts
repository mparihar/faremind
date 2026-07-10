/**
 * Score 2 cards: BA $1,730 vs BA $1,494
 * DFW → DEL, Nov 16 → Dec 5, 2026
 */
import { rankFlightOffers } from '../core/rankOffers';
import type { RankingInput, RankingOffer } from '../types';

// Card 1: BA $1,730 — 33h 40m — 2 bags, free changes
// OUT: 09:15 PM DFW → DEL via LHR, RET: 03:20 AM DEL → DFW via LHR (4h 15m)
const card1: RankingOffer = {
  offerId: 'ba-1730',
  provider: 'duffel',
  airline: 'British Airways',
  airlineCode: 'BA',
  totalPrice: 1730,
  currency: 'USD',
  durationMinutes: 33 * 60 + 40, // 2020 min
  segments: [
    { departureAirport: 'DFW', arrivalAirport: 'LHR', departureTime: '2026-11-16T21:15:00', arrivalTime: '2026-11-17T11:25:00', durationMinutes: 550, airline: 'BA', flightNumber: 'BA0192' },
    { departureAirport: 'LHR', arrivalAirport: 'DEL', departureTime: '2026-11-17T14:15:00', arrivalTime: '2026-11-18T05:20:00', durationMinutes: 515, airline: 'BA', flightNumber: 'BA0137', departureTerminal: '3' },
    { departureAirport: 'DEL', arrivalAirport: 'LHR', departureTime: '2026-12-05T03:20:00', arrivalTime: '2026-12-05T07:50:00', durationMinutes: 540, airline: 'BA', flightNumber: 'BA0142', departureTerminal: '3' },
    { departureAirport: 'LHR', arrivalAirport: 'DFW', departureTime: '2026-12-05T12:05:00', arrivalTime: '2026-12-05T16:25:00', durationMinutes: 620, airline: 'BA', flightNumber: 'BA1520', departureTerminal: '5' },
  ],
  baggage: { carryOn: 1, checked: 2 },
  fareRules: { refundable: false, changeable: true, changeFee: 0 },
  comfort: { cabinClass: 'economy' },
  ancillaries: {},
  stops: 2,
};

// Card 2: BA $1,494 — 35h 15m — 2 bags, refundable w/ fee
// OUT: 05:25 PM DFW → 01:15 AM DEL, BA1589+BA0143, LHR (2h 55m)
// RET: 03:20 AM DEL → 06:15 PM DFW, BA0142+BA1530, LHR (6h 10m)
const card2: RankingOffer = {
  offerId: 'ba-1494',
  provider: 'duffel',
  airline: 'British Airways',
  airlineCode: 'BA',
  totalPrice: 1494,
  currency: 'USD',
  durationMinutes: 35 * 60 + 15, // 2115 min
  segments: [
    { departureAirport: 'DFW', arrivalAirport: 'LHR', departureTime: '2026-11-16T17:25:00', arrivalTime: '2026-11-17T07:25:00', durationMinutes: 600, airline: 'BA', flightNumber: 'BA1589' },
    { departureAirport: 'LHR', arrivalAirport: 'DEL', departureTime: '2026-11-17T10:20:00', arrivalTime: '2026-11-18T01:15:00', durationMinutes: 505, airline: 'BA', flightNumber: 'BA0143', departureTerminal: '3' },
    { departureAirport: 'DEL', arrivalAirport: 'LHR', departureTime: '2026-12-05T03:20:00', arrivalTime: '2026-12-05T07:50:00', durationMinutes: 540, airline: 'BA', flightNumber: 'BA0142', departureTerminal: '3' },
    { departureAirport: 'LHR', arrivalAirport: 'DFW', departureTime: '2026-12-05T14:00:00', arrivalTime: '2026-12-05T18:15:00', durationMinutes: 615, airline: 'BA', flightNumber: 'BA1530', departureTerminal: '5' },
  ],
  baggage: { carryOn: 1, checked: 2 },
  fareRules: { refundable: true, changeable: true, cancellationFee: 199 },
  comfort: { cabinClass: 'economy' },
  ancillaries: {},
  stops: 2,
};

const input: RankingInput = {
  searchContext: {
    origin: 'DFW',
    destination: 'DEL',
    departureDate: '2026-11-16',
    returnDate: '2026-12-05',
    tripType: 'round_trip',
    cabin: 'economy',
    currency: 'USD',
    passengers: { adults: 1, children: 0, infants: 0 },
    travelerProfile: 'default',
  },
  offers: [card1, card2],
};

const result = rankFlightOffers(input);

console.log('\n══════════════════════════════════════════════════');
console.log('  SCORING: BA $1,730 vs BA $1,494');
console.log('  DFW → DEL | Nov 16 → Dec 5, 2026');
console.log('══════════════════════════════════════════════════\n');

for (const offer of result.rankedOffers) {
  const orig = input.offers.find(o => o.offerId === offer.offerId)!;
  const b = offer.scoreBreakdown;
  console.log(`━━━ Rank #${offer.rank}: ${orig.airline} $${orig.totalPrice} (${orig.durationMinutes}m = ${Math.floor(orig.durationMinutes/60)}h ${orig.durationMinutes%60}m) ━━━`);
  console.log(`  FINAL SCORE: ${offer.finalScore}`);
  console.log(`  ┌────────────────────┬────────┬────────┐`);
  console.log(`  │ Dimension          │ Score  │ Weight │`);
  console.log(`  ├────────────────────┼────────┼────────┤`);
  console.log(`  │ Price              │ ${b.priceScore.toFixed(1).padStart(6)} │   28%  │`);
  console.log(`  │ Duration           │ ${b.durationScore.toFixed(1).padStart(6)} │   18%  │`);
  console.log(`  │ Stops              │ ${b.stopsScore.toFixed(1).padStart(6)} │   14%  │`);
  console.log(`  │ Schedule           │ ${b.scheduleScore.toFixed(1).padStart(6)} │   10%  │`);
  console.log(`  │ Flexibility        │ ${b.flexibilityScore.toFixed(1).padStart(6)} │   10%  │`);
  console.log(`  │ Comfort            │ ${b.comfortScore.toFixed(1).padStart(6)} │    8%  │`);
  console.log(`  │ Baggage            │ ${b.baggageScore.toFixed(1).padStart(6)} │    5%  │`);
  console.log(`  │ Brand              │ ${b.brandScore.toFixed(1).padStart(6)} │    3%  │`);
  console.log(`  │ Reliability        │ ${b.reliabilityScore.toFixed(1).padStart(6)} │    2%  │`);
  console.log(`  │ Airport Experience │ ${b.airportExperienceScore.toFixed(1).padStart(6)} │    2%  │`);
  console.log(`  └────────────────────┴────────┴────────┘`);
  console.log(`  Reasons: ${offer.machineReasons.join(' | ')}`);
  console.log(`  Tradeoffs: ${offer.tradeoffs.join(' | ')}`);
  if (offer.appliedRules.length > 0) {
    console.log(`  Rules: ${offer.appliedRules.map(r => `${r.ruleId}: ${r.adjustment > 0 ? '+' : ''}${r.adjustment} — ${r.reason}`).join('; ')}`);
  }
  console.log();
}
