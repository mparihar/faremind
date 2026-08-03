/**
 * Bring a stored itinerary back in line with the provider's.
 *
 * A reissue changes the flights at the airline. Nothing applied that change to
 * our records: reissue-settlement archived the TripDetails payload into
 * BookingProviderPayload and stopped there, so BookingSegment kept the flights
 * booked originally. FMVTT9ZQ showed AI 1785 / AI 1851 to the customer while the
 * airline held 1745 / 2422 — a passenger reading that page would go to a flight
 * that is not on their ticket.
 *
 * Datetimes are constructed exactly as the checkout confirm route does —
 * `new Date(<provider local string>)` on the same shape of value TripDetails and
 * search both return. Reproducing the expression rather than inventing one keeps
 * whatever convention the stored rows already use.
 *
 * When the provider's segment count does not match ours the itinerary is NOT
 * rewritten. A different number of segments means the trip was restructured, and
 * pairing them positionally would scramble it; that case is escalated to a human
 * instead.
 */

import { prisma } from '../lib/db';
import * as mbq from '../lib/manage-booking-queries';
import { getTripDetailsResilient } from './mystifly';

export interface SegmentDiff {
  segmentOrder: number;
  field: string;
  from: string;
  to: string;
}

export interface ItinerarySyncResult {
  applied: boolean;
  changed: number;
  diffs: SegmentDiff[];
  reason?: string;
}

interface ProviderSegment {
  flightNumber: string;
  airlineCode: string;
  operatingAirlineCode: string | null;
  originAirport: string;
  destinationAirport: string;
  departureDateTime: Date | null;
  arrivalDateTime: Date | null;
  cabin: string | null;
}

/**
 * ReservationItems for the itinerary the ticket is CURRENTLY on.
 *
 * After a reissue TripDetails returns both, distinguished only by the group's
 * Type — every segment still says FlightStatus "HK" and the ItemRPH values
 * repeat across groups, so nothing at the item level tells them apart:
 *
 *   Itineraries[0].Type = "TravelItinerary"      1745, 2422   ← current
 *   Itineraries[1].Type = "ExchangedItinerary"   1785, 1851   ← superseded
 *
 * Flattening every group would have produced four segments against our two and,
 * had the counts happened to line up, would have written the old flights over
 * the new ones. Only TravelItinerary is current; the older shape with a bare
 * ItineraryInfo and no Type predates reissue support and is taken as-is.
 */
function reservationItems(trip: any): any[] {
  const ti = trip?.Data?.TripDetailsResult?.TravelItinerary
    ?? trip?.TripDetailsResult?.TravelItinerary
    ?? trip?.TravelItinerary
    ?? trip;

  const groups: any[] = Array.isArray(ti?.Itineraries)
    ? ti.Itineraries
        .filter((i: any) => {
          const type = String(i?.Type ?? '').trim();
          return !type || /^travelitinerary$/i.test(type);
        })
        .map((i: any) => i?.ItineraryInfo)
    : [];
  if (groups.length === 0 && ti?.ItineraryInfo) groups.push(ti.ItineraryInfo);

  return groups.filter(Boolean)
    .flatMap((g) => (Array.isArray(g?.ReservationItems) ? g.ReservationItems : []));
}

function toDate(v: unknown): Date | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function mapProviderSegments(trip: any): ProviderSegment[] {
  return reservationItems(trip).map((r: any) => ({
    flightNumber: String(r?.FlightNumber ?? '').trim(),
    airlineCode: String(r?.MarketingAirlineCode ?? r?.OperatingAirlineCode ?? '').trim(),
    operatingAirlineCode: String(r?.OperatingAirlineCode ?? '').trim() || null,
    originAirport: String(r?.DepartureAirportLocationCode ?? '').trim(),
    destinationAirport: String(r?.ArrivalAirportLocationCode ?? '').trim(),
    departureDateTime: toDate(r?.DepartureDateTime),
    arrivalDateTime: toDate(r?.ArrivalDateTime),
    cabin: String(r?.CabinClass ?? '').trim() || null,
  })).filter((s) => s.flightNumber && s.originAirport && s.destinationAirport);
}

