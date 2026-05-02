import { normalize } from './normalize';

export type FlightMetrics = {
  id: string;
  price: number;
  durationMin: number;
  stops: number;
};

export type ScoreBreakdown = {
  priceScore: number;
  durationScore: number;
  stopsScore: number;
};

export type Weights = {
  price: number;
  duration: number;
  stops: number;
};

export const WEIGHTS: Record<'best' | 'cheapest' | 'fastest', Weights> = {
  best:     { price: 0.5, duration: 0.3, stops: 0.2 },
  cheapest: { price: 0.8, duration: 0.1, stops: 0.1 },
  fastest:  { price: 0.1, duration: 0.7, stops: 0.2 },
};

export type ScoredFlight = FlightMetrics & {
  score: number;
  breakdown: ScoreBreakdown;
};

export function scoreFlights(
  flights: FlightMetrics[],
  weights: Weights = WEIGHTS.best
): ScoredFlight[] {
  if (flights.length === 0) return [];

  const prices    = flights.map((f) => f.price);
  const durations = flights.map((f) => f.durationMin);
  const stopsArr  = flights.map((f) => f.stops);

  const minPrice    = Math.min(...prices),    maxPrice    = Math.max(...prices);
  const minDuration = Math.min(...durations), maxDuration = Math.max(...durations);
  const minStops    = Math.min(...stopsArr),  maxStops    = Math.max(...stopsArr);

  return flights.map((f) => {
    const priceScore    = normalize(f.price,       minPrice,    maxPrice);
    const durationScore = normalize(f.durationMin, minDuration, maxDuration);
    const stopsScore    = normalize(f.stops,       minStops,    maxStops);

    const score =
      weights.price    * priceScore +
      weights.duration * durationScore +
      weights.stops    * stopsScore;

    return { ...f, score, breakdown: { priceScore, durationScore, stopsScore } };
  });
}
