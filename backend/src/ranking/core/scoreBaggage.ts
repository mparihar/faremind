/**
 * Baggage Score
 *
 * Scores baggage inclusion based on traveler expectations.
 *
 * Domestic:
 *   personal item only = 40
 *   carry-on included  = 70
 *   carry-on + checked = 100
 *   checked paid       = 60–75 depending on price
 *
 * International:
 *   no checked bag          = 35
 *   one checked included    = 90
 *   two checked included    = 100
 *   checked paid reasonable = 70
 *   unclear baggage         = uncertainty penalty
 */

import type { JourneyType } from '../types';

/**
 * Compute baggage score.
 *
 * @param carryOn - Number of carry-on bags included
 * @param checkedBags - Number of checked bags included
 * @param checkedBagPaidPrice - Price for paid checked bag (if applicable)
 * @param journeyType - domestic or international
 * @returns Score from 0 to 100
 */
export function scoreBaggage(
  carryOn: number,
  checkedBags: number,
  checkedBagPaidPrice: number | undefined,
  journeyType: JourneyType,
): number {
  if (journeyType === 'domestic') {
    return scoreBaggageDomestic(carryOn, checkedBags, checkedBagPaidPrice);
  }
  return scoreBaggageInternational(carryOn, checkedBags, checkedBagPaidPrice);
}

function scoreBaggageDomestic(
  carryOn: number,
  checkedBags: number,
  checkedBagPaidPrice: number | undefined,
): number {
  // Carry-on + checked bag included
  if (carryOn >= 1 && checkedBags >= 1) return 100;

  // Carry-on only, no checked bag
  if (carryOn >= 1 && checkedBags === 0) {
    // If checked bag is available for purchase
    if (checkedBagPaidPrice !== undefined && checkedBagPaidPrice > 0) {
      // Cheap bag: higher score; expensive: lower
      if (checkedBagPaidPrice <= 30) return 75;
      if (checkedBagPaidPrice <= 50) return 68;
      return 60;
    }
    return 70;
  }

  // No carry-on (personal item only)
  if (carryOn === 0 && checkedBags === 0) {
    if (checkedBagPaidPrice !== undefined && checkedBagPaidPrice > 0) {
      if (checkedBagPaidPrice <= 30) return 55;
      return 45;
    }
    return 40;
  }

  // Has checked but no carry-on (unusual)
  return 65;
}

function scoreBaggageInternational(
  carryOn: number,
  checkedBags: number,
  checkedBagPaidPrice: number | undefined,
): number {
  // Two or more checked bags included
  if (checkedBags >= 2) return 100;

  // One checked bag included
  if (checkedBags === 1) return 90;

  // No checked bag
  if (checkedBags === 0) {
    // Paid checked bag available
    if (checkedBagPaidPrice !== undefined && checkedBagPaidPrice > 0) {
      if (checkedBagPaidPrice <= 50) return 72;
      if (checkedBagPaidPrice <= 100) return 65;
      return 55;
    }

    // Unclear/unknown baggage — uncertainty penalty for international
    if (checkedBagPaidPrice === undefined) return 45;

    return 35;
  }

  return 70;
}
