import { FastifyPluginAsync } from 'fastify';
import { searchFlights } from '../services/orchestrator';
import type { UnifiedFlight } from '../lib/types';

const ROUTES = [
  { from: 'JFK', to: 'LAX', fromCity: 'New York',        toCity: 'Los Angeles'  },
  { from: 'SFO', to: 'ORD', fromCity: 'San Francisco',   toCity: 'Chicago'      },
  { from: 'MIA', to: 'JFK', fromCity: 'Miami',           toCity: 'New York'     },
  { from: 'LAX', to: 'LHR', fromCity: 'Los Angeles',     toCity: 'London'       },
  { from: 'JFK', to: 'CDG', fromCity: 'New York',        toCity: 'Paris'        },
  { from: 'SFO', to: 'NRT', fromCity: 'San Francisco',   toCity: 'Tokyo'        },
];

function getSearchDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().split('T')[0];
}

function calcLayoverMinutes(flight: UnifiedFlight): number | null {
  if (flight.stops === 0 || flight.segments.length < 2) return null;
  let total = 0;
  for (let i = 0; i < flight.segments.length - 1; i++) {
    const arr  = new Date(flight.segments[i].arrival.time).getTime();
    const dep  = new Date(flight.segments[i + 1].departure.time).getTime();
    total += (dep - arr) / 60000;
  }
  return Math.round(total);
}

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async () => {
    const date = getSearchDate();

    const settled = await Promise.allSettled(
      ROUTES.map((r) =>
        searchFlights({ origin: r.from, destination: r.to, date, adults: 1, cabin: 'economy' })
      )
    );

    const routes = ROUTES.map((route, i) => {
      const result = settled[i];

      if (result.status === 'rejected' || !result.value.flights.length) {
        return { ...route, price: null, stops: null, duration: null, layover: null, currency: 'USD', isMock: false };
      }

      const cheapest = result.value.flights.reduce<UnifiedFlight>(
        (best, f) => (f.totalPrice < best.totalPrice ? f : best),
        result.value.flights[0]
      );

      return {
        ...route,
        price:    Math.round(cheapest.totalPrice),
        currency: cheapest.currency || 'USD',
        stops:    cheapest.stops,
        duration: cheapest.totalDuration,
        layover:  calcLayoverMinutes(cheapest),
        isMock:   false,
      };
    });

    return { routes, searchDate: date };
  });
};

export default plugin;
