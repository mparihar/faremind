import type { NormalizedOption, AiUserPreferences, AiScoreBreakdown, ScoringStats } from './types';

const EPS = 1e-6;

function scoreStops(stops: number): number {
  if (stops === 0) return 1.0;
  if (stops === 1) return 0.6;
  return 0.2;
}

export function computeScore(
  norm:  NormalizedOption,
  stats: ScoringStats,
  prefs: AiUserPreferences,
): AiScoreBreakdown {
  // Min/max normalized — higher is better
  const priceScore = stats.maxPrice > stats.minPrice
    ? (stats.maxPrice - norm.price) / (stats.maxPrice - stats.minPrice + EPS)
    : 1.0;

  const durationScore = stats.maxDuration > stats.minDuration
    ? (stats.maxDuration - norm.durationMinutes) / (stats.maxDuration - stats.minDuration + EPS)
    : 1.0;

  const stopsScore = scoreStops(norm.stops);

  // Weighted base: price 50%, duration 30%, stops 20%
  let base = priceScore * 0.50 + durationScore * 0.30 + stopsScore * 0.20;

  // Soft constraint: budget — pulls score toward 0.7 if over budget
  if (prefs.budget && prefs.budget > 0) {
    const pricePref = Math.max(0, Math.min(1, (prefs.budget - norm.price) / prefs.budget));
    base *= (0.7 + 0.3 * pricePref);
  }

  // Soft constraint: max duration
  if (prefs.maxDuration && prefs.maxDuration > 0) {
    const durPref = Math.max(0, Math.min(1, (prefs.maxDuration - norm.durationMinutes) / prefs.maxDuration));
    base *= (0.7 + 0.3 * durPref);
  }

  const finalScore = Math.round(Math.max(0, Math.min(100, base * 100)));

  return { priceScore, durationScore, stopsScore, finalScore };
}
