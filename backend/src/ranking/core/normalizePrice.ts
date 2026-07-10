/**
 * Price Score Normalization — Distance-from-Cheapest
 *
 * Instead of normalizing across the full min-max price range
 * (which compresses scores when the range is wide), this approach
 * scores each offer based on its premium above the CHEAPEST option.
 *
 * Calibration:
 *   - Cheapest offer = 100
 *   - Each 1% above cheapest ≈ -2 points
 *   - 50% above cheapest = 0 (capped)
 *
 * Example (DFW→DEL with cheapest = $1,252):
 *   $1,252 → 100  (cheapest)
 *   $1,377 → 80   (10% above)
 *   $1,494 → 61   (19% above)
 *   $1,620 → 41   (29% above)
 *
 * Compare to old min-max with P95 at $4,000:
 *   $1,252 → 86,  $1,377 → 82,  $1,494 → 78,  $1,620 → 74
 *   (all within 12 points — no meaningful separation)
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
 * @param effectiveMaxPrice - Capped maximum price for normalization
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
 * Compute price scores for all offers using distance-from-cheapest.
 *
 * The effective max is set to cheapest × 1.50 (i.e., 50% premium cap),
 * bounded by P90 so extreme outliers don't skew things. This creates
 * a FOCUSED scoring window around the cheapest fare.
 *
 * @param prices - Array of prices corresponding to offers
 * @returns Array of price scores (0–100), same order as input
 */
export function computePriceScores(prices: number[]): number[] {
  if (prices.length === 0) return [];
  if (prices.length === 1) return [100];

  const sorted = [...prices].sort((a, b) => a - b);
  const minPrice = sorted[0];

  // FOCUSED range: cheapest + 50% of cheapest price.
  // A $1,252 cheapest → range caps at $1,878.
  // A $200 cheapest → range caps at $300.
  const focusedMax = minPrice * 1.50;

  // Also compute P90 — if all prices cluster tightly (P90 < focusedMax),
  // use P90 for an even tighter range. Otherwise cap at focusedMax.
  const p90Price = percentile(sorted, 90);

  // Use the SMALLER of focusedMax and P90 to keep the range tight.
  // This ensures price differences produce meaningful score separation.
  let effectiveMaxPrice = Math.min(focusedMax, p90Price);

  // Minimum range guard: ensure at least 10% of min price
  // so near-identical prices don't produce extreme 100 vs 0.
  const minimumRange = minPrice * 0.10;
  if (effectiveMaxPrice - minPrice < minimumRange) {
    effectiveMaxPrice = minPrice + minimumRange;
  }

  return prices.map(price => normalizePrice(price, minPrice, effectiveMaxPrice));
}
