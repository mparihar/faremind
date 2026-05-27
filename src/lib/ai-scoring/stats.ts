// ─── Percentile-Clipped Statistics ───────────────────────────────────────────
//
// Computes min/max/avg/percentile stats over candidate options.
// Uses 5th/95th percentile clipping to prevent outliers from
// distorting the normalization range (spec §17).

import type { NormalizedOption, ScoringStats } from './types';

/**
 * Compute the value at a given percentile (0-100) using linear interpolation.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/**
 * Build scoring stats from an array of normalized options.
 * Uses percentile clipping for price and duration so a single
 * $6000 outlier doesn't compress all $900-$1300 scores.
 */
export function computeStats(options: NormalizedOption[]): ScoringStats {
  if (options.length === 0) {
    return {
      minPrice: 0, maxPrice: 0,
      minDuration: 0, maxDuration: 0, avgDuration: 0,
      p5Price: 0, p95Price: 0,
      p5Duration: 0, p95Duration: 0,
    };
  }

  const prices = options.map(o => o.price).sort((a, b) => a - b);
  const durations = options.map(o => o.durationMinutes).sort((a, b) => a - b);

  const p5Price    = percentile(prices, 5);
  const p95Price   = percentile(prices, 95);
  const p5Duration = percentile(durations, 5);
  const p95Duration = percentile(durations, 95);

  const avgDuration = durations.reduce((s, d) => s + d, 0) / durations.length;

  return {
    minPrice:    prices[0],
    maxPrice:    prices[prices.length - 1],
    minDuration: durations[0],
    maxDuration: durations[durations.length - 1],
    avgDuration,
    p5Price,
    p95Price,
    p5Duration,
    p95Duration,
  };
}

/**
 * Normalize a value within a percentile-clipped range.
 * Returns 0-1 where 1 = best (lowest for price/duration).
 *
 * Values below p5 get clamped to 1.0 (at or better than 5th percentile).
 * Values above p95 get clamped to 0.0 (at or worse than 95th percentile).
 * Values between p5 and p95 get linearly interpolated.
 */
export function clippedNorm(value: number, p5: number, p95: number): number {
  if (p95 <= p5) return 0.5; // No meaningful range → neutral
  const clamped = Math.max(p5, Math.min(p95, value));
  return (p95 - clamped) / (p95 - p5);
}
