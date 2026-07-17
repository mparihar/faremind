import { rankFlightOffers } from '../core/rankOffers';
import type { RankingInput } from '../types';

const input: RankingInput = {
  searchContext: {
    origin: 'DFW', destination: 'DEL',
    departureDate: '2026-09-21', returnDate: '2027-01-01',
    tripType: 'round_trip', journeyType: 'international',
    cabin: 'economy', currency: 'USD',
    passengers: { adults: 1, children: 0, infants: 0 },
    travelerProfile: 'default',
  },
  offers: [
    // Card 1: Qatar $2,346 — 39h 20m, non-refundable, 2 checked bags
    {
      offerId: 'card_1_QR',
      provider: 'Duffel', airline: 'Qatar Airways', airlineCode: 'QR',
      totalPrice: 2346, currency: 'USD', durationMinutes: 2360, // 39h 20m
      segments: [
        { departureAirport: 'DFW', arrivalAirport: 'DOH', departureTime: '2026-09-21T22:55:00-05:00', arrivalTime: '2026-09-22T18:55:00+03:00', durationMinutes: 840, airline: 'QR', flightNumber: 'QR0732' },
        { departureAirport: 'DOH', arrivalAirport: 'DEL', departureTime: '2026-09-22T22:35:00+03:00', arrivalTime: '2026-09-23T08:30:00+05:30', durationMinutes: 265, airline: 'QR', flightNumber: 'QR4780' },
        { departureAirport: 'DEL', arrivalAirport: 'DOH', departureTime: '2027-01-01T16:10:00+05:30', arrivalTime: '2027-01-01T18:40:00+03:00', durationMinutes: 300, airline: 'QR', flightNumber: 'QR4781' },
        { departureAirport: 'DOH', arrivalAirport: 'DFW', departureTime: '2027-01-02T01:50:00+03:00', arrivalTime: '2027-01-02T09:25:00-06:00', durationMinutes: 935, airline: 'QR', flightNumber: 'QR0731' },
      ],
      baggage: { carryOn: 1, checked: 2 },
      fareRules: { refundable: false, changeable: false },
      comfort: { cabinClass: 'economy', fareClassName: 'Economy Saver' },
      ancillaries: { mealService: true }, stops: 1,
    },
    // Card 2: BA $1,810 — 58h 5m, changeable, 2 checked bags
    {
      offerId: 'card_2_BA',
      provider: 'Duffel', airline: 'British Airways', airlineCode: 'BA',
      totalPrice: 1810, currency: 'USD', durationMinutes: 3485, // 58h 5m
      segments: [
        { departureAirport: 'DFW', arrivalAirport: 'LHR', departureTime: '2026-09-21T20:55:00-05:00', arrivalTime: '2026-09-22T11:30:00+01:00', durationMinutes: 575, airline: 'BA', flightNumber: 'BA1521' },
        { departureAirport: 'LHR', arrivalAirport: 'DEL', departureTime: '2026-09-22T18:05:00+01:00', arrivalTime: '2026-09-23T08:45:00+05:30', durationMinutes: 510, airline: 'BA', flightNumber: 'BA0257' },
        { departureAirport: 'DEL', arrivalAirport: 'LHR', departureTime: '2027-01-01T07:30:00+05:30', arrivalTime: '2027-01-01T12:20:00+00:00', durationMinutes: 580, airline: 'BA', flightNumber: 'BA0136' },
        { departureAirport: 'LHR', arrivalAirport: 'DFW', departureTime: '2027-01-01T14:15:00+00:00', arrivalTime: '2027-01-01T18:15:00-06:00', durationMinutes: 640, airline: 'BA', flightNumber: 'BA1530' },
      ],
      baggage: { carryOn: 1, checked: 2 },
      fareRules: { refundable: false, changeable: true, changeFee: 0 },
      comfort: { cabinClass: 'economy', fareClassName: 'Economy Changeable' },
      ancillaries: { mealService: true }, stops: 1,
    },
  ],
};

const result = rankFlightOffers(input);

for (const offer of result.rankedOffers) {
  const isQR = offer.offerId === 'card_1_QR';
  const label = isQR
    ? 'Card 1 — QR via DOH | $2,346 | Non-refundable | 39h 20m'
    : 'Card 2 — BA via LHR | $1,810 | Changeable    | 58h 5m';
  if (offer.appliedRules.length > 0) {
    for (const rule of offer.appliedRules) {
      const sign = rule.impact >= 0 ? '+' : '';
    }
  }
  if (offer.tradeoffs.length > 0) {
  }
}

// Summary
const sorted = result.rankedOffers.sort((a, b) => a.rank - b.rank);
for (const o of sorted) {
  const tag = o.offerId === 'card_1_QR' ? 'QR $2,346' : 'BA $1,810';
}
