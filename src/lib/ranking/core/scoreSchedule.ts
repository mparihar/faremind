/**
 * Schedule Convenience Score
 *
 * Evaluates departure and arrival times for traveler convenience.
 * Uses configurable bands for domestic vs international.
 *
 * Domestic: 7am–8pm departure ideal, arrival before 11pm
 * International: 8am–11pm departure, penalize midnight–5am arrival
 *
 * Score bands:
 *   ideal          = 90–100
 *   acceptable     = 70–89
 *   inconvenient   = 45–69
 *   very inconvenient = 20–44
 *   bad            = 0–19
 */

import type { ScheduleBand, JourneyType } from '../types';

/**
 * Score departure time convenience (0–100).
 */
function scoreDepartureTime(hour: number, minute: number, band: ScheduleBand): number {
  const time = hour + minute / 60;
  const idealStart = band.idealDepartureStart;
  const idealEnd = band.idealDepartureEnd;

  // Ideal window
  if (time >= idealStart && time <= idealEnd) {
    // Peak sweet spot: 8am–10am and 4pm–6pm slightly higher
    if ((time >= 8 && time <= 10) || (time >= 16 && time <= 18)) return 95;
    // Core ideal zone
    if (time >= idealStart + 1 && time <= idealEnd - 1) return 90;
    // Edge of ideal
    return 82;
  }

  // Early morning (5am–7am for domestic, 6am–8am for intl)
  if (time >= idealStart - 2 && time < idealStart) {
    return 55 + (time - (idealStart - 2)) * 12;
  }

  // Late evening after ideal
  if (time > idealEnd && time <= idealEnd + 2) {
    return 60 - (time - idealEnd) * 15;
  }

  // Very early morning (before 5am)
  if (time < idealStart - 2) {
    return Math.max(5, 30 - (idealStart - 2 - time) * 10);
  }

  // Very late night (after 10pm for domestic)
  return Math.max(5, 25 - (time - idealEnd - 2) * 10);
}

/**
 * Score arrival time convenience (0–100).
 */
function scoreArrivalTime(hour: number, minute: number, band: ScheduleBand): number {
  const time = hour + minute / 60;
  const penaltyStart = band.penaltyArrivalStart;
  const penaltyEnd = band.penaltyArrivalEnd;

  // Handle wrap-around for midnight penalty zone (e.g., 23:00–05:00)
  const inPenaltyZone = penaltyStart > penaltyEnd
    ? (time >= penaltyStart || time <= penaltyEnd)
    : (time >= penaltyStart && time <= penaltyEnd);

  if (inPenaltyZone) {
    // Deep penalty: midnight to 3am
    if (time >= 0 && time <= 3) return 8;
    // Moderate penalty: 3am–5am
    if (time > 3 && time <= 5) return 25;
    // Late night but not terrible: 11pm–midnight
    if (time >= 23) return 40;
    return 15;
  }

  // Ideal arrival: before 9pm
  if (time >= 8 && time <= 21) return 95;
  // Acceptable: 9pm–11pm
  if (time > 21 && time < penaltyStart) return 70;
  // Early morning arrival (5am–8am)
  if (time > penaltyEnd && time < 8) return 55;

  return 60;
}

/**
 * Compute schedule convenience score for an offer.
 *
 * @param departureHour - Departure hour (0–23)
 * @param departureMinute - Departure minute (0–59)
 * @param arrivalHour - Arrival hour (0–23)
 * @param arrivalMinute - Arrival minute (0–59)
 * @param band - Schedule configuration band
 * @param journeyType - domestic or international
 * @returns Score from 0 to 100
 */
export function scoreSchedule(
  departureHour: number,
  departureMinute: number,
  arrivalHour: number,
  arrivalMinute: number,
  band: ScheduleBand,
  journeyType: JourneyType,
): number {
  const depScore = scoreDepartureTime(departureHour, departureMinute, band);
  const arrScore = scoreArrivalTime(arrivalHour, arrivalMinute, band);

  // For domestic, departure convenience matters more (people often have same-day plans)
  // For international, arrival convenience matters more (jet lag, ground transport)
  const depWeight = journeyType === 'domestic' ? 0.6 : 0.45;
  const arrWeight = journeyType === 'domestic' ? 0.4 : 0.55;

  const raw = depScore * depWeight + arrScore * arrWeight;
  return Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100;
}
