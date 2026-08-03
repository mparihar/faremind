// FILE: src/lib/resolve-booking.ts
// Resolve a MasterBooking from a reference a human actually holds.
//
// There are exactly two codes we ask for:
//
//   FareMind reference   FM9IPA4E     printed on our confirmation and emails
//   Airline PNR          EOROKA       what the airline and the boarding pass show
//
// Mystifly's reference (MF35538026) is an INTERNAL provider identifier. It is
// never asked for and never displayed; the servicing flows read it off the
// resolved booking. It stays accepted as a last resort only because support and
// operations sometimes paste it out of provider tooling.
//
// This is the frontend twin of backend/src/lib/booking-lookup.ts.
import { prisma } from '@/lib/db';

export interface ResolvedBooking {
  id: string;
  masterBookingReference: string;
  bookingStatus: string;
  /** The airline's record locator, null until the airline publishes one. */
  airlinePnr: string | null;
  /** Which of the codes the caller actually gave us. */
  matchedBy: 'faremind_reference' | 'airline_pnr' | 'mystifly_reference' | 'internal_id';
}

/** `MF` + digits is Mystifly's shape — used to classify input, never to display. */
export function looksLikeMystiflyRef(v: unknown): boolean {
  return /^MF\d+$/i.test(String(v ?? '').trim());
}

const SELECT = {
  id: true,
  masterBookingReference: true,
  bookingStatus: true,
  airlinePnr: true,
} as const;

/**
 * Resolve by any reference, in the order a person is most likely to hold one.
 *
 * Case-insensitive throughout — these get typed from a phone screen or read off
 * a printed boarding pass.
 */
export async function resolveBookingByAnyRef(ref: string): Promise<ResolvedBooking | null> {
  const value = (ref || '').trim();
  if (!value) return null;

  const hit = (b: any, matchedBy: ResolvedBooking['matchedBy']): ResolvedBooking => ({
    id: b.id,
    masterBookingReference: b.masterBookingReference,
    bookingStatus: b.bookingStatus,
    airlinePnr: b.airlinePnr ?? null,
    matchedBy,
  });

  // 1 — FareMind reference, what our own confirmation shows.
  const byRef = await prisma.masterBooking.findFirst({
    where: { masterBookingReference: { equals: value, mode: 'insensitive' } },
    select: SELECT,
  });
  if (byRef) return hit(byRef, 'faremind_reference');

  // 2 — Airline PNR, what the airline and the boarding pass show. Booking level
  //     first, then per-PNR rows for multi-airline / codeshare trips.
  const byAirline = await prisma.masterBooking.findFirst({
    where: { airlinePnr: { equals: value, mode: 'insensitive' } },
    select: SELECT,
  });
  if (byAirline) return hit(byAirline, 'airline_pnr');

  const byAirlineRow = await prisma.bookingPnr.findFirst({
    where: { airlinePnr: { equals: value, mode: 'insensitive' } },
    select: { booking: { select: SELECT } },
  });
  if (byAirlineRow?.booking) return hit(byAirlineRow.booking, 'airline_pnr');

  // 3 — Provider reference. Accepted, never requested.
  const byProvider = await prisma.masterBooking.findFirst({
    where: {
      OR: [
        { mystiflyMfRef: { equals: value, mode: 'insensitive' } },
        { masterPnr: { equals: value, mode: 'insensitive' } },
        { providerOrderId: { equals: value, mode: 'insensitive' } },
      ],
    },
    select: SELECT,
  });
  if (byProvider) return hit(byProvider, 'mystifly_reference');

  const byProviderRow = await prisma.bookingPnr.findFirst({
    where: {
      OR: [
        { pnrCode: { equals: value, mode: 'insensitive' } },
        { providerOrderId: { equals: value, mode: 'insensitive' } },
      ],
    },
    select: { booking: { select: SELECT } },
  });
  if (byProviderRow?.booking) return hit(byProviderRow.booking, 'mystifly_reference');

  // 4 — Internal cuid, for admin deep links.
  const byId = await prisma.masterBooking.findUnique({ where: { id: value }, select: SELECT });
  if (byId) return hit(byId, 'internal_id');

  return null;
}

