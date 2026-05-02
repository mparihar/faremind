import { FastifyPluginAsync } from 'fastify';
import { searchFlights } from '../services/orchestrator';
import type { UnifiedFlight } from '../lib/types';

function getMonthDates(startDateStr: string): Array<{ year: number; month: number; label: string; date: string }> {
  const parts = startDateStr.split('-');
  const startYear = parseInt(parts[0]);
  const startMonth = parseInt(parts[1]) - 1;
  const months = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(startYear, startMonth + i, 15);
    months.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: d.toLocaleString('en-US', { month: 'long' }),
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`,
    });
  }
  return months;
}

function calcLayoverMinutes(flight: UnifiedFlight): number | null {
  if (flight.stops === 0 || flight.segments.length < 2) return null;
  let total = 0;
  for (let i = 0; i < flight.segments.length - 1; i++) {
    const arr = new Date(flight.segments[i].arrival.time).getTime();
    const dep = new Date(flight.segments[i + 1].departure.time).getTime();
    total += (dep - arr) / 60000;
  }
  return Math.round(total);
}

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request, reply) => {
    const q = request.query as Record<string, string>;
    const origin      = q.origin?.toUpperCase();
    const destination = q.destination?.toUpperCase();
    const adults      = parseInt(q.adults || '1');
    const cabin       = q.cabin || 'economy';
    const startDate   = q.startDate || new Date().toISOString().split('T')[0];
    const tripType    = q.tripType || 'one_way';

    if (!origin || !destination) {
      return reply.code(400).send({ error: 'origin and destination required' });
    }
    if (origin === destination) {
      return reply.code(400).send({ error: 'origin and destination must be different' });
    }

    const months = getMonthDates(startDate);

    function returnDateFor(outbound: string): string | undefined {
      if (tripType !== 'round_trip') return undefined;
      const [y, m] = outbound.split('-');
      return `${y}-${m}-22`;
    }

    const settled = await Promise.allSettled(
      months.map((m) =>
        searchFlights({ origin, destination, date: m.date, returnDate: returnDateFor(m.date), adults, cabin })
      )
    );

    const results = months.map((m, i) => {
      const result = settled[i];
      if (result.status === 'rejected' || !result.value.flights.length) {
        return { ...m, price: null, stops: null, duration: null, layover: null, currency: 'USD', isMock: false };
      }
      const cheapest = result.value.flights.reduce<UnifiedFlight>(
        (best, f) => (f.totalPrice < best.totalPrice ? f : best),
        result.value.flights[0]
      );
      return {
        ...m,
        price: Math.round(cheapest.totalPrice),
        currency: cheapest.currency || 'USD',
        stops: cheapest.stops,
        duration: cheapest.totalDuration,
        layover: calcLayoverMinutes(cheapest),
        isMock: false,
      };
    });

    const sorted = [...results].sort((a, b) => {
      if (a.price === null) return 1;
      if (b.price === null) return -1;
      return a.price - b.price;
    });

    return { months: results, sorted, cheapestMonth: sorted.find((m) => m.price !== null) ?? null };
  });
};

export default plugin;
