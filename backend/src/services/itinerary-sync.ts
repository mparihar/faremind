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
import { terminalOf } from '../lib/terminal';

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
  originTerminal: string | null;
  destinationTerminal: string | null;
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
  // The provider sends naive local airport time with no offset. Stored rows were
  // written by `new Date(s)` on a UTC server, so the numerals landed as UTC —
  // "2026-11-14T12:00:00" is stored 12:00Z. Repeating `new Date(s)` here would
  // instead resolve against whatever zone the process runs in, and a resync run
  // from a UTC-6 machine would move every departure six hours. Pin it to UTC so
  // the same numerals are produced wherever this runs.
  //
  // Display-side timezone correctness is a separate concern and already handled
  // by services/airport-timezones + journey-time; this only has to reproduce the
  // convention the stored rows use.
  const iso = /[zZ]|[+-]\d{2}:\d{2}$/.test(s) ? s : `${s}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function mapProviderSegments(trip: any): ProviderSegment[] {
  return reservationItems(trip).map((r: any) => {
    // Stored flightNumber carries the carrier: the normalizer writes
    // `${marketingCode}${FlightNumber}`, so book time persists "AI1735" rather
    // than "1735". TripDetails gives the bare number, so prefix it here — a
    // resynced segment must be indistinguishable from a freshly booked one, or
    // the two disagree about what the column means.
    const marketing = String(r?.MarketingAirlineCode ?? r?.OperatingAirlineCode ?? '').trim();
    const bare = String(r?.FlightNumber ?? '').trim().replace(/\s+/g, '');
    const flightNumber = bare && marketing && !bare.toUpperCase().startsWith(marketing.toUpperCase())
      ? `${marketing}${bare}`
      : bare;
    return ({
    flightNumber,
    airlineCode: String(r?.MarketingAirlineCode ?? r?.OperatingAirlineCode ?? '').trim(),
    operatingAirlineCode: String(r?.OperatingAirlineCode ?? '').trim() || null,
    originAirport: String(r?.DepartureAirportLocationCode ?? '').trim(),
    destinationAirport: String(r?.ArrivalAirportLocationCode ?? '').trim(),
    // Terminals exist ONLY here. Mystifly's search response carries no terminal
    // at all, so every booking persisted null at book time — 0 of 86 production
    // segments had one — and every screen that was already written to show
    // "Terminal 3" had nothing to show. TripDetails is the only source, which
    // makes this sync the one place that can fill them.
    //
    // Normalised on the way in, because the provider is not consistent about it:
    // most legs come back as "3", but Bangkok and Jakarta return "T3". Stored
    // verbatim, the column would hold both conventions and the display layer
    // would render "Terminal T3" for some airports and "Terminal 3" for others.
    // The column holds the bare terminal; the "T" belongs to the view.
    originTerminal: terminalOf(r?.DepartureTerminal),
    destinationTerminal: terminalOf(r?.ArrivalTerminal),
    departureDateTime: toDate(r?.DepartureDateTime),
    arrivalDateTime: toDate(r?.ArrivalDateTime),
    cabin: String(r?.CabinClass ?? '').trim() || null,
  });
  }).filter((s) => s.flightNumber && s.originAirport && s.destinationAirport);
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

    // segmentOrder is not always distinct — FMVTT9ZQ carries 0 on both rows — so
    // ordering by it alone returns an arbitrary sequence and positional pairing
    // becomes a coin toss. Break the tie on departure so the order is at least
    // deterministic, then prefer matching on route below.
    const stored = await prisma.bookingSegment.findMany({
      where: { bookingId },
      orderBy: [{ segmentOrder: 'asc' }, { departureDateTime: 'asc' }],
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

    // Pair on route where the two sides describe the same set of legs — a
    // reissue usually moves the dates and leaves the routing alone, and route
    // matching is immune to the ordering problem above. Positional pairing is
    // the fallback, for a genuine re-routing.
    const pairs = pairByRoute(stored, providerSegs)
      ?? stored.map((s, i) => [s, providerSegs[i]] as const);

    const diffs: SegmentDiff[] = [];
    for (const [s, p] of pairs) {
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

      // Terminals are filled, not reconciled. Book time has none to disagree
      // with, so writing one is new information rather than drift — counting it
      // as a diff would raise "the airline changed your itinerary" on every
      // booking that ever syncs, which trains people to ignore the message that
      // matters. A terminal that CHANGES is real and is reported.
      for (const [field, provided, hold] of [
        ['originTerminal', p.originTerminal, s.originTerminal],
        ['destinationTerminal', p.destinationTerminal, s.destinationTerminal],
      ] as const) {
        if (!provided || provided === hold) continue;
        data[field] = provided;
        if (hold) diffs.push({ segmentOrder: s.segmentOrder, field, from: hold, to: provided });
      }

      if (Object.keys(data).length > 0) {
        await prisma.bookingSegment.update({ where: { id: s.id }, data });
      }
    }

    // Journeys and the booking row carry their own copies of origin/destination
    // and departure for list views, and they can be stale even when every
    // segment already matches the provider — an earlier partial repair fixed
    // FMVTT9ZQ's segments and left the booking still showing the flight the
    // reissue replaced. So reconcile them before the no-diff early return, not
    // after it.
    await syncJourneys(bookingId, providerSegs);

    if (diffs.length === 0) return { applied: true, changed: 0, diffs: [] };

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

/**
 * Terminals per leg, keyed by route, straight from a TripDetails payload.
 *
 * Used at BOOK time, where there is no stored booking to pair against yet — the
 * book route already fetches TripDetails to verify the provider actually holds
 * the booking, so the terminals come free from a call that is already made. The
 * caller matches them onto the segments it is about to persist.
 */
export function collectSegmentTerminals(trip: any): Array<{
  origin: string;
  destination: string;
  originTerminal: string | null;
  destinationTerminal: string | null;
}> {
  return mapProviderSegments(trip)
    .filter((p) => p.originTerminal || p.destinationTerminal)
    .map((p) => ({
      origin: p.originAirport,
      destination: p.destinationAirport,
      originTerminal: p.originTerminal,
      destinationTerminal: p.destinationTerminal,
    }));
}

/**
 * Fill in terminals from TripDetails.
 *
 * Separate from the full sync because the full sync only runs after a REISSUE,
 * and terminals are missing on every booking, not just reissued ones. Mystifly's
 * search response carries no terminal field at all, so book time has nothing to
 * persist — 0 of 86 production segments had one — while TripDetails returns
 * DepartureTerminal / ArrivalTerminal for every leg. The confirmation page, the
 * itinerary email and both consoles were already written to print "Terminal 3";
 * they simply never had it.
 *
 * Enrichment only: it writes terminals and nothing else, raises no drift, and
 * refuses to touch anything when the segment counts disagree — a restructured
 * trip is the full sync's problem, and guessing here would put one leg's
 * terminal on another.
 *
 * Safe on every poll: a provider that returns no terminal writes nothing, and a
 * stored value is never overwritten with a blank.
 */
export async function backfillTerminalsFromTripDetails(
  bookingId: string,
  mfRef: string,
  trip: any,
): Promise<number> {
  try {
    const providerSegs = mapProviderSegments(trip);
    if (!providerSegs.some((p) => p.originTerminal || p.destinationTerminal)) return 0;

    const stored = await prisma.bookingSegment.findMany({
      where: { bookingId },
      orderBy: [{ segmentOrder: 'asc' }, { departureDateTime: 'asc' }],
    });
    if (stored.length === 0 || stored.length !== providerSegs.length) return 0;

    const pairs = pairByRoute(stored, providerSegs);
    if (!pairs) return 0;   // re-routed — pairing by position would misassign terminals

    let filled = 0;
    for (const [s, p] of pairs) {
      const data: Record<string, string> = {};
      if (p.originTerminal && p.originTerminal !== s.originTerminal) data.originTerminal = p.originTerminal;
      if (p.destinationTerminal && p.destinationTerminal !== s.destinationTerminal) data.destinationTerminal = p.destinationTerminal;
      if (Object.keys(data).length === 0) continue;
      await prisma.bookingSegment.update({ where: { id: s.id }, data });
      filled += Object.keys(data).length;
    }

    if (filled > 0) console.log(`[itinerary-sync] ${mfRef}: filled ${filled} terminal field(s).`);
    return filled;
  } catch (err) {
    // Terminals are supplemental. Failing to get them must never disturb the
    // ticketing poll this runs inside.
    console.warn(`[itinerary-sync] terminal backfill failed for ${mfRef}: ${(err as Error).message}`);
    return 0;
  }
}

/**
 * Match provider segments to stored ones by route.
 *
 * Returns null when the two sides do not describe the same multiset of legs —
 * i.e. the trip really was re-routed — leaving the caller to fall back to
 * position.
 */
export function pairByRoute(
  stored: any[],
  provider: ProviderSegment[],
): Array<readonly [any, ProviderSegment]> | null {
  const key = (o: string, d: string) => `${o}->${d}`;
  const pool = new Map<string, any[]>();
  for (const s of stored) {
    const k = key(s.originAirport, s.destinationAirport);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k)!.push(s);
  }

  const pairs: Array<readonly [any, ProviderSegment]> = [];
  for (const p of provider) {
    const bucket = pool.get(key(p.originAirport, p.destinationAirport));
    if (!bucket || bucket.length === 0) return null;   // route not present — re-routed
    pairs.push([bucket.shift()!, p] as const);
  }
  // Every stored segment must have been consumed, or the sides disagree.
  for (const remaining of pool.values()) if (remaining.length > 0) return null;
  return pairs;
}

/**
 * Keep journey- and booking-level times aligned with their segments.
 *
 * The booking-level `departureDate` is what every list screen, email and search
 * filter reads. Without this, a completed reissue moved the segments and left
 * the booking still advertising the flight it replaced — FMVTT9ZQ showed
 * 14 Nov after being reissued to 2 Dec.
 */
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

  const outbound = journeys.find((j) => j.direction === 'OUTBOUND') ?? journeys[0];
  const inbound = journeys.find((j) => j.direction === 'RETURN');
  const departureDate = outbound?.segments[0]?.departureDateTime ?? null;
  const returnDate = inbound?.segments[0]?.departureDateTime ?? null;

  if (departureDate) {
    await prisma.masterBooking.update({
      where: { id: bookingId },
      data: { departureDate, ...(returnDate ? { returnDate } : {}) },
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
