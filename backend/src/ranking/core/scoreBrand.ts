/**
 * Brand / Airline Reputation Score
 *
 * Uses a configurable brand reputation table (brand-scores.json).
 * Default neutral score for unknown airlines = 70.
 *
 * Tiers:
 *   premium        = 85–95
 *   preferred       = 75–85
 *   standard       = 65–75
 *   low_confidence = 50–65
 *   unknown        = 70 (neutral)
 */

import brandScoresConfig from '../config/brand-scores.json';

interface BrandConfig {
  _comment: string;
  defaultScore: number;
  airlines: Record<string, { airlineName: string; score: number; tier: string }>;
}

const config = brandScoresConfig as BrandConfig;

/**
 * Compute brand reputation score for an airline.
 *
 * @param airlineCode - IATA airline code (e.g., "QR", "NK")
 * @param customScores - Optional override scores (for admin/A-B testing)
 * @returns Score from 0 to 100
 */
export function scoreBrand(
  airlineCode: string,
  customScores?: Record<string, number>,
): number {
  // Check custom override first (for admin/A-B testing)
  if (customScores && airlineCode in customScores) {
    return Math.max(0, Math.min(100, customScores[airlineCode]));
  }

  // Look up in config
  const entry = config.airlines[airlineCode];
  if (entry) {
    return Math.max(0, Math.min(100, entry.score));
  }

  // Unknown airline → neutral score
  return config.defaultScore;
}