const sameTime = (a: Date | null | undefined, b: Date | null) =>
  !b || (!!a && new Date(a).getTime() === b.getTime());

/**
 * Compare the provider's itinerary with ours and apply the differences.
 * Pass `trip` to reuse a payload already fetched; otherwise it is fetched here.
 */
export async function syncItineraryFromTripDetails(
  bookingId: string,
  mfRef: string,
  trip?: any,
): Promise<ItinerarySyncResult> {
  const none: ItinerarySyncResult = { applied: false, changed: 0, diffs: [] };
  try {
    const payload = trip ?? await getTripDetailsResilient(mfRef);
    const providerSegs = mapProviderSegments(payload);
    if (providerSegs.length === 0) return { ...none, reason: 'provider returned no segments' };

    const stored = await prisma.bookingSegment.findMany({
      where: { bookingId },
      orderBy: { segmentOrder: 'asc' },
    });
    if (stored.length === 0) return { ...none, reason: 'no stored segments' };

    if (stored.length !== providerSegs.length) {
      // Restructured trip — pairing by position would scramble it.
      const reason = `provider has ${providerSegs.length} segment(s), we hold ${stored.length}`;
      console.error(`[itinerary-sync] ${mfRef}: ${reason} — not rewriting; escalating.`);
      await mbq.createBookingEvent({
        bookingId,
        eventType: 'ITINERARY_DRIFT_UNRESOLVED',
        eventTitle: 'Itinerary differs from the airline and could not be synced automatically',
        eventDescription: `The airline holds a different number of segments (${reason}). The stored itinerary was left untouched to avoid scrambling it; it needs manual review.`,
        actorType: 'system', actorName: 'Itinerary Sync',
      }).catch(() => {});
      await raiseDriftTicket(bookingId, mfRef, reason);
      return { ...none, reason };
    }

    const diffs: SegmentDiff[] = [];
    for (let i = 0; i < stored.length; i++) {
      const s = stored[i];
      const p = providerSegs[i];
      const data: Record<string, unknown> = {};

      if (p.flightNumber && p.flightNumber !== s.flightNumber) {
        diffs.push({ segmentOrder: s.segmentOrder, field: 'flightNumber', from: s.flightNumber, to: p.flightNumber });
        data.flightNumber = p.flightNumber;
      }
      if (p.airlineCode && p.airlineCode !== s.airlineCode) {
        diffs.push({ segmentOrder: s.segmentOrder, field: 'airlineCode', from: s.airlineCode, to: p.airlineCode });
        data.airlineCode = p.airlineCode;
      }
      if (p.originAirport && p.originAirport !== s.originAirport) {
        diffs.push({ segmentOrder: s.segmentOrder, field: 'originAirport', from: s.originAirport, to: p.originAirport });
        data.originAirport = p.originAirport;
      }
      if (p.destinationAirport && p.destinationAirport !== s.destinationAirport) {
        diffs.push({ segmentOrder: s.segmentOrder, field: 'destinationAirport', from: s.destinationAirport, to: p.destinationAirport });
        data.destinationAirport = p.destinationAirport;
      }
      if (!sameTime(s.departureDateTime, p.departureDateTime)) {
        diffs.push({ segmentOrder: s.segmentOrder, field: 'departureDateTime', from: s.departureDateTime.toISOString(), to: p.departureDateTime!.toISOString() });
        data.departureDateTime = p.departureDateTime;
      }
      if (!sameTime(s.arrivalDateTime, p.arrivalDateTime)) {
        diffs.push({ segmentOrder: s.segmentOrder, field: 'arrivalDateTime', from: s.arrivalDateTime.toISOString(), to: p.arrivalDateTime!.toISOString() });
        data.arrivalDateTime = p.arrivalDateTime;
      }
      if (p.operatingAirlineCode && p.operatingAirlineCode !== s.operatingAirlineCode) {
        data.operatingAirlineCode = p.operatingAirlineCode;
      }

      if (Object.keys(data).length > 0) {
        await prisma.bookingSegment.update({ where: { id: s.id }, data });
      }
    }

    if (diffs.length === 0) return { applied: true, changed: 0, diffs: [] };

    // Journeys carry their own origin/destination/departure for list views.
    await syncJourneys(bookingId, providerSegs);

    const summary = diffs
      .filter((d) => d.field === 'flightNumber' || d.field === 'departureDateTime')
      .map((d) => `segment ${d.segmentOrder}: ${d.field} ${d.from} → ${d.to}`)
      .join('; ');
    await mbq.createBookingEvent({
      bookingId,
      eventType: 'ITINERARY_SYNCED',
      eventTitle: 'Itinerary updated from the airline',
      eventDescription: `${diffs.length} field(s) differed from the airline and were corrected. ${summary}`,
      actorType: 'system', actorName: 'Itinerary Sync',
      payloadJson: { mfRef, diffs },
    }).catch(() => {});

    console.log(`[itinerary-sync] ${mfRef}: applied ${diffs.length} change(s).`);
    return { applied: true, changed: diffs.length, diffs };
  } catch (err) {
    console.error(`[itinerary-sync] ${mfRef} failed:`, (err as Error).message);
    return { ...none, reason: (err as Error).message };
  }
}

