import { normalize } from './normalize';
import type { FlightTag, ScoreBreakdown } from '@/lib/types';

type FlightMetrics = { id: string; price: number; durationMin: number; stops: number };

type Weights = { price: number; duration: number; stops: number };

export const WEIGHTS: Record<'best' | 'cheapest' | 'fastest', Weights> = {
  best:     { price: 0.5, duration: 0.3, stops: 0.2 },
  cheapest: { price: 0.8, duration: 0.1, stops: 0.1 },
  fastest:  { price: 0.1, duration: 0.7, stops: 0.2 },
};

function scoreFlights(flights: FlightMetrics[], weights: Weights) {
  if (flights.length === 0) return [];
  const prices    = flights.map((f) => f.price);
  const durations = flights.map((f) => f.durationMin);
  const stopsArr  = flights.map((f) => f.stops);
  const minP = Math.min(...prices),    maxP = Math.max(...prices);
  const minD = Math.min(...durations), maxD = Math.max(...durations);
  const minS = Math.min(...stopsArr),  maxS = Math.max(...stopsArr);
  return flights.map((f) => {
    const priceScore    = normalize(f.price,       minP, maxP);
    const durationScore = normalize(f.durationMin, minD, maxD);
    const stopsScore    = normalize(f.stops,       minS, maxS);
    const score = weights.price * priceScore + weights.duration * durationScore + weights.stops * stopsScore;
    return { id: f.id, score, breakdown: { priceScore, durationScore, stopsScore } as ScoreBreakdown };
  });
}

export function rankFlights<T extends { id: string; totalPrice: number; totalDuration: number; stops: number }>(
  flights: T[]
): Array<T & { valueScore: number; breakdown: ScoreBreakdown; tags: FlightTag[] }> {
  if (flights.length === 0) return [];

  const metrics = flights.map((f) => ({ id: f.id, price: f.totalPrice, durationMin: f.totalDuration, stops: f.stops }));

  const bestScored     = scoreFlights(metrics, WEIGHTS.best);
  const cheapestScored = scoreFlights(metrics, WEIGHTS.cheapest);
  const fastestScored  = scoreFlights(metrics, WEIGHTS.fastest);

  const topBestId     = bestScored.reduce((a, b) => (b.score > a.score ? b : a)).id;
  const topCheapestId = cheapestScored.reduce((a, b) => (b.score > a.score ? b : a)).id;
  const topFastestId  = fastestScored.reduce((a, b) => (b.score > a.score ? b : a)).id;

  const bestMap = new Map(bestScored.map((s) => [s.id, s]));

  return flights
    .map((f) => {
      const scored = bestMap.get(f.id)!;
      const tags: FlightTag[] = [];
      if (f.id === topBestId)     tags.push('best_value');
      if (f.id === topCheapestId) tags.push('cheapest');
      if (f.id === topFastestId)  tags.push('fastest');
      return { ...f, valueScore: Math.round(scored.score * 100), breakdown: scored.breakdown, tags };
    })
    .sort((a, b) => b.valueScore - a.valueScore)
    .slice(0, 50);
}
