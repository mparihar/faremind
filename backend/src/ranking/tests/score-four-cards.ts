/**
 * Score 4 visible cards from the user's screenshot
 * DFW → DEL, Nov 16 → Dec 5, 2026
 */
import { rankFlightOffers } from '../core/rankOffers';
import type { RankingInput, RankingOffer } from '../types';

// Card 1: BA $1,377 — 33h 40m — OUT 09:15PM, RET 03:20AM
// Refundable with fee, baggage unknown (likely 1 carry-on)
const card1: RankingOffer = {
  offerId: 'ba-1377',
  provider: 'duffel',
  airline: 'British Airways',
  airlineCode: 'BA',
  totalPrice: 1377,
  currency: 'USD',
  durationMinutes: 33 * 60 + 40, // 2020
  segments: [
    { departureAirport: 'DFW', arrivalAirport: 'LHR', departureTime: '2026-11-16T21:15:00', arrivalTime: '2026-11-17T11:25:00', durationMinutes: 550, airline: 'BA', flightNumber: 'BA0192' },
    { departureAirport: 'LHR', arrivalAirport: 'DEL', departureTime: '2026-11-17T14:15:00', arrivalTime: '2026-11-18T05:20:00', durationMinutes: 515, airline: 'BA', flightNumber: 'BA0137', departureTerminal: '3' },
    { departureAirport: 'DEL', arrivalAirport: 'LHR', departureTime: '2026-12-05T03:20:00', arrivalTime: '2026-12-05T07:50:00', durationMinutes: 540, airline: 'BA', flightNumber: 'BA0142', departureTerminal: '3' },
    { departureAirport: 'LHR', arrivalAirport: 'DFW', departureTime: '2026-12-05T12:05:00', arrivalTime: '2026-12-05T16:25:00', durationMinutes: 620, airline: 'BA', flightNumber: 'BA1520', departureTerminal: '5' },
  ],
  baggage: { carryOn: 1, checked: 0 },
  fareRules: { refundable: true, changeable: true, cancellationFee: 199 },
  comfort: { cabinClass: 'economy' },
  ancillaries: {},
  stops: 2,
};

// Card 2: BA $1,620 — 33h 25m — OUT 05:25PM, RET 03:20AM
// Fully refundable, 2 checked bags
const card2: RankingOffer = {
  offerId: 'ba-1620',
  provider: 'duffel',
  airline: 'British Airways',
  airlineCode: 'BA',
  totalPrice: 1620,
  currency: 'USD',
  durationMinutes: 33 * 60 + 25, // 2005
  segments: [
    { departureAirport: 'DFW', arrivalAirport: 'LHR', departureTime: '2026-11-16T17:25:00', arrivalTime: '2026-11-17T07:25:00', durationMinutes: 600, airline: 'BA', flightNumber: 'BA1505' },
    { departureAirport: 'LHR', arrivalAirport: 'DEL', departureTime: '2026-11-17T09:45:00', arrivalTime: '2026-11-18T01:15:00', durationMinutes: 510, airline: 'BA', flightNumber: 'BA0143', departureTerminal: '3' },
    { departureAirport: 'DEL', arrivalAirport: 'LHR', departureTime: '2026-12-05T03:20:00', arrivalTime: '2026-12-05T07:50:00', durationMinutes: 540, airline: 'BA', flightNumber: 'BA0142', departureTerminal: '3' },
    { departureAirport: 'LHR', arrivalAirport: 'DFW', departureTime: '2026-12-05T12:05:00', arrivalTime: '2026-12-05T16:25:00', durationMinutes: 620, airline: 'BA', flightNumber: 'BA1520', departureTerminal: '5' },
  ],
  baggage: { carryOn: 1, checked: 2 },
  fareRules: { refundable: true, changeable: true, cancellationFee: 0 },
  comfort: { cabinClass: 'economy' },
  ancillaries: {},
  stops: 2,
};

// Card 3: BA $1,494 — 33h 25m — OUT 05:25PM, RET 03:20AM
// Refundable with fee, 2 checked bags  
const card3: RankingOffer = {
  offerId: 'ba-1494',
  provider: 'duffel',
  airline: 'British Airways',
  airlineCode: 'BA',
  totalPrice: 1494,
  currency: 'USD',
  durationMinutes: 33 * 60 + 25,
  segments: [
    { departureAirport: 'DFW', arrivalAirport: 'LHR', departureTime: '2026-11-16T17:25:00', arrivalTime: '2026-11-17T07:25:00', durationMinutes: 600, airline: 'BA', flightNumber: 'BA1505' },
    { departureAirport: 'LHR', arrivalAirport: 'DEL', departureTime: '2026-11-17T09:45:00', arrivalTime: '2026-11-18T01:15:00', durationMinutes: 510, airline: 'BA', flightNumber: 'BA0143', departureTerminal: '3' },
    { departureAirport: 'DEL', arrivalAirport: 'LHR', departureTime: '2026-12-05T03:20:00', arrivalTime: '2026-12-05T07:50:00', durationMinutes: 540, airline: 'BA', flightNumber: 'BA0147', departureTerminal: '3' },
    { departureAirport: 'LHR', arrivalAirport: 'DFW', departureTime: '2026-12-05T12:05:00', arrivalTime: '2026-12-05T16:25:00', durationMinutes: 620, airline: 'BA', flightNumber: 'BA1525', departureTerminal: '5' },
  ],
  baggage: { carryOn: 1, checked: 2 },
  fareRules: { refundable: true, changeable: true, cancellationFee: 150 },
  comfort: { cabinClass: 'economy' },
  ancillaries: {},
  stops: 2,
};

