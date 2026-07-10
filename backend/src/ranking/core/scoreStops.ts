/**
 * Stops & Layover Quality Score
 *
 * Base stop score:
 *   nonstop      = 100
 *   oneStop      = 80
 *   twoStops     = 55
 *   threeOrMore  = 25
 *
 * Adjusted by layover quality:
 *   - Short/risky layovers receive strong penalty
 *   - Ideal layover windows boost the score
 *   - Terminal/airport changes add connection risk penalty
 *
 * Domestic thresholds:
 *   <35 min: high risk (-25)
 *   45–120 min: good (+5)
 *   2–4h: acceptable (0)
 *   >4h: penalty (-10)
 *
 * International thresholds:
 *   <60 min: high risk (-25)
 *   90 min–4h: good (+5)
 *   4–7h: acceptable (0)
 *   >7h: penalty (-10)
 */

import type { LayoverThresholds, JourneyType } from '../types';

/** Base scores by number of stops */
const BASE_STOP_SCORES: Record<number, number> = {
  0: 100,
  1: 80,
  2: 55,
};

/**
 * Get base score for number of stops.
 */
function getBaseStopScore(stops: number): number {
  if (stops <= 0) return 100;
  if (stops === 1) return 80;
  if (stops === 2) return 55;
  return 25; // 3+
}

/**
 * Score a single layover duration based on thresholds.
 * Returns adjustment points (can be negative or positive).
 */
function scoreLayoverQuality(
  layoverMinutes: number,
  thresholds: LayoverThresholds,
): number {
  if (layoverMinutes < thresholds.highRiskMinutes) {
    // High risk: very short connection
    return -25;
  }

  if (layoverMinutes >= thresholds.goodRangeStart && layoverMinutes <= thresholds.goodRangeEnd) {
    // Ideal layover window
    return 5;
  }

  if (layoverMinutes > thresholds.goodRangeEnd && layoverMinutes <= thresholds.acceptableRangeEnd) {
    // Acceptable but not ideal
    return 0;
  }

  if (layoverMinutes > thresholds.acceptableRangeEnd) {
    // Too long
    return -10;
  }

  // Between high-risk and good range start (transitional)
  return -5;
}

/**
 * Compute stops and layover quality score.
 *
 * @param stops - Number of stops
 * @param layoverDurations - Array of layover durations in minutes
 * @param thresholds - Layover thresholds from profile config
 * @param hasTerminalChange - Whether any connection requires terminal change
 * @param hasAirportChange - Whether any connection requires airport change
 * @param requiresImmigration - Whether connection requires clearing immigration
 * @param journeyType - domestic or international
 * @returns Score from 0 to 100
 */
export function scoreStops(
  stops: number,
  layoverDurations: number[],
  thresholds: LayoverThresholds,
  hasTerminalChange: boolean,
  hasAirportChange: boolean,
  requiresImmigration: boolean,
  journeyType: JourneyType,
): number {
  let score = getBaseStopScore(stops);

  // If nonstop, no layover adjustments needed
  if (stops === 0 || layoverDurations.length === 0) {
    return Math.max(0, Math.min(100, score));
  }

  // Apply layover quality adjustments
  let totalLayoverAdjustment = 0;
  for (const layover of layoverDurations) {
    totalLayoverAdjustment += scoreLayoverQuality(layover, thresholds);
  }

  // Average the adjustment across layovers
  const avgAdjustment = totalLayoverAdjustment / layoverDurations.length;
  score += avgAdjustment;

  // Connection risk penalties
  if (hasAirportChange) {
    score -= 20; // Airport change is very risky
  } else if (hasTerminalChange) {
    score -= 8; // Terminal change adds risk
  }

  // Immigration/recheck risk for international
  if (journeyType === 'international' && requiresImmigration) {
    // Short layover + immigration = very risky
    const shortestLayover = Math.min(...layoverDurations);
    if (shortestLayover < 90) {
      score -= 15; // Very strong penalty
    } else if (shortestLayover < 120) {
      score -= 8; // Moderate penalty
    }
  }

  return Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
}
