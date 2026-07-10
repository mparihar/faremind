/**
 * Duration Score
 *
 * Compares each itinerary duration against the shortest in the set.
 * Uses configurable penalty ranges:
 *   - Domestic: 360 min (6h) → beyond this, score approaches 0
 *   - International: 720 min (12h) → beyond this, score approaches 0
 *
 * Formula:
 *   durationScore = 100 - ((offerDuration - minDuration) / penaltyRange) * 100
 *   Clamped to [0, 100]
 */

/**
 * Compute duration score for a single offer.
 *
 * @param offerDurationMinutes - This offer's total duration
 * @param minDurationMinutes - Shortest duration in the comparable set
 * @param penaltyRange - Penalty range in minutes (from profile config)
 * @returns Score from 0 to 100
 */
export function scoreDuration(
  offerDurationMinutes: number,
  minDurationMinutes: number,
  penaltyRange: number,
): number {
  // Same as fastest → perfect score
  if (offerDurationMinutes <= minDurationMinutes) return 100;

  // Avoid division by zero
  if (penaltyRange <= 0) return 100;

  const excess = offerDurationMinutes - minDurationMinutes;
  const raw = 100 - (excess / penaltyRange) * 100;

  return Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100;
}

/**
 * Compute duration scores for all offers in the set.
 *
 * @param durations - Array of durations in minutes
 * @param penaltyRange - Penalty range from profile config
 * @returns Array of scores (0–100), same order as input
 */
export function computeDurationScores(
  durations: number[],
  penaltyRange: number,
): number[] {
  if (durations.length === 0) return [];
  const minDuration = Math.min(...durations);
  return durations.map(d => scoreDuration(d, minDuration, penaltyRange));
}