/** Keep journey-level origin/destination/times aligned with their segments. */
async function syncJourneys(bookingId: string, providerSegs: ProviderSegment[]): Promise<void> {
  const journeys = await prisma.bookingJourney.findMany({
    where: { bookingId },
    orderBy: { journeyOrder: 'asc' },
    include: { segments: { orderBy: { segmentOrder: 'asc' } } },
  });
  for (const j of journeys) {
    if (j.segments.length === 0) continue;
    const first = j.segments[0];
    const last = j.segments[j.segments.length - 1];
    await prisma.bookingJourney.update({
      where: { id: j.id },
      data: {
        originAirport: first.originAirport,
        destinationAirport: last.destinationAirport,
        departureDateTime: first.departureDateTime,
        arrivalDateTime: last.arrivalDateTime,
      },
    }).catch(() => {});
  }
}

async function raiseDriftTicket(bookingId: string, mfRef: string, reason: string): Promise<void> {
  const booking = await prisma.masterBooking.findUnique({
    where: { id: bookingId },
    select: { masterBookingReference: true, airlinePnr: true, customerName: true, customerEmail: true },
  }).catch(() => null);
  if (!booking) return;

  const existing = await prisma.supportTicket.findFirst({
    where: { bookingRef: booking.masterBookingReference, ticketType: 'ITINERARY_DRIFT', status: { in: ['OPEN', 'IN_PROGRESS'] } },
    select: { id: true },
  }).catch(() => null);
  if (existing) return;

  await prisma.supportTicket.create({
    data: {
      subject: `Itinerary differs from the airline: ${booking.masterBookingReference}`,
      description: [
        `The airline's itinerary for ${booking.masterBookingReference} does not match ours and could not be synced automatically.`,
        '',
        `Reason: ${reason}`,
        `Airline PNR: ${booking.airlinePnr ?? 'n/a'}`,
        '',
        'The customer may be seeing flights that are not on their ticket.',
        'Compare TripDetails against the booking and correct it by hand.',
      ].join('\n'),
      priority: 'HIGH', status: 'OPEN', category: 'Booking', channel: 'SYSTEM',
      customerName: booking.customerName ?? '',
      customerEmail: booking.customerEmail ?? '',
      bookingRef: booking.masterBookingReference,
      airlinePnr: booking.airlinePnr ?? undefined,
      ticketType: 'ITINERARY_DRIFT', queue: 'CANCELLATION_SUPPORT',
    } as any,
  }).catch((e) => console.error('[itinerary-sync] drift ticket failed:', e?.message));
}
