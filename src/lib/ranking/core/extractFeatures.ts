/**
 * Feature Extraction
 *
 * Converts a RankingOffer into OfferFeatures for scoring.
 * Extracts departure/arrival times, layover durations,
 * terminal changes, cabin class, and all scoreable attributes.
 */

import type { RankingOffer, OfferFeatures, CabinClass } from '../types';

/**
 * Compute layover durations between consecutive segments.
 * A layover is the gap between one segment's arrival and the next segment's departure.
 */
function computeLayovers(segments: RankingOffer['segments']): number[] {
  const layovers: number[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const arrival = wallClockMs(segments[i].arrivalTime);
    const departure = wallClockMs(segments[i + 1].departureTime);
    if (departure > arrival) {
      layovers.push(Math.round((departure - arrival) / 60000));
    }
  }
  return layovers;
}

/**
 * Check if any connection requires a terminal change.
 */
function hasTerminalChange(segments: RankingOffer['segments']): boolean {
  for (let i = 0; i < segments.length - 1; i++) {
    const arrTerminal = segments[i].arrivalTerminal;
    const depTerminal = segments[i + 1].departureTerminal;
    if (arrTerminal && depTerminal && arrTerminal !== depTerminal) {
      return true;
    }
  }
  return false;
}

/**
 * Check if any connection requires an airport change.
 */
function hasAirportChange(segments: RankingOffer['segments']): boolean {
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].arrivalAirport !== segments[i + 1].departureAirport) {
      return true;
    }
  }
  return false;
}

/**
 * Find the longest segment duration in minutes.
 */
function findLongestSegment(segments: RankingOffer['segments']): number {
  if (segments.length === 0) return 0;
  return Math.max(...segments.map(s => s.durationMinutes));
}

/**
 * Epoch ms for the airport wall clock in an ISO-ish string.
 *
 * Kept local rather than imported from `lib/provider-time` because this file is
 * mirrored byte-for-byte into `backend/src/ranking`, where that relative path
 * does not resolve. Same rule, same result: never let the runtime's timezone
 * decide what a layover is.
 */
function wallClockMs(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(iso ?? '');
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
}

/**
 * Extract hour and minute from an ISO 8601 datetime string.
 */
function extractTime(isoString: string): { hour: number; minute: number } {
  // The airport wall clock, not the runtime's. Departure-time scoring compares
  // these against fixed windows (early / red-eye / business-hours), so reading
  // them locally moves every offer into a different band on a non-UTC host.
  const m = /T(\d{2}):(\d{2})/.exec(isoString ?? '');
  if (m) return { hour: Number(m[1]), minute: Number(m[2]) };
  return { hour: 12, minute: 0 };
}

/**
 * Extract all scoring features from a RankingOffer.
 *
 * @param offer - The offer to extract features from
 * @returns OfferFeatures for scoring
 */
export function extractFeatures(offer: RankingOffer): OfferFeatures {
  const firstSegment = offer.segments[0];
  const lastSegment = offer.segments[offer.segments.length - 1];

  const depTime = firstSegment ? extractTime(firstSegment.departureTime) : { hour: 12, minute: 0 };
  const arrTime = lastSegment ? extractTime(lastSegment.arrivalTime) : { hour: 12, minute: 0 };

  const layoverDurations = computeLayovers(offer.segments);
  const terminalChange = hasTerminalChange(offer.segments);
  const airportChange = hasAirportChange(offer.segments);
  const longestSegment = findLongestSegment(offer.segments);

  return {
    offerId: offer.offerId,
    totalPrice: offer.totalPrice,
    durationMinutes: offer.durationMinutes,
    stops: offer.stops,
    departureHour: depTime.hour,
    departureMinute: depTime.minute,
    arrivalHour: arrTime.hour,
    arrivalMinute: arrTime.minute,
    layoverDurations,
    hasTerminalChange: terminalChange,
    hasAirportChange: airportChange,
    requiresImmigration: false, // Would need route-level data; default false
    longestSegmentMinutes: longestSegment,
    cabinClass: offer.comfort.cabinClass,
    fareClassName: offer.comfort.fareClassName || '',
    checkedBags: offer.baggage.checked,
    carryOn: offer.baggage.carryOn,
    checkedBagPaidPrice: offer.baggage.checkedBagPaidPrice,
    refundable: offer.fareRules.refundable,
    changeable: offer.fareRules.changeable,
    cancellationFee: offer.fareRules.cancellationFee,
    changeFee: offer.fareRules.changeFee,
    seatPitch: offer.comfort.seatPitch,
    seatSelection: offer.comfort.seatSelection,
    wifiAvailable: offer.comfort.wifiAvailable || offer.ancillaries.wifi || false,
    mealsIncluded: offer.comfort.mealsIncluded || offer.ancillaries.mealService || false,
    entertainmentAvailable: offer.comfort.entertainmentAvailable || false,
    priorityBoarding: offer.comfort.priorityBoarding || false,
    loungeAccess: offer.comfort.loungeAccess || offer.ancillaries.lounge || false,
    familySeatingAvailable: offer.ancillaries.familySeatingAvailable || false,
    seatSelectionAvailable: offer.ancillaries.seatSelectionAvailable || false,
    airlineCode: offer.airlineCode,
    provider: offer.provider,
    seatsRemaining: offer.seatsRemaining,
  };
}
