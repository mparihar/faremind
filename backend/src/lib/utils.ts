/**
 * Backend utility functions (server-side only).
 * No client-side dependencies (clsx, etc.).
 */

export function formatPrice(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getAirlineLogo(code: string): string {
  return `https://images.kiwi.com/airlines/64/${code}.png`;
}

export function generateId(): string {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

/**
 * Calculate a value score for a single flight offer.
 *
 * Uses a combination of relative (within-set) and absolute scoring
 * to differentiate flights even when attributes are very similar.
 *
 * Note: This is an absolute scoring function (no access to the full result set).
 * For set-relative scoring, see mergeAndRankFlights in normalizer.ts
 * and rankRoundTripOptions in round-trip-score.ts.
 */
export function calculateValueScore(
  price: number,
  duration: number,
  stops: number,
  refundable: boolean
): number {
  // Price score: use a log-scale curve so $200 and $2000 flights
  // don't both end up near 100. Anchor: $300 = 80, $1500 = 30.
  const priceScore = Math.max(0, Math.min(100,
    120 - 25 * Math.log10(Math.max(price, 50))
  ));

  // Duration score: short-haul (<3h) = 90+, long-haul (18h) ≈ 25
  const durationScore = Math.max(0, Math.min(100,
    100 - (duration / 12)
  ));

  // Stops: 0 = 40, 1 = 20, 2+ = 5
  const stopScore = stops === 0 ? 40 : stops === 1 ? 20 : 5;

  // Refundable bonus
  const refundScore = refundable ? 10 : 0;

  return Math.round(
    priceScore * 0.45 +
    durationScore * 0.30 +
    stopScore * 0.15 +
    refundScore * 0.10
  );
}
