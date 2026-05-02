/**
 * Mock data generator for backend (fallback when no providers configured).
 */

import { generateId, calculateValueScore, getAirlineLogo } from '../lib/utils';
import type { UnifiedFlight } from '../lib/types';

const MOCK_AIRLINES = [
  { code: 'AA', name: 'American Airlines' },
  { code: 'UA', name: 'United Airlines' },
  { code: 'DL', name: 'Delta Air Lines' },
  { code: 'WN', name: 'Southwest Airlines' },
  { code: 'B6', name: 'JetBlue Airways' },
];

export function generateMockFlights(origin: string, destination: string, date: string): UnifiedFlight[] {
  const flights: UnifiedFlight[] = [];
  const baseDate = new Date(date);

  for (let i = 0; i < 8; i++) {
    const airline = MOCK_AIRLINES[i % MOCK_AIRLINES.length];
    const depHour = 6 + Math.floor(Math.random() * 14);
    const duration = 120 + Math.floor(Math.random() * 240);
    const stops = Math.random() > 0.5 ? 0 : 1;
    const price = 150 + Math.floor(Math.random() * 500);
    const refundable = Math.random() > 0.6;

    const depTime = new Date(baseDate);
    depTime.setHours(depHour, Math.floor(Math.random() * 60));
    const arrTime = new Date(depTime.getTime() + duration * 60000);

    flights.push({
      id: generateId(),
      provider: 'duffel',
      providerOfferId: `mock_${generateId()}`,
      airline: { code: airline.code, name: airline.name, logo: getAirlineLogo(airline.code) },
      segments: [{
        id: generateId(),
        departure: { airport: origin, airportName: origin, city: origin, time: depTime.toISOString() },
        arrival: { airport: destination, airportName: destination, city: destination, time: arrTime.toISOString() },
        airline: { code: airline.code, name: airline.name },
        flightNumber: `${airline.code}${100 + i}`,
        duration,
      }],
      totalPrice: price,
      currency: 'USD',
      cabinClass: 'economy',
      fareRules: { refundable, changeable: true },
      baggage: { carryOn: 1, checked: refundable ? 1 : 0 },
      totalDuration: duration,
      stops,
      valueScore: calculateValueScore(price, duration, stops, refundable),
    });
  }

  return flights;
}
