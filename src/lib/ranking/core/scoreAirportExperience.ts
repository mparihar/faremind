/**
 * Airport Experience & Ancillaries Score
 *
 * Considers:
 *   1. Airport connection quality
 *   2. Lounge availability
 *   3. Ease of terminal transfer
 *   4. Overnight layover risk
 *   5. Meals included
 *   6. WiFi availability
 *   7. Seat selection availability
 *   8. Family seating support
 *   9. Airport change required
 *
 * Low weight for domestic (0.5%), higher for international (2%).
 */

import type { JourneyType } from '../types';

/**
 * Compute airport experience and ancillaries score.
 *
 * @param loungeAccess - Whether lounge access is included
 * @param mealsIncluded - Whether meals are included
 * @param wifiAvailable - Whether WiFi is available
 * @param seatSelectionAvailable - Whether seat selection is available
 * @param familySeatingAvailable - Whether family seating is supported
 * @param hasAirportChange - Whether connection requires airport change
 * @param hasTerminalChange - Whether connection requires terminal change
 * @param hasOvernightLayover - Whether any layover is overnight
 * @param layoverDurations - Array of layover durations in minutes
 * @param journeyType - domestic or international
 * @returns Score from 0 to 100
 */
export function scoreAirportExperience(
  loungeAccess: boolean,
  mealsIncluded: boolean,
  wifiAvailable: boolean,
  seatSelectionAvailable: boolean,
  familySeatingAvailable: boolean,
  hasAirportChange: boolean,
  hasTerminalChange: boolean,
  hasOvernightLayover: boolean,
  layoverDurations: number[],
  journeyType: JourneyType,
): number {
  let score = 65; // Baseline: average experience

  // ── Positive factors ──────────────────────────────────────────────────────
  if (loungeAccess) score += 12;
  if (mealsIncluded) score += 6;
  if (wifiAvailable) score += 4;
  if (seatSelectionAvailable) score += 5;
  if (familySeatingAvailable) score += 4;

  // ── Negative factors ──────────────────────────────────────────────────────
  if (hasAirportChange) score -= 20;
  else if (hasTerminalChange) score -= 8;

  if (hasOvernightLayover) {
    // Worse for international where airport options may be limited
    score -= journeyType === 'international' ? 12 : 6;
  }

  // ── Long layover quality ──────────────────────────────────────────────────
  // Very long layovers degrade experience unless amenities compensate
  for (const layover of layoverDurations) {
    if (journeyType === 'international' && layover > 420) {
      // >7h international layover
      if (!loungeAccess) score -= 5;
    }
    if (journeyType === 'domestic' && layover > 240) {
      // >4h domestic layover
      score -= 3;
    }
  }

  // ── Nonstop bonus ─────────────────────────────────────────────────────────
  if (layoverDurations.length === 0) {
    score += 5; // No airport transfer needed
  }

  return Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
}
