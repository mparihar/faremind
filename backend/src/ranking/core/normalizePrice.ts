/**
 * Price Score Normalization
 *
 * Normalizes offer price within the comparable result set (0–100).
 * Applies P95 outlier protection so one extremely expensive fare
 * does not distort scores for all other offers.
 *
 * Rules:
 *   - Cheapest offer ≈ 100
 *   - Most expensive (capped at P95) ≈ 0
 *   - If all prices identical → 100 for all
 *   - Prices above P95 cap receive 0
 */

/**
 * Compute the P-th percentile of a sorted array of numbers.
 * Uses linear interpolation between closest ranks.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

/**
 * Normalize a single price to a 0–100 score.
 *
 * @param offerPrice - The price to score
 * @param minPrice - Minimum price in the set
 * @param effectiveMaxPrice - P95-capped maximum price
 * @returns Score from 0 to 100 (2 decimal places)
 */
export function normalizePrice(
  offerPrice: number,
  minPrice: number,
  effectiveMaxPrice: number,
): number {
  // All same price → perfect score
  if (effectiveMaxPrice <= minPrice) return 100;

  // Prices above the effective max cap get 0
  if (offerPrice >= effectiveMaxPrice) return 0;

  const raw = 100 - ((offerPrice - minPrice) / (effectiveMaxPrice - minPrice)) * 100;
  return Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100;
}

/**
 * Compute price scores for all offers in the comparable set.
 *
 * Uses a minimum effective range to prevent extreme score swings
 * when the price spread is small (e.g., $180 vs $195 should not
 * result in 100 vs 0).
 *
 * @param prices - Array of prices corresponding to offers
 * @returns Array of price scores (0–100), same order as input
 */
export function computePriceScores(prices: number[]): number[] {
  if (prices.length === 0) return [];
  if (prices.length === 1) return [100];

  const sorted = [...prices].sort((a, b) => a - b);
  const minPrice = sorted[0];
  const actualMaxPrice = sorted[sorted.length - 1];
  const p95Price = percentile(sorted, 95);

  // Outlier protection: cap max at P95
  let effectiveMaxPrice = Math.min(actualMaxPrice, p95Price);

  // Minimum effective range: ensure the range is at least 20% of min price.
  // This prevents tiny price differences (e.g., $15 on a $180 fare)
  // from creating extreme 100-vs-0 scores.
  const minimumRange = minPrice * 0.20;
  if (effectiveMaxPrice - minPrice < minimumRange) {
    effectiveMaxPrice = minPrice + minimumRange;
  }

  return prices.map(price => normalizePrice(price, minPrice, effectiveMaxPrice));
}

