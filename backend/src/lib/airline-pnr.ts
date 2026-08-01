/**
 * Airline PNR — the AIRLINE's own record locator, kept distinct from Mystifly's.
 *
 * Three identifiers, three purposes:
 *
 *   FareMind reference   FM9IPA4E     our support + internal lookup
 *   Mystifly reference   MF35532626   Mystifly servicing APIs (refund, reissue,
 *                                     void, cancel, polling, reconciliation)
 *   Airline PNR          EMBV6D7      airline check-in, airline support, the
 *                                     airline's own itinerary lookup
 *
 * The platform was rendering the Mystifly reference under an "Airline PNR"
 * label, which sends a customer to the airline quoting a code the airline has
 * never heard of. The real locator sits in TripDetails at
 * `ReservationItems[].AirlinePNR` and was not stored anywhere.
 *
 * Provider quirk worth knowing: on the environments seen so far Mystifly also
 * returns that same value in `PassengerInfos[].ETickets[].ETicketNumber`, so
 * the "e-ticket number" and the airline PNR can be identical. That is the
 * provider's doing, not a mapping error on our side — we store what it sends
 * and keep the fields separate so a real ticket number can land later.
 */

/** One airline locator, and which segments it covers. */
export interface AirlinePnrEntry {
  airlinePnr: string;
  airlineCode: string | null;
  /** ItemRPH values from ReservationItems this locator applies to. */
  itemRphs: number[];
}

export interface AirlinePnrResult {
  /** The locator to show when a single value is needed. Null when unavailable. */
  primary: string | null;
  /** Every distinct locator — more than one on multi-airline / codeshare trips. */
  entries: AirlinePnrEntry[];
}

function itinerary(raw: any): any {
  return raw?.Data?.TripDetailsResult?.TravelItinerary
    || raw?.Data?.TravelItinerary
    || raw?.TripDetailsResult?.TravelItinerary
    || raw?.TravelItinerary
    || raw;
}

/**
 * Pull every airline record locator out of a TripDetails payload.
 *
 * Returns `{ primary: null, entries: [] }` when the payload carries none —
 * callers must render "Not Available" rather than substituting the Mystifly
 * reference, and must not overwrite a stored value with nothing.
 *
 * Never throws; a malformed payload yields the empty result.
 */
export function extractAirlinePnrs(raw: any): AirlinePnrResult {
  try {
    const ti = itinerary(raw);

    // ReservationItems live under Itineraries[].ItineraryInfo on current
    // TripDetails, but older shapes put them at ItineraryInfo directly.
    const groups: any[] = [
      ...(Array.isArray(ti?.Itineraries) ? ti.Itineraries.map((i: any) => i?.ItineraryInfo) : []),
      ti?.ItineraryInfo,
    ].filter(Boolean);

    const items: any[] = groups.flatMap((g) =>
      Array.isArray(g?.ReservationItems) ? g.ReservationItems : []);

    const byPnr = new Map<string, AirlinePnrEntry>();
    for (const it of items) {
      const pnr = String(it?.AirlinePNR ?? '').trim();
      if (!pnr) continue;
      const code = String(
        it?.OperatingAirlineCode ?? it?.MarketingAirlineCode ?? it?.Airline ?? '',
      ).trim() || null;

      const existing = byPnr.get(pnr);
      if (existing) {
        if (typeof it?.ItemRPH === 'number') existing.itemRphs.push(it.ItemRPH);
        if (!existing.airlineCode && code) existing.airlineCode = code;
      } else {
        byPnr.set(pnr, {
          airlinePnr: pnr,
          airlineCode: code,
          itemRphs: typeof it?.ItemRPH === 'number' ? [it.ItemRPH] : [],
        });
      }
    }

    const entries = [...byPnr.values()];
    // The locator covering the most segments is the one to show when a single
    // value is needed — on a codeshare that is the operating carrier's.
    const primary = entries.length
      ? [...entries].sort((a, b) => b.itemRphs.length - a.itemRphs.length)[0].airlinePnr
      : null;

    return { primary, entries };
  } catch {
    return { primary: null, entries: [] };
  }
}

/**
 * Guard against the defect this module exists to fix.
 *
 * A Mystifly reference is `MF` followed by digits. If that shape ever reaches
 * an airline-PNR field, something has substituted one identifier for the other
 * and the value must be rejected rather than shown to a customer.
 */
export function looksLikeMystiflyRef(value: string | null | undefined): boolean {
  return /^MF\d+$/i.test(String(value ?? '').trim());
}

/** The airline PNR if it is genuinely one, else null. Never returns a Mystifly ref. */
export function safeAirlinePnr(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim();
  if (!v || looksLikeMystiflyRef(v)) return null;
  return v;
}
