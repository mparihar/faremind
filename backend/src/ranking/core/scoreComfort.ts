/**
 * Comfort Score
 *
 * Evaluates travel comfort based on cabin class, seat quality,
 * aircraft amenities, and long-haul adjustments.
 *
 * Score ranges:
 *   basic economy    = 35–50
 *   standard economy = 55–70
 *   preferred/extra  = 70–80
 *   premium economy  = 80–90
 *   business/first   = 90–100
 *
 * Long-haul rule:
 *   If any segment > 8 hours on international, comfort becomes
 *   more important via a context multiplier applied in the rules engine.
 *   Basic economy receives additional penalty on long-haul.
 */

import type { CabinClass, JourneyType } from '../types';

/**
 * Detect if fare name indicates basic economy.
 */
function isBasicEconomy(fareClassName: string): boolean {
  const lower = fareClassName.toLowerCase();
  return lower.includes('basic') || lower.includes('light') || lower.includes('saver');
}

/**
 * Get base cabin score from cabin class and fare name.
 */
function getCabinBaseScore(cabinClass: CabinClass, fareClassName: string): number {
  switch (cabinClass) {
    case 'first':
      return 96;
    case 'business':
      return 92;
    case 'premium_economy':
      return 82;
    case 'economy':
    default:
      if (isBasicEconomy(fareClassName)) return 40;
      if (fareClassName.toLowerCase().includes('flex')) return 68;
      if (fareClassName.toLowerCase().includes('classic')) return 62;
      return 60; // standard economy
  }
}

/**
 * Compute comfort score for a single offer.
 *
 * @param cabinClass - Cabin class
 * @param fareClassName - Fare brand name (e.g., "Basic Economy", "Flex")
 * @param seatPitch - Seat pitch in inches (if available)
 * @param seatSelection - Seat selection availability
 * @param wifiAvailable - Whether WiFi is available
 * @param mealsIncluded - Whether meals are included
 * @param entertainmentAvailable - Whether IFE is available
 * @param priorityBoarding - Whether priority boarding is included
 * @param loungeAccess - Whether lounge access is included
 * @param longestSegmentMinutes - Longest segment duration in minutes
 * @param journeyType - domestic or international
 * @returns Score from 0 to 100
 */
export function scoreComfort(
  cabinClass: CabinClass,
  fareClassName: string,
  seatPitch: number | undefined,
  seatSelection: 'free' | 'fee' | 'not_available' | undefined,
  wifiAvailable: boolean,
  mealsIncluded: boolean,
  entertainmentAvailable: boolean,
  priorityBoarding: boolean,
  loungeAccess: boolean,
  longestSegmentMinutes: number,
  journeyType: JourneyType,
): number {
  let score = getCabinBaseScore(cabinClass, fareClassName);

  // ── Seat quality adjustments ────────────────────────────────────────────────
  if (seatPitch !== undefined) {
    if (seatPitch >= 36) score += 4;       // Extra legroom
    else if (seatPitch >= 32) score += 2;  // Above average
    else if (seatPitch <= 28) score -= 3;  // Very tight
  }

  if (seatSelection === 'free') score += 3;
  else if (seatSelection === 'not_available') score -= 2;

  // ── Amenity adjustments ─────────────────────────────────────────────────────
  if (wifiAvailable) score += 2;
  if (mealsIncluded) score += 2;
  if (entertainmentAvailable) score += 1;
  if (priorityBoarding) score += 1;
  if (loungeAccess) score += 3;

  // ── Long-haul comfort adjustment ───────────────────────────────────────────
  if (journeyType === 'international' && longestSegmentMinutes > 480) {
    // Long-haul: comfort matters more
    // Basic economy on long-haul gets additional penalty
    if (isBasicEconomy(fareClassName) && cabinClass === 'economy') {
      score -= 5;
    }
    // Premium cabins get a slight boost on long-haul
    if (cabinClass === 'business' || cabinClass === 'first') {
      score += 2;
    }
    // Meals become very important on long-haul
    if (!mealsIncluded && cabinClass === 'economy') {
      score -= 3;
    }
  }

  return Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
}
