/**
 * Booking identifiers — four distinct things that must never stand in for
 * one another.
 *
 *   FareMind reference   FM9IPA4E     our support + internal lookup
 *   Mystifly reference   MF35532626   Mystifly servicing APIs (refund, reissue,
 *                                     void, cancel, polling) — internal only
 *   Airline PNR          EMBV6D7      airline check-in, airline support, the
 *                                     airline's own itinerary lookup
 *   E-ticket number      per passenger, stored separately
 *
 * The platform displayed the Mystifly reference under an "Airline PNR" label.
 * A customer who reads that out at an airline desk gets a blank look — the
 * airline has no record of it. Anything customer-facing must use the real
 * locator or say plainly that there isn't one.
 */

/** Mystifly's reference is `MF` + digits. Used to catch a substitution. */
export function looksLikeMystiflyRef(value: unknown): boolean {
  return /^MF\d+$/i.test(String(value ?? '').trim());
}

/**
 * The airline's record locator, or null.
 *
 * Rejects a Mystifly reference outright, so a caller that accidentally passes
 * `masterPnr` gets "Not Available" rather than a code that misleads the
 * customer. Deliberately takes no fallback argument — there is no correct
 * fallback for this field.
 */
export function airlinePnr(value: unknown): string | null {
  const v = String(value ?? '').trim();
  if (!v || looksLikeMystiflyRef(v)) return null;
  return v;
}

/** The airline's locator rendered for display. */
export function airlinePnrLabel(value: unknown, notAvailable = 'Not Available'): string {
  return airlinePnr(value) ?? notAvailable;
}

/**
 * Mystifly's booking reference, for internal/admin surfaces that legitimately
 * show it — always under its own label, never as "Airline PNR".
 */
export function mystiflyRef(booking: { mystiflyMfRef?: unknown; masterPnr?: unknown } | null | undefined): string | null {
  const v = String(booking?.mystiflyMfRef ?? booking?.masterPnr ?? '').trim();
  return v || null;
}

/**
 * OUR reference — the code on our confirmation, in our subject lines, and the
 * one support asks for.
 *
 * Templates and screens widely wrote `masterBookingReference ?? pnr`, which on a
 * Mystifly booking silently prints MF35534926 where FMCA2CIN belongs — including
 * in email subjects, where it becomes the customer's whole idea of their booking
 * number. There is no correct fallback: a missing reference is a bug to see, not
 * to paper over with an internal provider code.
 */
export function fareMindRef(value: unknown, missing = ''): string {
  const v = String(value ?? '').trim();
  if (!v || looksLikeMystiflyRef(v)) return missing;
  return v;
}
