/**
 * Pull the AIRLINE's record locator out of a Mystifly TripDetails payload.
 *
 * The locator lives at `ReservationItems[].AirlinePNR`. It is what the customer
 * quotes at check-in and to the airline's own support — distinct from Mystifly's
 * MFRef, which only ever goes to Mystifly's servicing APIs. An MF-shaped value
 * found in that field is rejected rather than displayed, so a provider or mapping
 * slip can never surface the MFRef under an "Airline PNR" label.
 *
 * Shared by the checkout confirm route and the confirmation screen's lazy
 * refresh, so both read the payload identically.
 */

/** Every shape TripDetails has been observed in, across API versions. */
function travelItinerary(raw: any): any {
  return raw?.Data?.TripDetailsResult?.TravelItinerary
    || raw?.Data?.TravelItinerary
    || raw?.TripDetailsResult?.TravelItinerary
    || raw?.TravelItinerary
    || raw;
}

/**
 * The locator covering the most segments, or null when the airline has published
 * none yet. Callers must render "Not Available" on null — never a substitute.
 */
export function airlinePnrFromTripDetails(raw: any): string | null {
  try {
    const ti = travelItinerary(raw);

    // ReservationItems sit under Itineraries[].ItineraryInfo on current
    // TripDetails; older shapes put them at ItineraryInfo directly.
    const groups: any[] = [
      ...(Array.isArray(ti?.Itineraries) ? ti.Itineraries.map((i: any) => i?.ItineraryInfo) : []),
      ti?.ItineraryInfo,
    ].filter(Boolean);

    const counts = new Map<string, number>();
    for (const g of groups) {
      for (const item of (Array.isArray(g?.ReservationItems) ? g.ReservationItems : [])) {
        const pnr = String(item?.AirlinePNR ?? '').trim();
        if (!pnr || /^MF\d+$/i.test(pnr)) continue;
        counts.set(pnr, (counts.get(pnr) ?? 0) + 1);
      }
    }
    if (counts.size === 0) return null;
    // Most segments wins — on a codeshare that is the operating carrier's.
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  } catch {
    return null;
  }
}