/** What a servicing console may show about a resolved booking. */
export interface ServicingTarget {
  bookingId: string;
  /** The reference the operator should be quoting. */
  fareMindRef: string;
  /** The airline's locator, or null when the airline has not published one. */
  airlinePnr: string | null;
  route: string | null;
  departureDate: string | null;
  passengerCount: number;
  bookingStatus: string;
  ticketingStatus: string | null;
  paymentStatus: string | null;
  provider: string | null;
  /** True when the booking carries a provider reference servicing can act on. */
  serviceable: boolean;
  matchedBy: ResolvedBooking['matchedBy'];
}

/**
 * Resolve a booking for the post-booking consoles and summarise it.
 *
 * Deliberately omits the Mystifly reference: the operator identifies the booking
 * by the FareMind reference or the airline PNR, and the provider code is mapped
 * to internally at call time. Returning it here would put it back on a screen.
 *
 * When both codes are supplied they must describe the same booking — servicing
 * the wrong ticket because two half-remembered codes were pasted together is not
 * a recoverable mistake.
 */
export async function resolveServicingTarget(input: {
  reference?: string | null;
  airlinePnr?: string | null;
}): Promise<
  | { found: true; target: ServicingTarget }
  | { found: false; error: string }
> {
  const ref = String(input.reference ?? '').trim();
  const pnr = String(input.airlinePnr ?? '').trim();
  if (!ref && !pnr) {
    return { found: false, error: 'Enter the FareMind reference or the airline PNR.' };
  }

  const primary = ref || pnr;
  const booking = await resolveBookingByAnyRef(primary);
  if (!booking) {
    return {
      found: false,
      error: `No booking found for "${primary}". Check the FareMind reference (FM…) or the airline PNR from the ticket.`,
    };
  }

  // Both given: they must agree. Cross-check against the per-PNR rows too, since
  // a codeshare itinerary carries a separate locator per carrier.
  if (ref && pnr) {
    const same = booking.airlinePnr && booking.airlinePnr.toLowerCase() === pnr.toLowerCase();
    if (!same) {
      const alsoOnThisBooking = await prisma.bookingPnr.findFirst({
        where: { bookingId: booking.id, airlinePnr: { equals: pnr, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!alsoOnThisBooking) {
        return {
          found: false,
          error: `"${ref}" and airline PNR "${pnr}" belong to different bookings. Clear one of the two and search again.`,
        };
      }
    }
  }

  const full = await prisma.masterBooking.findUnique({
    where: { id: booking.id },
    select: {
      mystiflyMfRef: true,
      masterPnr: true,
      providerOrderId: true,
      primaryProvider: true,
      bookingStatus: true,
      ticketingStatus: true,
      paymentStatus: true,
      journeys: {
        orderBy: { journeyOrder: 'asc' },
        select: { originAirport: true, destinationAirport: true, departureDateTime: true },
      },
      _count: { select: { passengers: true } },
    },
  });

  const js = full?.journeys ?? [];
  const route = js.length
    ? js.map((j) => `${j.originAirport}→${j.destinationAirport}`).join('  ·  ')
    : null;

  return {
    found: true,
    target: {
      bookingId: booking.id,
      fareMindRef: booking.masterBookingReference,
      airlinePnr: booking.airlinePnr,
      route,
      departureDate: js[0]?.departureDateTime ? new Date(js[0].departureDateTime).toISOString() : null,
      passengerCount: full?._count.passengers ?? 0,
      bookingStatus: full?.bookingStatus ?? booking.bookingStatus,
      ticketingStatus: full?.ticketingStatus ?? null,
      paymentStatus: full?.paymentStatus ?? null,
      provider: full?.primaryProvider ?? null,
      serviceable: Boolean(full?.mystiflyMfRef || full?.providerOrderId || looksLikeMystiflyRef(full?.masterPnr)),
      matchedBy: booking.matchedBy,
    },
  };
}