// Card 4: BA $1,555 — 33h 25m — OUT 05:25PM, RET 03:20AM
// Refundable with fee, 2 checked bags
const card4: RankingOffer = {
  offerId: 'ba-1555',
  provider: 'duffel',
  airline: 'British Airways',
  airlineCode: 'BA',
  totalPrice: 1555,
  currency: 'USD',
  durationMinutes: 33 * 60 + 25,
  segments: [
    { departureAirport: 'DFW', arrivalAirport: 'LHR', departureTime: '2026-11-16T17:25:00', arrivalTime: '2026-11-17T07:25:00', durationMinutes: 600, airline: 'BA', flightNumber: 'BA1505' },
    { departureAirport: 'LHR', arrivalAirport: 'DEL', departureTime: '2026-11-17T09:45:00', arrivalTime: '2026-11-18T01:15:00', durationMinutes: 510, airline: 'BA', flightNumber: 'BA0143', departureTerminal: '3' },
    { departureAirport: 'DEL', arrivalAirport: 'LHR', departureTime: '2026-12-05T03:20:00', arrivalTime: '2026-12-05T07:50:00', durationMinutes: 540, airline: 'BA', flightNumber: 'BA0142', departureTerminal: '3' },
    { departureAirport: 'LHR', arrivalAirport: 'DFW', departureTime: '2026-12-05T12:05:00', arrivalTime: '2026-12-05T16:25:00', durationMinutes: 620, airline: 'BA', flightNumber: 'BA1520', departureTerminal: '5' },
  ],
  baggage: { carryOn: 1, checked: 2 },
  fareRules: { refundable: true, changeable: true, cancellationFee: 100 },
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
  offers: [card1, card2, card3, card4],
};

const result = rankFlightOffers(input);

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  NEW ENGINE: 4 CARDS — DFW → DEL | Nov 16 → Dec 5, 2026');
console.log('══════════════════════════════════════════════════════════════\n');
console.log(`Journey: ${result.audit.journeyType} | Profile: ${result.profileId}`);
console.log(`Weights: ${JSON.stringify(result.audit.weightsUsed)}\n`);

console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────┐');
console.log('│ RANKING ORDER (should match UI)                                                            │');
console.log('├────┬──────────┬────────┬──────────┬─────────┬──────┬────────┬──────────┬─────────┬─────────┤');
console.log('│Rank│ Price    │ Score  │ Price    │Duration │Stops │Baggage │Flexiblty │Schedule │Brand    │');
console.log('├────┼──────────┼────────┼──────────┼─────────┼──────┼────────┼──────────┼─────────┼─────────┤');

for (const offer of result.rankedOffers) {
  const orig = input.offers.find(o => o.offerId === offer.offerId)!;
  const b = offer.scoreBreakdown;
  console.log(
    `│ #${offer.rank} │ $${orig.totalPrice.toString().padEnd(7)} │ ${offer.finalScore.toString().padEnd(6)} │ ` +
    `${b.priceScore.toFixed(0).padStart(5)}    │ ${b.durationScore.toFixed(0).padStart(5)}   │${b.stopsScore.toFixed(0).padStart(4)}  │ ` +
    `${b.baggageScore.toFixed(0).padStart(5)}  │ ${b.flexibilityScore.toFixed(0).padStart(7)}  │ ${b.scheduleScore.toFixed(0).padStart(5)}   │ ${b.brandScore.toFixed(0).padStart(5)}   │`
  );
}
console.log('└────┴──────────┴────────┴──────────┴─────────┴──────┴────────┴──────────┴─────────┴─────────┘\n');

console.log('UI DISPLAYED ORDER: $1,377 → $1,620 → $1,494 → $1,555');
console.log('ENGINE RANKED ORDER:', result.rankedOffers.map(o => {
  const orig = input.offers.find(x => x.offerId === o.offerId)!;
  return `$${orig.totalPrice}`;
}).join(' → '));
console.log('\nMATCH?', (() => {
  const uiOrder = ['ba-1377', 'ba-1620', 'ba-1494', 'ba-1555'];
  const engineOrder = result.rankedOffers.map(o => o.offerId);
  return JSON.stringify(uiOrder) === JSON.stringify(engineOrder) ? '✅ YES' : '❌ NO — UI does NOT match engine';
})());

console.log('\n── Detailed Reasons ──');
for (const offer of result.rankedOffers) {
  const orig = input.offers.find(o => o.offerId === offer.offerId)!;
  console.log(`\n#${offer.rank} $${orig.totalPrice} (score ${offer.finalScore}):`);
  console.log(`  Reasons: ${offer.machineReasons.join(' | ')}`);
  console.log(`  Tradeoffs: ${offer.tradeoffs.join(' | ')}`);
  if (offer.appliedRules.length > 0) {
    console.log(`  Rules: ${offer.appliedRules.map(r => `${r.ruleId}:${r.adjustment > 0 ? '+' : ''}${r.adjustment}`).join(', ')}`);
  }
}
console.log();
