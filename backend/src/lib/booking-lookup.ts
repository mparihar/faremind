/**
 * Booking lookup — find a booking by any reference a human would quote.
 *
 * A customer or agent knows two codes:
 *
 *   FareMind reference   FM9IPA4E     printed on our confirmation
 *   Airline PNR          EMBV6D7      what the airline and the boarding pass show
 *
 * They do NOT know Mystifly's reference (MF35532626), and should never be asked
 * for it. It is an internal provider identifier.
 *
 * So lookup accepts the first two, and the servicing flows then read
 * `mystiflyMfRef` off the resolved booking to make the actual provider calls —
 * cancel, refund, reissue, void. The customer never handles it; we map to it.
 *
 * The Mystifly reference is still ACCEPTED as a last resort, because support and
 * operations paste it out of provider tooling and a failed lookup there is worse
 * than a permissive one. It is simply never the code we ask for or display as
 * the airline's.
 */
import { prisma } from './db';

export type MatchedBy = 'faremind_reference' | 'airline_pnr' | 'mystifly_reference' | 'internal_id';

export interface BookingLookupHit {
  bookingId: string;
  masterBookingReference: string;
  /** Provider reference for servicing calls. Null on non-Mystifly bookings. */
  mystiflyRef: string | null;
  /** The airline's record locator, null when the airline has not published one. */
  airlinePnr: string | null;
  matchedBy: MatchedBy;
}

/** `MF` + digits is Mystifly's shape — used to classify input, never to display. */
function looksLikeMystiflyRef(v: string): boolean {
  return /^MF\d+$/i.test(v);
}

/**
 * Resolve a booking from any reference, in order of what a customer is most
 * likely to be holding.
 *
 * Returns null when nothing matches. Case-insensitive throughout — people type
 * these from a phone screen or read them off a boarding pass.
 */
export async function resolveBookingByAnyReference(raw?: string | null): Promise<BookingLookupHit | null> {
  const input = String(raw ?? '').trim();
  if (!input) return null;

  const select = {
    id: true,
    masterBookingReference: true,
    mystiflyMfRef: true,
    masterPnr: true,
    airlinePnr: true,
  } as const;

  const hit = (b: any, matchedBy: MatchedBy): BookingLookupHit => ({
    bookingId: b.id,
    masterBookingReference: b.masterBookingReference,
    // masterPnr is a generic provider-reference column; prefer the explicit field.
    mystiflyRef: b.mystiflyMfRef ?? (looksLikeMystiflyRef(b.masterPnr ?? '') ? b.masterPnr : null),
    airlinePnr: b.airlinePnr ?? null,
    matchedBy,
  });

  // 1. FareMind reference — what our own confirmation and emails show.
  const byRef = await prisma.masterBooking.findFirst({
    where: { masterBookingReference: { equals: input, mode: 'insensitive' } },
    select,
  });
  if (byRef) return hit(byRef, 'faremind_reference');

  // 2. Airline PNR — what the airline and the boarding pass show. Checked at
  //    booking level first, then per-PNR for multi-airline / codeshare trips.
  const byAirline = await prisma.masterBooking.findFirst({
    where: { airlinePnr: { equals: input, mode: 'insensitive' } },
    select,
  });
  if (byAirline) return hit(byAirline, 'airline_pnr');

  const byAirlinePnrRow = await prisma.bookingPnr.findFirst({
    where: { airlinePnr: { equals: input, mode: 'insensitive' } },
    select: { booking: { select } },
  });
  if (byAirlinePnrRow?.booking) return hit(byAirlinePnrRow.booking, 'airline_pnr');

  // 3. Mystifly reference — accepted for support/ops who paste it from provider
  //    tooling. Never requested from a customer.
  const byMystifly = await prisma.masterBooking.findFirst({
    where: {
      OR: [
        { mystiflyMfRef: { equals: input, mode: 'insensitive' } },
        { masterPnr: { equals: input, mode: 'insensitive' } },
      ],
    },
    select,
  });
  if (byMystifly) return hit(byMystifly, 'mystifly_reference');

  const byProviderRow = await prisma.bookingPnr.findFirst({
    where: {
      OR: [
        { pnrCode: { equals: input, mode: 'insensitive' } },
        { providerOrderId: { equals: input, mode: 'insensitive' } },
      ],
    },
    select: { booking: { select } },
  });
  if (byProviderRow?.booking) return hit(byProviderRow.booking, 'mystifly_reference');

  // 4. Internal cuid — admin deep links and internal callers.
  const byId = await prisma.masterBooking.findUnique({ where: { id: input }, select });
  if (byId) return hit(byId, 'internal_id');

  return null;
}

/**
 * The provider reference for a servicing call (cancel / refund / reissue / void).
 *
 * Callers pass whatever the user gave them — a FareMind reference or an airline
 * PNR — and get back the Mystifly reference the provider APIs require. This is
 * the mapping that lets the UI stop handling MF codes entirely.
 *
 * Returns null when the booking is not found or carries no provider reference;
 * the caller must not fabricate one.
 */
export async function resolveMystiflyRef(raw?: string | null): Promise<string | null> {
  const found = await resolveBookingByAnyReference(raw);
  return found?.mystiflyRef ?? null;
}
