import { rankFlightOffers } from '../core/rankOffers';
import type { RankingInput } from '../types';

const input: RankingInput = {
  searchContext: {
    origin: 'DFW', destination: 'DEL',
    departureDate: '2026-12-16', returnDate: '2027-01-06',
    tripType: 'round_trip', journeyType: 'international',
    cabin: 'economy', currency: 'USD',
    passengers: { adults: 1, children: 0, infants: 0 },
    travelerProfile: 'default',
  },
  offers: [
    // Card 1: AA via JFK, $2,793, refundable+changeable, 44h 24m
    {
      offerId: 'card_1_AA',
      provider: 'Duffel', airline: 'American Airlines', airlineCode: 'AA',
      totalPrice: 2793, currency: 'USD', durationMinutes: 2664, // 44h 24m
      segments: [
        { departureAirport: 'DFW', arrivalAirport: 'JFK', departureTime: '2026-12-16T12:37:00-06:00', arrivalTime: '2026-12-16T16:50:00-05:00', durationMinutes: 193, airline: 'AA', flightNumber: 'AA1654' },
        { departureAirport: 'JFK', arrivalAirport: 'DEL', departureTime: '2026-12-16T20:07:00-05:00', arrivalTime: '2026-12-17T21:35:00+05:30', durationMinutes: 870, airline: 'AA', flightNumber: 'AA0292' },
        { departureAirport: 'DEL', arrivalAirport: 'JFK', departureTime: '2027-01-06T23:55:00+05:30', arrivalTime: '2027-01-07T05:25:00-05:00', durationMinutes: 930, airline: 'AA', flightNumber: 'AA0293' },
        { departureAirport: 'JFK', arrivalAirport: 'DFW', departureTime: '2027-01-07T06:55:00-05:00', arrivalTime: '2027-01-07T10:21:00-06:00', durationMinutes: 266, airline: 'AA', flightNumber: 'AA0860' },
      ],
      baggage: { carryOn: 1, checked: 1 },
      fareRules: { refundable: true, changeable: true, cancellationFee: 0, changeFee: 0 },
      comfort: { cabinClass: 'economy', fareClassName: 'Economy Flexible' },
      ancillaries: { mealService: true }, stops: 1,
    },
    // Card 2: BA via LHR, $1,877, changeable only, 46h 30m
    {
      offerId: 'card_2_BA',
      provider: 'Duffel', airline: 'British Airways', airlineCode: 'BA',
      totalPrice: 1877, currency: 'USD', durationMinutes: 2790, // 46h 30m
      segments: [
        { departureAirport: 'DFW', arrivalAirport: 'LHR', departureTime: '2026-12-16T17:25:00-06:00', arrivalTime: '2026-12-17T08:25:00+00:00', durationMinutes: 540, airline: 'BA', flightNumber: 'BA1589' },
        { departureAirport: 'LHR', arrivalAirport: 'DEL', departureTime: '2026-12-17T11:20:00+00:00', arrivalTime: '2026-12-18T01:15:00+05:30', durationMinutes: 505, airline: 'BA', flightNumber: 'BA0143' },
        { departureAirport: 'DEL', arrivalAirport: 'LHR', departureTime: '2027-01-06T10:50:00+05:30', arrivalTime: '2027-01-06T15:30:00+00:00', durationMinutes: 570, airline: 'BA', flightNumber: 'BA0256' },
        { departureAirport: 'LHR', arrivalAirport: 'DFW', departureTime: '2027-01-07T08:35:00+00:00', arrivalTime: '2027-01-07T13:00:00-06:00', durationMinutes: 625, airline: 'BA', flightNumber: 'BA1504' },
      ],
      baggage: { carryOn: 1, checked: 2 },
      fareRules: { refundable: false, changeable: true, changeFee: 0 },
      comfort: { cabinClass: 'economy', fareClassName: 'Economy Changeable' },
      ancillaries: { mealService: true }, stops: 1,
    },
  ],
};

const result = rankFlightOffers(input);

console.log('═══════════════════════════════════════════════════════════════');
console.log('  FareMind Ranking Engine — DFW ↔ DEL  (Dec 16 – Jan 06)');
console.log('  Profile:', result.profileId);
console.log('═══════════════════════════════════════════════════════════════');

for (const offer of result.rankedOffers) {
  const isAA = offer.offerId === 'card_1_AA';
  const label = isAA
    ? 'Card 1 — AA via JFK | $2,793 | Refundable+Changeable | 44h 24m'
    : 'Card 2 — BA via LHR | $1,877 | Changeable only | 46h 30m';
  console.log(`\n┌─ ${label}`);
  console.log(`│  Rank: #${offer.rank}    Final Score: ${offer.finalScore}/100    Confidence: ${offer.confidence}`);
  console.log('│');
  console.log('│  Score Breakdown:');
  console.log(`│    Price:              ${offer.scoreBreakdown.priceScore}`);
  console.log(`│    Duration:           ${offer.scoreBreakdown.durationScore}`);
  console.log(`│    Stops:              ${offer.scoreBreakdown.stopsScore}`);
  console.log(`│    Schedule:           ${offer.scoreBreakdown.scheduleScore}`);
  console.log(`│    Flexibility:        ${offer.scoreBreakdown.flexibilityScore}`);
  console.log(`│    Comfort:            ${offer.scoreBreakdown.comfortScore}`);
  console.log(`│    Baggage:            ${offer.scoreBreakdown.baggageScore}`);
  console.log(`│    Brand:              ${offer.scoreBreakdown.brandScore}`);
  console.log(`│    Reliability:        ${offer.scoreBreakdown.reliabilityScore}`);
  console.log(`│    Airport Experience: ${offer.scoreBreakdown.airportExperienceScore}`);
  console.log('│');
  if (offer.appliedRules.length > 0) {
    console.log('│  Applied Rules:');
    for (const rule of offer.appliedRules) {
      const sign = rule.impact >= 0 ? '+' : '';
      console.log(`│    [${rule.ruleId}] ${sign}${rule.impact}: ${rule.reason}`);
    }
    console.log('│');
  }
  console.log('│  Reasons:');
  for (const r of offer.machineReasons) console.log(`│    ✓ ${r}`);
  if (offer.tradeoffs.length > 0) {
    console.log('│  Tradeoffs:');
    for (const t of offer.tradeoffs) console.log(`│    ✗ ${t}`);
  }
  console.log('└──────────────────────────────────────────────────────────');
}
