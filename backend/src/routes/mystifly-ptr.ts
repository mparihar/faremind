/**
 * Mystifly Post-Ticketing Request (PTR) Routes
 *
 * Endpoints:
 *   POST /api/mystifly-ptr/void-quote     — Get void quote
 *   POST /api/mystifly-ptr/void           — Execute void
 *   POST /api/mystifly-ptr/refund-quote   — Get refund quote
 *   POST /api/mystifly-ptr/refund         — Execute refund
 *   POST /api/mystifly-ptr/reissue-quote  — Get reissue quote
 *   POST /api/mystifly-ptr/reissue        — Execute reissue
 *   POST /api/mystifly-ptr/status         — Check PTR status
 *   POST /api/mystifly-ptr/mark-read      — Mark PTR as read
 *
 * IDENTIFIERS
 * Every endpoint takes `{ reference, airlinePnr }` — the FareMind reference and
 * the airline's record locator, the only two codes a person actually holds. The
 * Mystifly reference is resolved from them internally (resolveServicingRef) and
 * never has to be typed. `uniqueId` is still accepted so older callers keep
 * working, but it is treated as "any reference", not as an MFRef.
 */

import { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import * as mystifly from '../services/mystifly';
import { resolveBookingByAnyReference } from '../lib/booking-lookup';
import type { PtrType } from '../services/mystifly';
import { prisma } from '../lib/db';
import { buildPtrPassengers, type PtrPassenger } from '../lib/ptr-passengers';
import { backfillEticketsFromTripDetails } from '../lib/eticket-backfill';
import { getAdminServiceFee } from '../services/cancellation-orchestrator';
import { initiateReissue } from '../services/reissue-orchestrator';
import { toUsd } from '../services/fx';
import * as mbq from '../lib/manage-booking-queries';
import { summariseCoupons, couponSummaryLabel } from '../services/coupon-eligibility';
import { reconcilePtrQuoteById } from '../workers/ptr-quote-reconciliation';
import { getPtrPollFrequencyMs } from '../lib/ptr-poll-config';
import { buildPtrRefundRef } from '../lib/ptr-refund-ref';
import { ptrIdFromInProcessMessage } from '../lib/ptr-in-process';
import { buildRefundDetails, ticketNumbersByType } from '../lib/refund-details';
import { extractEticketsByPassenger, matchProviderEticket } from '../lib/eticket-backfill';
import { fireNotification } from '../lib/notify';
import { reverseCommission } from '../lib/finance/agent-commission-ledger';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { typescript: true });

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

/**
 * Load the PTR passengers array for a Mystifly booking. Mystifly requires it on
 * every PTR request. Resolves the booking by Mystifly UniqueID (MFRef) or the
 * provided FareMind booking id/reference, then maps passengers + e-tickets.
 */
async function loadPtrPassengers(
  uniqueId: string,
  bookingId?: string,
  opts: { forceRefresh?: boolean } = {},
): Promise<PtrPassenger[]> {
  try {
    const booking = await prisma.masterBooking.findFirst({
      where: {
        OR: [
          { mystiflyMfRef: uniqueId },
          { providerOrderId: uniqueId },
          { masterPnr: uniqueId },
          { pnrs: { some: { providerOrderId: uniqueId } } },
          ...(bookingId ? [{ id: bookingId }, { masterBookingReference: bookingId }] : []),
        ],
      },
      include: {
        passengers: { orderBy: { passengerOrder: 'asc' } },
        // Ordered so ticket selection is deterministic across calls.
        tickets: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!booking) return [];

    // Bookings can reach a PTR with no e-ticket persisted yet (ticketing resolved
    // asynchronously). Mystifly rejects any PTR whose passengers lack an e-ticket, so
    // pull the numbers from TripDetails first — same guard the cancellation path uses.
    // forceRefresh additionally re-reads numbers we already hold, for when the provider
    // has told us the stored one is wrong.
    const mfRef = booking.mystiflyMfRef || booking.providerOrderId || booking.masterPnr;
    const hasEticket = booking.tickets.some((t: any) => t.eTicketNumber || t.ticketNumber);
    if ((!hasEticket || opts.forceRefresh) && mfRef) {
      try {
        const r = await backfillEticketsFromTripDetails(booking.id, mfRef, { force: !!opts.forceRefresh });
        if (r.updated > 0) {
          const reloaded = await prisma.masterBooking.findUnique({
            where: { id: booking.id },
            include: {
              passengers: { orderBy: { passengerOrder: 'asc' } },
              tickets: { orderBy: { createdAt: 'asc' } },
            },
          });
          if (reloaded) return applyTicketedTitles(buildPtrPassengers(reloaded), mfRef);
        }
      } catch (e) {
        console.warn(`[PTR] eTicket backfill failed for ${mfRef}:`, (e as Error).message);
      }
    }

    return applyTicketedTitles(buildPtrPassengers(booking), mfRef);
  } catch {
    return [];
  }
}

/**
 * Replace each derived title with the one the coupon was ticketed under.
 *
 * We derive a title from gender and passenger type, which is right at book time.
 * The airline may then rewrite it — Air India stores an infant's Miss as MS —
 * and from that moment the derived title no longer matches the ticket. Reissue
 * checks it and refuses: "Passenger details are not matching for this ticket
 * number = TKT529625". Sending back exactly what is on the ticket clears it.
 *
 * Best-effort: if TripDetails cannot be read, or names a passenger we cannot
 * match, that passenger keeps the derived title and the provider's own error
 * stands rather than a guess being sent.
 */
async function applyTicketedTitles(
  passengers: PtrPassenger[],
  mfRef?: string | null,
): Promise<PtrPassenger[]> {
  if (!mfRef || passengers.length === 0) return passengers;
  try {
    const trip = await mystifly.getTripDetailsResilient(mfRef);
    const ticketed = extractEticketsByPassenger(trip);
    if (ticketed.length === 0) return passengers;

    return passengers.map((p) => {
      const match = matchProviderEticket(
        { firstName: p.firstName, lastName: p.lastName, passengerType: p.passengerType },
        ticketed,
      );
      return match?.title ? { ...p, title: match.title } : p;
    });
  } catch {
    return passengers;
  }
}

/**
 * Build the `originDestinations` array required by a Mystifly ReIssueQuote.
 *
 * Mystifly's PostTicketingRequest contract has NO fare-source-code reissue —
 * `reissueQuoteRequestType` is only None|OND|Segment — so a reissue is always
 * expressed as origin/destination/date. Callers that want a genuine flight
 * change pass their own array; when they don't, we re-quote the itinerary the
 * booking already has (one OND per journey: first segment's origin → last
 * segment's destination). Omitting the array makes Mystifly 500.
 */
async function loadPtrOriginDestinations(
  uniqueId: string,
  bookingId?: string,
): Promise<mystifly.MystiflyReissueOriginDestination[]> {
  try {
    const booking = await prisma.masterBooking.findFirst({
      where: {
        OR: [
          { mystiflyMfRef: uniqueId },
          { providerOrderId: uniqueId },
          { masterPnr: uniqueId },
          { pnrs: { some: { providerOrderId: uniqueId } } },
          ...(bookingId ? [{ id: bookingId }, { masterBookingReference: bookingId }] : []),
        ],
      },
      include: {
        journeys: {
          orderBy: { journeyOrder: 'asc' },
          include: { segments: { orderBy: { segmentOrder: 'asc' }, take: 1 } },
        },
      },
    });
    if (!booking) return [];

    // Journey-level origin/destination/departure are non-nullable, so they are the
    // reliable source; the first segment is read only for its cabin.
    return booking.journeys.map((j: any) => ({
      originLocationCode: j.originAirport,
      destinationLocationCode: j.destinationAirport,
      // Date at midnight, per Mystifly's ReissueQuoteRQ contract — a wall-clock time
      // would narrow the search instead of returning the whole day's options.
      departureDateTime: `${new Date(j.departureDateTime).toISOString().slice(0, 10)}T00:00:00`,
      cabinPreference: mystifly.toCabinType(j.segments[0]?.cabin || j.cabinSummary || 'economy'),
    }));
  } catch {
    return [];
  }
}

/** Resolve the MasterBooking (id + status) for a PTR by MFRef or FareMind id/ref. */
async function resolvePtrBooking(uniqueId: string, bookingId?: string) {
  return prisma.masterBooking.findFirst({
    where: {
      OR: [
        { mystiflyMfRef: uniqueId },
        { providerOrderId: uniqueId },
        { masterPnr: uniqueId },
        { pnrs: { some: { providerOrderId: uniqueId } } },
        ...(bookingId ? [{ id: bookingId }, { masterBookingReference: bookingId }] : []),
      ],
    },
    select: { id: true, masterBookingReference: true, agentUserId: true, ticketingStatus: true, bookingStatus: true },
  });
}

function extractPtrError(result: any): { hasError: boolean; message: string; code: string } {
  // 1. Structured Mystifly error object (Data.Error / Error with ErrorCode).
  const err = result?.Data?.Error || result?.Error;
  if (err?.ErrorCode && err.ErrorCode !== '0') {
    return { hasError: true, message: err.ErrorMessage || 'PTR request failed', code: err.ErrorCode };
  }
  // 2. Array-style errors (Data.Errors[] / Errors[]).
  const errArr = result?.Data?.Errors || result?.Errors;
  if (Array.isArray(errArr) && errArr.length > 0) {
    const e0 = errArr[0] || {};
    return { hasError: true, message: e0.Message || e0.ErrorMessage || 'PTR request failed', code: e0.Code || e0.ErrorCode || 'UNKNOWN' };
  }
  // 3. Envelope-level failure: Success === false with a Message. This is how a
  //    provider 500 (e.g. "The remote server returned an error: (500) …") arrives
  //    when Mystifly wraps it in an HTTP 200 body — must NOT be treated as a quote.
  if (result && result.Success === false) {
    const msg: string = result.Message || 'The airline system returned an error for this request.';
    const isTransient = /\(5\d\d\)|internal server error|timeout|temporarily/i.test(msg);
    return {
      hasError: true,
      message: isTransient
        ? `The airline system is temporarily unavailable (${msg}). Please retry in a moment; if it persists, use Force Cancel + Refund or contact support.`
        : msg,
      code: isTransient ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR',
    };
  }
  return { hasError: false, message: '', code: '' };
}

/**
 * Has the airline actually priced this quote yet?
 *
 * A void/refund quote returns immediately, but the numbers do not: the first
 * response carries PTRStatus=InProcess and Resolution=QuoteRequested with an
 * empty quotes array, and the amounts arrive later (Resolution=QuoteUpdated,
 * PTRStatus=Completed — the shape the ReIssueQuote PTRs on the same booking
 * show). Treating that empty array as zero turned "not answered" into "nothing
 * back", on a fare the airline had said was refundable.
 */
function isQuoteUnanswered(quotes: any[]): boolean {
  // The presence of priced rows is the whole test. PTRStatus/Resolution only
  // explain why they are missing, so checking them as well would be decoration.
  return !Array.isArray(quotes) || quotes.length === 0;
}

/**
 * Does this provider message mean the e-ticket we sent is not the one the airline holds?
 * Mystifly phrases it "Eticket number is wrong"; keep the match loose enough to catch
 * the neighbouring wordings without swallowing unrelated ticket errors.
 */
function isStaleEticketError(message: string): boolean {
  return /e-?ticket\s*(number)?\s*(is)?\s*(wrong|invalid|incorrect|not\s*valid)/i.test(message)
    || /invalid\s+e-?ticket/i.test(message);
}

/**
 * Run a PTR call, and if the provider rejects the e-ticket we sent, refresh the stored
 * numbers from the provider and try once more.
 *
 * A stored e-ticket goes stale whenever the airline replaces it — most obviously after a
 * successful reissue. The normal backfill only fills blanks, so without this a booking
 * that has been reissued once can never be voided, refunded or reissued again: every
 * later PTR is rejected with a number we keep re-sending. One retry against freshly-read
 * numbers costs nothing on the happy path, since it only runs after a rejection.
 */
async function withEticketRetry<T>(
  uniqueId: string,
  bookingId: string | undefined,
  run: (passengers: PtrPassenger[]) => Promise<T>,
): Promise<{ result: T; retried: boolean }> {
  const passengers = await loadPtrPassengers(uniqueId, bookingId);
  const result = await run(passengers);

  const { hasError, message } = extractPtrError(result);
  if (!hasError || !isStaleEticketError(message)) return { result, retried: false };

  console.warn(`[PTR] ${uniqueId}: provider rejected the stored e-ticket ("${message}") — refreshing and retrying once.`);
  const refreshed = await loadPtrPassengers(uniqueId, bookingId, { forceRefresh: true });

  const before = passengers.map((p) => p.eTicket).join(',');
  const after = refreshed.map((p) => p.eTicket).join(',');
  if (!after || after === before) {
    // Nothing new to send — return the original rejection rather than burn a second call.
    console.warn(`[PTR] ${uniqueId}: refresh produced no different e-ticket; keeping the original error.`);
    return { result, retried: false };
  }

  console.log(`[PTR] ${uniqueId}: e-ticket refreshed, retrying the request.`);
  return { result: await run(refreshed), retried: true };
}

/**
 * Ask the provider whether this booking's coupons still permit servicing.
 *
 * CouponStatus tags each segment with the airline's own verdict — a coupon that is not
 * OPEN is "NOT valid for REFUND/VOID and REISSUE". This is returned as advice, not
 * enforcement: the Mystifly demo environment reports every coupon as N/A, so blocking on
 * it there would stop all servicing. Set PTR_ENFORCE_COUPON_STATUS=true to make it a
 * hard gate once the environment reports real coupon states.
 */
async function couponServicingAdvice(uniqueId: string): Promise<{
  checked: boolean; eligible: boolean; warnings: string[]; openSegments: number; totalSegments: number;
  closedSegments: number; unknownSegments: number; unreported: boolean; summary: string;
}> {
  const silent = {
    checked: false, eligible: true, warnings: [] as string[], openSegments: 0, totalSegments: 0,
    closedSegments: 0, unknownSegments: 0, unreported: false,
    summary: 'No coupon information has been issued for this booking yet.',
  };
  try {
    const { tickets } = await mystifly.getCouponStatus(uniqueId);
    const segs = tickets.flatMap((t) => t.segments);
    if (segs.length === 0) return silent;
    const s = summariseCoupons(segs);
    // A warning the provider attaches to an UNREPORTED coupon is describing the
    // absence of data, not a refusal — surfacing it as a blocking warning is
    // what made an unpriced refund look forbidden. Keep warnings only where the
    // airline actually reported a closed coupon.
    const warnings = s.closed > 0
      ? Array.from(new Set(segs.map((x) => x.warning).filter((w): w is string => !!w)))
      : [];
    return {
      checked: true,
      eligible: s.eligible,
      warnings,
      openSegments: s.open,
      totalSegments: s.total,
      closedSegments: s.closed,
      unknownSegments: s.unknown,
      unreported: s.unreported,
      summary: couponSummaryLabel(s),
    };
  } catch (e) {
    // Never let an advisory check block a servicing request.
    console.warn(`[PTR] coupon-status advice failed for ${uniqueId}:`, (e as Error).message);
    return silent;
  }
}

const ENFORCE_COUPON_STATUS = process.env.PTR_ENFORCE_COUPON_STATUS === 'true';

/**
 * Resolve a MasterBooking id from any reference a caller might hold.
 *
 * Previously matched only the cuid or the FareMind reference, so a servicing
 * request carrying an AIRLINE PNR — the code a customer actually reads off a
 * boarding pass — silently failed to link. Now accepts the FareMind reference,
 * the airline PNR, Mystifly's reference and the internal id.
 *
 * The provider call itself still uses Mystifly's reference; see
 * lib/booking-lookup.ts, which performs that mapping.
 */
async function resolveMasterBookingId(input?: string): Promise<string | null> {
  if (!input) return null;
  const found = await resolveBookingByAnyReference(input);
  return found?.bookingId ?? null;
}

/** The identifiers one servicing request needs, resolved once at the top. */
interface ServicingRef {
  /** Mystifly's reference. Internal only — resolved, never asked for. */
  mfRef: string;
  /** MasterBooking.id, null when the MFRef matched no booking of ours. */
  bookingId: string | null;
  fareMindRef: string | null;
  airlinePnr: string | null;
}

/** `ref` present means resolved; otherwise the route replies with the failure. */
interface ServicingRefResult {
  ref?: ServicingRef;
  status?: number;
  error?: string;
  errorCode?: string;
}

/** `MF` + digits is Mystifly's shape — used to classify input, never to display. */
function looksLikeMystiflyRef(v: string): boolean {
  return /^MF\d+$/i.test(v);
}

/**
 * The identifiers a response may echo: ours and the airline's. The provider
 * reference is deliberately absent — echoing it would put back on screen the
 * code this whole path exists to keep off it.
 */
function publicRef(ref: ServicingRef) {
  return { bookingId: ref.bookingId, fareMindRef: ref.fareMindRef, airlinePnr: ref.airlinePnr };
}

/**
 * Resolve a servicing request to the provider reference the Mystifly APIs need.
 *
 * Servicing is searched by exactly two codes, and the Mystifly reference is not
 * one of them:
 *
 *   reference    FM9IPA4E    the FareMind reference
 *   airlinePnr   EOROKA      the airline's record locator
 *
 * Either finds the booking; both together are cross-checked. The provider
 * reference is then read off the booking we found and used for the call — that
 * mapping is the whole point, and accepting an MF code as a search term would
 * quietly put it back into circulation as something staff are expected to hold.
 * So an MF-shaped input is refused with an explanation rather than resolved.
 *
 * `uniqueId` / `bookingId` remain accepted as aliases of `reference` for older
 * callers, under the same rule.
 */
export async function resolveServicingRef(body: {
  reference?: string; airlinePnr?: string; uniqueId?: string; bookingId?: string;
}): Promise<ServicingRefResult> {
  const clean = (v: unknown) => String(v ?? '').trim();
  const reference = clean(body.reference);
  const airlinePnr = clean(body.airlinePnr);
  const legacy = [clean(body.uniqueId), clean(body.bookingId)].filter(Boolean);

  const candidates = [reference, airlinePnr, ...legacy].filter(Boolean);
  if (candidates.length === 0) {
    return {
      status: 400, errorCode: 'MISSING_REFERENCE',
      error: 'Enter the FareMind reference or the airline PNR.',
    };
  }

  // The Mystifly reference is not a search field here.
  const mfShaped = candidates.find(looksLikeMystiflyRef);
  if (mfShaped) {
    return {
      status: 400, errorCode: 'MYSTIFLY_REF_NOT_SEARCHABLE',
      error: `"${mfShaped}" is the Mystifly reference, which is not a search field. Search by the FareMind reference (FM…) or the airline PNR from the ticket; the provider reference is resolved from those.`,
    };
  }

  // Both supplied: they must agree before anything touches the provider.
  if (reference && airlinePnr) {
    const [a, b] = await Promise.all([
      resolveBookingByAnyReference(reference),
      resolveBookingByAnyReference(airlinePnr),
    ]);
    if (a && b && a.bookingId !== b.bookingId) {
      return {
        status: 409, errorCode: 'REFERENCE_MISMATCH',
        error: `"${reference}" and airline PNR "${airlinePnr}" belong to different bookings. Clear one of the two and search again.`,
      };
    }
  }

  for (const input of candidates) {
    const found = await resolveBookingByAnyReference(input);
    if (!found) continue;
    if (!found.mystiflyRef) {
      return {
        status: 422, errorCode: 'NO_PROVIDER_REFERENCE',
        error: `Booking ${found.masterBookingReference} carries no provider reference, so it cannot be serviced through Post-Ticketing Requests.`,
      };
    }
    return {
      ref: {
        mfRef: found.mystiflyRef,
        bookingId: found.bookingId,
        fareMindRef: found.masterBookingReference,
        airlinePnr: found.airlinePnr,
      },
    };
  }

  return {
    status: 404, errorCode: 'BOOKING_NOT_FOUND',
    error: `No booking found for "${candidates[0]}". Check the FareMind reference (FM…) or the airline PNR from the ticket.`,
  };
}

async function createPtrRecord(params: {
  bookingId: string;
  providerUniqueId: string;
  requestType: string;
  requestedBy: string;
  requestedByRole?: string;
  notes?: string;
}) {
  // The caller may pass a booking reference (e.g. FM5GQXHT) OR the MasterBooking id.
  // postTicketingRequest.bookingId is an FK to MasterBooking.id, so resolve first —
  // otherwise a reference triggers a foreign-key constraint violation. If it can't be
  // resolved, skip DB linkage (bookingId is optional tracking) rather than crash.
  const resolvedId = await resolveMasterBookingId(params.bookingId);
  if (!resolvedId) {
    console.warn(`[PTR] createPtrRecord: no MasterBooking found for "${params.bookingId}" — skipping PTR tracking record.`);
    return null;
  }
  return prisma.postTicketingRequest.create({
    data: {
      bookingId: resolvedId,
      provider: 'MYSTIFLY',
      providerUniqueId: params.providerUniqueId,
      requestType: params.requestType as any,
      status: 'QUOTE_PENDING',
      requestedBy: params.requestedBy,
      requestedByRole: params.requestedByRole || 'AGENT',
      notes: params.notes || null,
    },
  });
}

async function updatePtrRecord(id: string, data: Record<string, any>) {
  return prisma.postTicketingRequest.update({
    where: { id },
    data,
  });
}

/**
 * Apply a submitted provider VOID or REFUND to the booking.
 *
 * Void and refund are two routes to the same outcome and differ only in eligibility and
 * amount, so they must leave the booking in the same shape:
 *   VOID   — only inside the airline's void window (~24h after ticketing); the full
 *            captured amount comes back, no airline penalty.
 *   REFUND — the path once the void window has closed; the airline's *quoted* refund
 *            comes back, less the FareMind service fee.
 * Both cancel the booking, mark the tickets, refund the customer's card, record a
 * BookingRefund, release any agent wallet hold, and escalate loudly if the card refund
 * fails (a silent failure leaves the ticket dead and the customer charged).
 */
async function applyCancellationToBooking(params: {
  kind: 'VOID' | 'REFUND';
  uniqueId: string;
  bookingId?: string;
  providerPtrId?: number | null;
  ptrStatus: string;
  quotedRefundAmount?: number | null;
  requestedBy?: string;
}): Promise<Record<string, unknown>> {
  const { kind, uniqueId, bookingId, providerPtrId, ptrStatus, requestedBy } = params;
  const isVoid = kind === 'VOID';
  let customerRefund: Record<string, unknown> = { issued: false, reason: 'not attempted' };

  try {
    const bk = await resolvePtrBooking(uniqueId, bookingId);
    if (!bk) return { issued: false, reason: 'Booking not found for this reference.' };

    const full = await prisma.masterBooking.findUnique({
      where: { id: bk.id },
      // Widened for the void/refund notification: without the customer and
      // route these emails cannot be addressed or made meaningful.
      select: { serviceFeeAmount: true, totalAmount: true, currency: true, paymentStatus: true, agentUserId: true, masterBookingReference: true,
        customerEmail: true, customerName: true, airlinePnr: true, masterPnr: true,
        originAirport: true, destinationAirport: true, agentEmail: true, agentName: true,
        passengers: { select: { id: true } } },
    });

    // Only a void changes ticketingStatus — MbTicketingStatus has no refund member, so a
    // refund leaves the ticket issued and is tracked on the ticket rows + BookingRefund.
    await prisma.masterBooking.update({
      where: { id: bk.id },
      data: {
        bookingStatus: 'CANCELLED',
        providerBookingStatus: ptrStatus,
        ...(isVoid ? { ticketingStatus: 'VOIDED' as const } : {}),
      },
    });
    await prisma.bookingTicket.updateMany({ where: { bookingId: bk.id }, data: { ticketStatus: isVoid ? 'VOIDED' : 'REFUNDED' } }).catch(() => {});
    await prisma.bookingPnr.updateMany({ where: { bookingId: bk.id }, data: { status: 'CANCELLED' } }).catch(() => {});
    await prisma.bookingJourney.updateMany({ where: { bookingId: bk.id }, data: { journeyStatus: 'cancelled' } }).catch(() => {});
    await prisma.bookingSegment.updateMany({ where: { bookingId: bk.id }, data: { segmentStatus: 'cancelled' } }).catch(() => {});

    // Amount owed back to the customer.
    const payment = await prisma.bookingPayment.findFirst({ where: { bookingId: bk.id, status: 'SUCCEEDED' }, orderBy: { paidAt: 'desc' } });
    const paid = payment ? Number(payment.amount) : 0;
    let adminFee = 0;
    let owed = paid;
    if (!isVoid) {
      const quoted = params.quotedRefundAmount != null ? Number(params.quotedRefundAmount) : 0;
      adminFee = await getAdminServiceFee(full);
      owed = Math.max(0, Math.round((quoted - adminFee) * 100) / 100);
    }

    await prisma.bookingEvent.create({
      data: {
        bookingId: bk.id,
        eventType: isVoid ? 'BOOKING_VOIDED' : 'BOOKING_REFUNDED',
        eventTitle: isVoid ? 'Ticket Voided' : 'Ticket Refunded',
        eventDescription: isVoid
          ? `Ticket voided via provider${providerPtrId ? ` (PTR ${providerPtrId})` : ''}. Provider status: ${ptrStatus}. The void returns the full amount within the void window. Requested by ${requestedBy || 'staff'}.`
          : `Refund submitted to the provider${providerPtrId ? ` (PTR ${providerPtrId})` : ''}. Provider status: ${ptrStatus}. Airline refund ${Number(params.quotedRefundAmount ?? 0).toFixed(2)} less service fee ${adminFee.toFixed(2)} = ${owed.toFixed(2)} to the customer. Requested by ${requestedBy || 'staff'}.`,
        actorType: 'agent',
        actorName: requestedBy || 'staff',
        payloadJson: { providerPtrId, ptrStatus, uniqueId, kind, quoted: params.quotedRefundAmount ?? null, adminFee, owed },
      },
    }).catch(() => {});

    // Refund the card. Idempotent via the Stripe key + the already-REFUNDED guard.
    try {
      if (full?.paymentStatus === 'REFUNDED') {
        customerRefund = { issued: false, reason: 'Booking is already marked REFUNDED.', alreadyRefunded: true };
      } else if (!payment?.stripePaymentIntentId) {
        customerRefund = { issued: false, reason: 'No captured payment with a Stripe PaymentIntent was found for this booking.' };
      } else if (owed <= 0) {
        customerRefund = { issued: false, reason: `Nothing refundable after the airline penalty and service fee (${adminFee.toFixed(2)}).`, adminFee };
      } else {
        const stripeRefund = await stripe.refunds.create(
          { payment_intent: payment.stripePaymentIntentId, amount: Math.round(owed * 100), reason: 'requested_by_customer', metadata: { booking_ref: bk.masterBookingReference, action: isVoid ? 'ptr_void' : 'ptr_refund' } },
          { idempotencyKey: `ptr${isVoid ? 'void' : 'refund'}-refund-${bk.id}` },
        );
        await prisma.masterBooking.update({
          where: { id: bk.id },
          data: { paymentStatus: owed >= paid - 0.01 ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
        });

        // Money has left our account for the customer's card. Nobody was told.
        //
        // A void or refund raised by staff moved real money and produced no
        // email at all — the customer found out from their statement, the agent
        // kept commission on a trip that no longer exists, and support learned
        // about it when the customer phoned. Fired here, at the point the refund
        // is actually accepted, rather than when the PTR was merely requested.
        await reverseCommission({
          bookingId: bk.id,
          reason: isVoid ? 'Booking voided' : 'Booking refunded',
        }).catch((e) => console.warn(`[PTR] commission reversal failed for ${bk.id}: ${e.message}`));

        await fireNotification({
          event_type: (isVoid ? 'BOOKING_VOIDED' : 'REFUND_ISSUED') as any,
          booking_id: bk.id,
          customer_email: full?.customerEmail ?? undefined,
          data: {
            customer_name: full?.customerName?.split(' ')[0] || 'Traveler',
            booking_reference: bk.masterBookingReference,
            airline_pnr: full?.airlinePnr ?? null,
            mystifly_ref: uniqueId ?? full?.masterPnr ?? null,   // internal recipients only
            route: `${full?.originAirport ?? ''} → ${full?.destinationAirport ?? ''}`,
            refund_amount: `${full?.currency ?? 'USD'} ${owed.toFixed(2)}`,
            refund_reference: stripeRefund.id,
            service_fee_retained: adminFee > 0 ? adminFee.toFixed(2) : null,
            agent_email: full?.agentEmail ?? null,
            agent_name: full?.agentName ?? null,
            requested_by: requestedBy || 'staff',
          },
        }).catch((e) => console.warn(`[PTR] notification failed for ${bk.id}: ${e.message}`));
        // The customer's card refund is done; the AIRLINE side is not. Mystifly
        // answers Void/Refund synchronously with PTRStatus=InProcess and settles
        // in its back office, so the only proof the ticket was actually voided
        // or refunded is Resolution=Voided/Refunded on a later
        // Search/PostTicketingRequest.
        //
        // refund-reconciliation-cron already makes that call, via
        // getProviderRefundStatus -> searchPtr. It selects on
        // (providerReimbursementStatus IN PENDING|PROCESSING, nextProviderStatusCheckAt <= now),
        // and this row previously set neither — status defaulted to NOT_STARTED
        // and the timestamp stayed NULL, which a SQL `<=` drops. Two independent
        // reasons the record was never picked up, so every void and refund was
        // submitted and never confirmed. A provider REJECTION after submission
        // would have gone unseen with the customer already refunded.
        //
        // providerRefundRequestId encodes the type and PTR id in the shape the
        // adapter parses back out (mystifly_void_{mfRef}_{ptrId}); providerPnr
        // carries the MF ref it searches on. Without both, the poll would run
        // with ptrId 0 and an empty reference.
        const ptrRefundRef = buildPtrRefundRef(kind, uniqueId, providerPtrId);
        const canVerify = ptrRefundRef !== null;
        await prisma.bookingRefund.create({
          data: {
            bookingId: bk.id,
            amount: owed,
            currency: payment.currency || 'USD',
            method: 'ORIGINAL_PAYMENT',
            status: 'COMPLETED',              // the customer has their money back
            stripeRefundId: stripeRefund.id,
            provider: 'MYSTIFLY',
            providerPnr: uniqueId,
            providerBookingReference: uniqueId,
            providerRefundRequestId: ptrRefundRef,
            providerExpectedReimbursementAmount: params.quotedRefundAmount ?? null,
            fareMindCancellationFee: adminFee,
            customerRefundStatus: 'CUSTOMER_REFUNDED',
            // Only chase a PTR that exists. An unticketed void or a no-refund
            // cancellation has none, and leaving those NOT_STARTED keeps the
            // cron off records it could never resolve.
            providerReimbursementStatus: canVerify ? 'PENDING' : 'NOT_STARTED',
            nextProviderStatusCheckAt: canVerify
              ? new Date(Date.now() + (await getPtrPollFrequencyMs()))
              : null,
          },
        }).catch((be: any) => console.error('[PTR] bookingRefund record failed:', be?.message));
        await prisma.bookingEvent.create({
          data: {
            bookingId: bk.id, eventType: 'CUSTOMER_REFUNDED', eventTitle: 'Refund Issued',
            eventDescription: `Refund of ${owed.toFixed(2)} ${payment.currency || 'USD'} issued to the original card on ${isVoid ? 'void' : 'refund'}. Stripe refund ${stripeRefund.id}.`,
            actorType: 'system', actorName: isVoid ? 'PTR Void' : 'PTR Refund', payloadJson: { stripeRefundId: stripeRefund.id, amount: owed },
          },
        }).catch(() => {});
        customerRefund = { issued: true, amount: owed, currency: payment.currency || 'USD', stripeRefundId: stripeRefund.id, adminFee };
      }
    } catch (re: any) {
      // A swallowed failure leaves the ticket dead and the customer charged with nothing
      // surfacing it. Escalate as cancellation-orchestrator.processCustomerRefund does.
      customerRefund = { issued: false, failed: true, reason: re?.message || 'Stripe refund failed' };
      console.error(`[PTR] CRITICAL: ${kind} customer refund FAILED for ${bk.masterBookingReference}:`, re?.message);
      await prisma.bookingEvent.create({
        data: {
          bookingId: bk.id, eventType: 'REFUND_FAILED', eventTitle: 'Refund Failed',
          eventDescription: `Ticket was ${isVoid ? 'voided' : 'refunded'} at the provider but the customer refund did NOT go through: ${re?.message || 'unknown error'}. The customer is still charged — a manual refund is required.`,
          actorType: 'system', actorName: isVoid ? 'PTR Void' : 'PTR Refund',
        },
      }).catch(() => {});
      await prisma.supportTicket.create({
        data: {
          subject: `${kind} refund FAILED: ${bk.masterBookingReference} — customer still charged`,
          description: [
            `The ticket for ${bk.masterBookingReference} was ${isVoid ? 'voided' : 'refunded'} at the provider, but the customer refund failed.`,
            '', `Error: ${re?.message || 'unknown'}`,
            `Provider PTR: ${providerPtrId ?? 'n/a'} (${uniqueId})`,
            `Amount owed: ${owed.toFixed(2)}`,
            'A manual refund to the original card is required.',
          ].join('\n'),
          priority: 'HIGH', status: 'OPEN', category: 'Refund', channel: 'SYSTEM',
          bookingRef: bk.masterBookingReference,
          ticketType: 'REFUND', queue: 'CANCELLATION_SUPPORT',
          providerPnr: uniqueId, providerBookingRef: uniqueId,
        } as any,
      }).catch(() => {});
    }

    // Release the agent wallet hold for agent-owned bookings.
    if (bk.agentUserId) {
      try {
        const walletSvc = await import('../services/agent-wallet');
        if (full?.totalAmount) await walletSvc.releaseUtilization(bk.agentUserId, Number(full.totalAmount), 'CANCELLATION', requestedBy || `PTR_${kind}`, bk.id);
      } catch (we: any) { console.error(`[PTR] ${kind} wallet release failed:`, we?.message); }
    }
  } catch (e: any) {
    console.error(`[PTR] ${kind} booking-status update failed:`, e?.message);
    customerRefund = { issued: false, failed: true, reason: e?.message || 'booking update failed' };
  }

  return customerRefund;
}

/**
 * Hand an accepted-but-unfulfilled reissue to the settlement cron.
 *
 * Accepting a ReIssueQuote returns PTRStatus=InProcess with a 60-minute SLA — the
 * airline has NOT reissued yet. `reissue-reconciliation-cron` polls ChangeRequest rows
 * in PROVIDER_PROCESSING and `services/reissue-settlement.ts` advances them only once
 * the provider reports Resolution=Reissued (or refunds + escalates on rejection).
 * Without this row nothing ever verifies fulfilment, so the booking would claim a
 * reissue that may still fail at the airline an hour later.
 */
async function enqueueReissueSettlement(params: {
  uniqueId: string;
  bookingId?: string;
  providerPtrId: number;
  requestedBy?: string;
  providerResponse?: unknown;
  collectedChargeId?: string | null;
  collectedAmount?: number | null;
}): Promise<string | null> {
  // Resolve by MFRef as well as FareMind id/reference — the PTR console often has only
  // the MFRef, and an unresolved booking means fulfilment is never verified.
  const booking = await resolvePtrBooking(params.uniqueId, params.bookingId);
  if (!booking) {
    console.warn(`[PTR] enqueueReissueSettlement: no MasterBooking for "${params.bookingId || params.uniqueId}" — reissue will NOT be polled.`);
    return null;
  }
  try {
    const cr = await prisma.changeRequest.create({
      data: {
        bookingId: booking.id,
        type: 'DATE_CHANGE',
        status: 'PROVIDER_PROCESSING',
        requestedBy: params.requestedBy || 'agent',
        providerPtrId: String(params.providerPtrId),
        providerMfRef: params.uniqueId,
        providerResponse: (params.providerResponse ?? undefined) as any,
        collectedChargeId: params.collectedChargeId ?? null,
        collectedAmount: params.collectedAmount ?? null,
        // First poll ~30 min after accept; reissue-settlement widens the back-off.
        nextCheckAt: new Date(Date.now() + 30 * 60 * 1000),
      } as any,
    });
    return cr.id;
  } catch (e) {
    console.error('[PTR] enqueueReissueSettlement failed:', (e as Error).message);
    return null;
  }
}

// ═══════════════════════════════════════════════
// Route Plugin
// ═══════════════════════════════════════════════

const ptrPlugin: FastifyPluginAsync = async (fastify) => {

  // ── Void Quote ─────────────────────────────────

  fastify.post('/void-quote', async (request, reply) => {
    try {
      const body = request.body as {
        reference?: string; airlinePnr?: string; uniqueId?: string; bookingId?: string;
        requestedBy?: string; notes?: string;
      };
      const { requestedBy, notes } = body;

      const resolved = await resolveServicingRef(body);
      if (!resolved.ref) return reply.code(resolved.status || 400).send({ error: resolved.error, errorCode: resolved.errorCode });
      const { mfRef: uniqueId, bookingId } = resolved.ref;

      // Create DB record
      let ptrRecord = null;
      if (bookingId) {
        ptrRecord = await createPtrRecord({
          bookingId,
          providerUniqueId: uniqueId,
          requestType: 'VOID_QUOTE',
          requestedBy: requestedBy || 'system',
          notes,
        });
      }

      const { result } = await withEticketRetry(uniqueId, bookingId, (pax) => mystifly.voidQuote(uniqueId, pax));
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        const adopted = await adoptInProcessPtr({
          message, ptrRecordId: ptrRecord?.id, result, booking: publicRef(resolved.ref), kind: 'void',
        });
        if (adopted) return adopted;

        if (ptrRecord) await updatePtrRecord(ptrRecord.id, { status: 'FAILED', failureReason: message, failedAt: new Date(), providerQuoteResponse: result });
        const notEligible = /verify the request|not eligible|not allowed|not permitted|window|invalid/i.test(message);
        const friendly = notEligible
          ? `Void was rejected by the airline (${message}). Void is only possible within the airline's void window and while the ticket is in a voidable state. If this is a fresh booking, ticketing may still be settling — retry in a moment; otherwise use "Get Refund Quote" or "Force Cancel + Refund".`
          : message;
        return reply.code(422).send({ error: friendly, errorCode: 'MYSTIFLY_VOID_QUOTE_FAILED', raw: result });
      }

      // Void quote returns synchronously: Data.VoidQuotes[] with TotalRefundAmount / TotalVoidingFee.
      const quoteData = result?.Data || result;
      const vq = Array.isArray(quoteData?.VoidQuotes) ? quoteData.VoidQuotes : [];
      const providerPtrId = quoteData?.PTRId ?? quoteData?.PtrId ?? null;
      const totalRefund = vq.reduce((s: number, q: any) => s + (parseFloat(q?.TotalRefundAmount) || 0), 0);
      const totalVoidingFee = vq.reduce((s: number, q: any) => s + (parseFloat(q?.TotalVoidingFee) || 0), 0);
      const currency = vq[0]?.Currency || quoteData?.Currency || 'USD';
      // Same asynchronous contract as the refund quote — an empty VoidQuotes[]
      // means the airline has not priced it, not that nothing comes back.
      const quotePending = isQuoteUnanswered(vq);
      if (ptrRecord) {
        await updatePtrRecord(ptrRecord.id, {
          status: quotePending ? 'QUOTE_PENDING' : 'QUOTE_RECEIVED',
          providerRequestId: providerPtrId != null ? String(providerPtrId) : null,
          providerStatus: quoteData?.PTRStatus ?? null,
          quoteTotalAmount: quotePending ? null : (totalRefund || null),
          quotePenaltyAmount: quotePending ? null : (totalVoidingFee || null),
          quoteRefundAmount: quotePending ? null : (totalRefund || null),
          quoteCurrency: currency,
          providerQuoteResponse: result,
        });
      }

      const voidAdvice = await couponServicingAdvice(uniqueId);
      return {
        success: true, booking: publicRef(resolved.ref), ptrId: ptrRecord?.id, providerPtrId,
        ptrStatus: quoteData?.PTRStatus, voidingWindow: quoteData?.VoidingWindow,
        quotePending,
        resolution: quoteData?.Resolution ?? null,
        pendingMessage: quotePending
          ? 'The airline has not priced this void yet. Re-check the PTR status shortly; do not execute until an amount is returned.'
          : undefined,
        quote: quotePending ? null : { TotalRefundAmount: totalRefund, TotalVoidingFee: totalVoidingFee, Currency: currency, VoidQuotes: vq },
        couponAdvice: voidAdvice,
        raw: result,
      };
    } catch (error: any) {
      console.error('[PTR] VoidQuote error:', error.message);
      return reply.code(502).send({ error: `VoidQuote failed: ${error.message}` });
    }
  });

  // ── Void Execute ───────────────────────────────

  fastify.post('/void', async (request, reply) => {
    try {
      const body = request.body as {
        reference?: string; airlinePnr?: string; uniqueId?: string; bookingId?: string;
        ptrId?: string; requestedBy?: string;
      };
      const { ptrId, requestedBy } = body;

      const resolved = await resolveServicingRef(body);
      if (!resolved.ref) return reply.code(resolved.status || 400).send({ error: resolved.error, errorCode: resolved.errorCode });
      const { mfRef: uniqueId, bookingId } = resolved.ref;

      if (ptrId) await updatePtrRecord(ptrId, { status: 'EXECUTING', approvedBy: requestedBy, approvedAt: new Date() });

      // Direct Void — submit with the passengers array. Returns PTRStatus=InProcess;
      // fulfilment (Resolution=Voided) settles async and is polled via searchPtr.
      const { result } = await withEticketRetry(uniqueId, bookingId, (pax) => mystifly.executeVoid(uniqueId, pax));
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        if (ptrId) await updatePtrRecord(ptrId, { status: 'FAILED', failureReason: message, failedAt: new Date(), providerExecResponse: result });
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_VOID_FAILED', raw: result });
      }

      const data = result?.Data || result;
      const providerPtrId = data?.PTRId ?? data?.PtrId ?? null;
      const ptrStatus = data?.PTRStatus || 'InProcess';
      // COMPLETED only if the provider already reports it; otherwise EXECUTING (async).
      if (ptrId) await updatePtrRecord(ptrId, { status: /completed/i.test(ptrStatus) ? 'COMPLETED' : 'EXECUTING', executedAt: new Date(), providerExecResponse: result });

      // Void and refund must leave the booking in the same shape — one shared path.
      const customerRefund = await applyCancellationToBooking({
        kind: 'VOID', uniqueId, bookingId, providerPtrId, ptrStatus, requestedBy,
      });

      return {
        success: true,
        booking: publicRef(resolved.ref),
        ptrId, providerPtrId, ptrStatus,
        customerRefund,
        // The void succeeded at the provider but the customer may still be charged —
        // the agent must see that rather than a bare success.
        warning: customerRefund.failed
          ? 'Ticket voided, but the customer refund FAILED. A support ticket has been raised; a manual refund is required.'
          : (!customerRefund.issued && !customerRefund.alreadyRefunded)
            ? `Ticket voided, but no customer refund was issued (${customerRefund.reason}). Verify the payment record.`
            : undefined,
        raw: result,
      };
    } catch (error: any) {
      console.error('[PTR] Void error:', error.message);
      return reply.code(502).send({ error: `Void failed: ${error.message}` });
    }
  });

/**
 * Adopt an in-flight provider PTR onto our record so the reconciler can finish
 * it. Returns the response to send, or null when the message named no PTR.
 */
async function adoptInProcessPtr(params: {
  message: string;
  ptrRecordId?: string | null;
  result: any;
  booking: unknown;
  kind: 'void' | 'refund';
}): Promise<Record<string, unknown> | null> {
  const providerPtrId = ptrIdFromInProcessMessage(params.message);
  if (providerPtrId == null) return null;

  // The local record is created before the provider call, so each retry adds a
  // row. Without this, clicking Get Refund Quote five times against one stuck
  // PTR leaves five QUOTE_PENDING rows all naming 22981 — a cluttered history,
  // and the reconciler polling the same provider request once per duplicate.
  const already = await prisma.postTicketingRequest.findFirst({
    where: {
      providerRequestId: String(providerPtrId),
      provider: 'MYSTIFLY',
      ...(params.ptrRecordId ? { NOT: { id: params.ptrRecordId } } : {}),
    },
    orderBy: { createdAt: 'asc' },
  }).catch(() => null);

  // Keep the record that already tracks this PTR and retire the duplicate this
  // click created, rather than the other way round: the original carries the
  // history, and the reconciler may already be working it.
  const trackingId = already?.id ?? params.ptrRecordId ?? null;

  if (already && params.ptrRecordId && already.id !== params.ptrRecordId) {
    await updatePtrRecord(params.ptrRecordId, {
      status: 'CANCELLED',
      failureReason: `Superseded — PTR ${providerPtrId} is already tracked on request ${already.id}.`,
      providerQuoteResponse: params.result,
    }).catch(() => {});
  }

  if (trackingId) {
    await updatePtrRecord(trackingId, {
      status: 'QUOTE_PENDING',
      providerRequestId: String(providerPtrId),
      providerStatus: 'InProcess',
      failureReason: null,
      failedAt: null,
      providerQuoteResponse: params.result,
    }).catch(() => {});
  }

  return {
    success: true,
    booking: params.booking,
    ptrId: trackingId ?? undefined,
    providerPtrId,
    quotePending: true,
    adoptedExistingPtr: true,
    ptrStatus: 'InProcess',
    pendingMessage:
      `The airline already has ${params.kind === 'void' ? 'a void' : 'a refund'} quote open for this ticket (PTR ${providerPtrId}) — a previous attempt reached them even though it reported an error. ` +
      `That request is now being tracked and will price automatically; no need to raise another. Do not execute until an amount is returned.`,
    quote: null,
    raw: params.result,
  };
}

  // ── Refund Quote ───────────────────────────────

  fastify.post('/refund-quote', async (request, reply) => {
    try {
      const body = request.body as {
        reference?: string; airlinePnr?: string; uniqueId?: string; bookingId?: string;
        requestedBy?: string; notes?: string;
      };
      const { requestedBy, notes } = body;

      const resolved = await resolveServicingRef(body);
      if (!resolved.ref) return reply.code(resolved.status || 400).send({ error: resolved.error, errorCode: resolved.errorCode });
      const { mfRef: uniqueId, bookingId } = resolved.ref;

      let ptrRecord = null;
      if (bookingId) {
        ptrRecord = await createPtrRecord({
          bookingId,
          providerUniqueId: uniqueId,
          requestType: 'REFUND_QUOTE',
          requestedBy: requestedBy || 'system',
          notes,
        });
      }

      // Mystifly requires RefundDetails[] on a RefundQuote and refuses the
      // request without it. The figures are the fare being refunded, so they
      // come from the provider's own TripDetails breakdown rather than anything
      // computed here. A failed read is not fatal — send the quote without them
      // and let the provider's own message stand.
      const tripForRefund = await mystifly.getTripDetailsResilient(uniqueId).catch(() => null);
      const { result } = await withEticketRetry(uniqueId, bookingId, (pax) =>
        mystifly.refundQuote(uniqueId, pax, buildRefundDetails(tripForRefund, ticketNumbersByType(pax))));
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        // A refusal that names an existing PTR is not a failure — it is the
        // provider telling us the id of the request we already have open.
        const adopted = await adoptInProcessPtr({
          message, ptrRecordId: ptrRecord?.id, result, booking: publicRef(resolved.ref), kind: 'refund',
        });
        if (adopted) return adopted;

        if (ptrRecord) await updatePtrRecord(ptrRecord.id, { status: 'FAILED', failureReason: message, failedAt: new Date(), providerQuoteResponse: result });
        // The airline refused a refund PTR (non-refundable, still in void window, or
        // already processed). Point staff at the right alternative instead of a dead end.
        const contractGap = /details? (are|is) missing|missing from the request/i.test(message);
        if (contractGap) {
          return reply.code(422).send({
            error: `The airline could not price a refund for this ticket (${message}). The refund figures are normally taken from the airline's own fare breakdown — if TripDetails did not return one for this booking they cannot be sent, and the request is refused. Check the booking still resolves at the provider, then retry; if it persists use "Force Cancel + Refund".`,
            errorCode: 'MYSTIFLY_REFUND_QUOTE_MISSING_DETAILS',
            raw: result,
          });
        }
        const notEligible = /not eligible|non.?refundable|no refund|not allowed|not permitted|verify the request/i.test(message);
        const friendly = notEligible
          ? `This ticket cannot be refunded through the airline's refund process (${message}). If it is still within the void window use "Get Void Quote"; otherwise use "Force Cancel + Refund" to cancel and issue a manual refund.`
          : message;
        return reply.code(422).send({ error: friendly, errorCode: 'MYSTIFLY_REFUND_QUOTE_FAILED', raw: result });
      }

      // Refund quote returns synchronously: Data.RefundQuotes[] (TotalRefundAmount /
      // TotalRefundCharges / CancellationCharge) + PTRId (needed to accept the refund).
      const quoteData = result?.Data || result;
      const rq = Array.isArray(quoteData?.RefundQuotes) ? quoteData.RefundQuotes : [];
      const providerPtrId = quoteData?.PTRId ?? quoteData?.PtrId ?? null;
      const totalRefund = rq.reduce((s: number, q: any) => s + (parseFloat(q?.TotalRefundAmount) || 0), 0);
      const totalCharges = rq.reduce((s: number, q: any) => s + (parseFloat(q?.TotalRefundCharges) || 0), 0);
      const cancellationCharge = rq.reduce((s: number, q: any) => s + (parseFloat(q?.CancellationCharge) || 0), 0);
      const currency = rq[0]?.Currency || quoteData?.Currency || 'USD';
      // Mystifly answers a RefundQuote asynchronously: the first response comes
      // back PTRStatus=InProcess / Resolution=QuoteRequested with an EMPTY
      // RefundQuotes[]. Summing that array gives 0, which was then shown as a
      // settled "$0.00 refund" on a fare the airline had said is refundable —
      // an unanswered quote rendered as an answer of nothing.
      const quotePending = isQuoteUnanswered(rq);
      if (ptrRecord) {
        await updatePtrRecord(ptrRecord.id, {
          status: quotePending ? 'QUOTE_PENDING' : 'QUOTE_RECEIVED',
          // The provider PTR id is how the reconciler finds this quote again
          // once the airline prices it.
          providerRequestId: providerPtrId != null ? String(providerPtrId) : null,
          providerStatus: quoteData?.PTRStatus ?? null,
          quoteTotalAmount: quotePending ? null : (totalRefund || null),
          quotePenaltyAmount: quotePending ? null : (totalCharges || null),
          quoteRefundAmount: quotePending ? null : (totalRefund || null),
          quoteCurrency: currency,
          providerQuoteResponse: result,
        });
      }

      const refundAdvice = await couponServicingAdvice(uniqueId);
      return {
        success: true, booking: publicRef(resolved.ref), ptrId: ptrRecord?.id, providerPtrId,
        ptrStatus: quoteData?.PTRStatus,
        quotePending,
        resolution: quoteData?.Resolution ?? null,
        pendingMessage: quotePending
          ? 'The airline has not priced this refund yet. Re-check the PTR status shortly; do not execute until an amount is returned.'
          : undefined,
        quote: quotePending ? null : { TotalRefundAmount: totalRefund, TotalRefundCharges: totalCharges, CancellationCharge: cancellationCharge, Currency: currency, RefundQuotes: rq },
        couponAdvice: refundAdvice,
        raw: result,
      };
    } catch (error: any) {
      console.error('[PTR] RefundQuote error:', error.message);
      return reply.code(502).send({ error: `RefundQuote failed: ${error.message}` });
    }
  });

  // ── Refund Execute ─────────────────────────────

  fastify.post('/refund', async (request, reply) => {
    try {
      const body = request.body as {
        reference?: string; airlinePnr?: string; uniqueId?: string; bookingId?: string;
        ptrId?: string; providerPtrId?: number; refundAmount?: number; requestedBy?: string;
      };
      const { ptrId, providerPtrId, refundAmount, requestedBy } = body;
      if (!providerPtrId) return reply.code(400).send({ error: 'providerPtrId (the RefundQuote PTR id) is required — run Get Refund Quote first.', errorCode: 'MISSING_PTR_ID' });

      const resolved = await resolveServicingRef(body);
      if (!resolved.ref) return reply.code(resolved.status || 400).send({ error: resolved.error, errorCode: resolved.errorCode });
      const { mfRef: uniqueId, bookingId } = resolved.ref;

      if (ptrId) await updatePtrRecord(ptrId, { status: 'EXECUTING', approvedBy: requestedBy, approvedAt: new Date() });

      // Accept Refund — RefundQuote + AcceptQuote=yes + the RefundQuote PTR id + passengers.
      // Returns PTRType=Refund, PTRStatus=InProcess; settles async (Resolution=Refunded).
      const { result } = await withEticketRetry(uniqueId, bookingId,
        (pax) => mystifly.executeRefund(uniqueId, providerPtrId, pax, 'Refund accepted via FareMind'));
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        if (ptrId) await updatePtrRecord(ptrId, { status: 'FAILED', failureReason: message, failedAt: new Date(), providerExecResponse: result });
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_REFUND_FAILED', raw: result });
      }

      const data = result?.Data || result;
      const ptrStatus = data?.PTRStatus || 'InProcess';
      if (ptrId) await updatePtrRecord(ptrId, { status: /completed/i.test(ptrStatus) ? 'COMPLETED' : 'EXECUTING', executedAt: new Date(), providerExecResponse: result });

      // Refund is the path once the void window has closed, so it must settle the booking
      // exactly as a void does — previously this returned without touching the booking at
      // all, leaving it TICKETED/ISSUED with the customer unrefunded. The amount is the
      // airline's quoted refund (captured by /refund-quote) less the FareMind service fee,
      // where a void returns the full captured amount.
      const quoteRec = ptrId
        ? await prisma.postTicketingRequest.findUnique({ where: { id: ptrId }, select: { quoteRefundAmount: true } }).catch(() => null)
        : null;
      const quotedRefundAmount = refundAmount ?? (quoteRec?.quoteRefundAmount != null ? Number(quoteRec.quoteRefundAmount) : null);

      const customerRefund = await applyCancellationToBooking({
        kind: 'REFUND', uniqueId, bookingId, providerPtrId, ptrStatus, quotedRefundAmount, requestedBy,
      });

      return {
        success: true,
        booking: publicRef(resolved.ref),
        ptrId, providerPtrId, ptrStatus,
        quotedRefundAmount,
        customerRefund,
        warning: customerRefund.failed
          ? 'Refund submitted at the provider, but the customer refund FAILED. A support ticket has been raised; a manual refund is required.'
          : (!customerRefund.issued && !customerRefund.alreadyRefunded)
            ? `Refund submitted at the provider, but no customer refund was issued (${customerRefund.reason}).`
            : undefined,
        raw: result,
      };
    } catch (error: any) {
      console.error('[PTR] Refund error:', error.message);
      return reply.code(502).send({ error: `Refund failed: ${error.message}` });
    }
  });

  // ── Reissue Quote ──────────────────────────────

  fastify.post('/reissue-quote', async (request, reply) => {
    try {
      const body = request.body as {
        reference?: string; airlinePnr?: string; uniqueId?: string; bookingId?: string;
        newFareSourceCode?: string;
        originDestinations?: mystifly.MystiflyReissueOriginDestination[];
        preferenceOption?: number; requestedBy?: string; notes?: string;
      };
      const { newFareSourceCode, originDestinations, preferenceOption, requestedBy, notes } = body;

      const resolved = await resolveServicingRef(body);
      if (!resolved.ref) return reply.code(resolved.status || 400).send({ error: resolved.error, errorCode: resolved.errorCode });
      const { mfRef: uniqueId, bookingId } = resolved.ref;

      let ptrRecord = null;
      if (bookingId) {
        ptrRecord = await createPtrRecord({
          bookingId,
          providerUniqueId: uniqueId,
          requestType: 'REISSUE_QUOTE',
          requestedBy: requestedBy || 'system',
          notes,
        });
      }

      // Mystifly's ReIssueQuote is an OND request and requires both `passengers` and
      // `originDestinations`; it has no fare-source-code mode. Sending the bare
      // {mFRef, ptrType} body makes their service 500. Caller-supplied ONDs express a
      // real flight change; otherwise re-quote the booking's current itinerary.
      const passengers = await loadPtrPassengers(uniqueId, bookingId);
      const onds = (Array.isArray(originDestinations) && originDestinations.length > 0)
        ? originDestinations
        : await loadPtrOriginDestinations(uniqueId, bookingId);

      if (passengers.length === 0 || onds.length === 0) {
        const missing = [
          passengers.length === 0 ? 'passengers' : null,
          onds.length === 0 ? 'originDestinations' : null,
        ].filter(Boolean).join(' and ');
        const msg = `Cannot build the reissue quote: ${missing} could not be resolved for this booking. Mystifly rejects a ReIssueQuote without them.`;
        if (ptrRecord) await updatePtrRecord(ptrRecord.id, { status: 'FAILED', failureReason: msg, failedAt: new Date() });
        return reply.code(422).send({ error: msg, errorCode: 'REISSUE_QUOTE_INCOMPLETE' });
      }

      // Ask the airline whether the coupons still permit a reissue before quoting one.
      // Advisory by default — see couponServicingAdvice.
      const couponAdvice = await couponServicingAdvice(uniqueId);
      if (ENFORCE_COUPON_STATUS && couponAdvice.checked && !couponAdvice.eligible) {
        const msg = `The airline reports this ticket is not eligible for reissue: ${couponAdvice.warnings.join(' ') || 'coupons are not in OPEN status'}`;
        if (ptrRecord) await updatePtrRecord(ptrRecord.id, { status: 'FAILED', failureReason: msg, failedAt: new Date() });
        return reply.code(422).send({ error: msg, errorCode: 'COUPONS_NOT_SERVICEABLE', couponAdvice });
      }

      const { result } = await withEticketRetry(uniqueId, bookingId, (pax) => mystifly.reissueQuote(uniqueId, onds, pax));
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        if (ptrRecord) await updatePtrRecord(ptrRecord.id, { status: 'FAILED', failureReason: message, failedAt: new Date(), providerQuoteResponse: result });
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_REISSUE_QUOTE_FAILED', raw: result, couponAdvice });
      }

      // ReIssueQuote returns ONLY the PTR id — it carries no amounts. The priced options
      // live in GetExchangeQuote (Search PTR), so fetch them and price the change the way
      // refund-quote prices a refund: the operator must see fare difference, airline
      // penalty and service fee BEFORE anything is charged or sent to the airline.
      const quoteData = result?.Data || result;
      const providerPtrId = quoteData?.PTRId ?? quoteData?.PtrId ?? null;

      let priced: {
        fareDifference: number; penalty: number; serviceFee: number; totalCollect: number;
        currency: string; providerCurrency: string; preferenceOption: number;
      } | null = null;
      let options: any[] = [];
      let pricingError: string | null = null;

      if (providerPtrId) {
        try {
          const exchange = await mystifly.getExchangeQuote(uniqueId, Number(providerPtrId));
          const exData = exchange?.Data || exchange;
          options = Array.isArray(exData?.RequestedPreferences) ? exData.RequestedPreferences : [];
          const chosen = options.find((p: any) => Number(p?.Option) === (preferenceOption ?? 1)) || options[0];
          const fares: any[] = Array.isArray(chosen?.QuotedFares) ? chosen.QuotedFares : [];
          if (fares.length > 0) {
            // TotalFareDifference is the total for the whole booking, NOT per head —
            // confirmed by Mystifly. PassengerCount is informational; multiplying by it
            // would bill a 2-passenger reissue twice.
            const sum = (pick: (f: any) => any) => fares.reduce(
              (s, f) => s + (parseFloat(pick(f)) || 0), 0);
            const providerCurrency = String(fares[0]?.Currency || 'USD').toUpperCase();
            // TotalFareDifference already includes Penalty — never add them together.
            const rawFareDiff = sum((f) => f.TotalFareDifference);
            const rawPenalty = sum((f) => f.Penalty);
            const fareDifference = providerCurrency !== 'USD' ? await toUsd(rawFareDiff, providerCurrency) : rawFareDiff;
            const penalty = providerCurrency !== 'USD' ? await toUsd(rawPenalty, providerCurrency) : rawPenalty;
            const bk = await resolvePtrBooking(uniqueId, bookingId);
            const full = bk ? await prisma.masterBooking.findUnique({
              where: { id: bk.id },
              select: { serviceFeeAmount: true, passengers: { select: { id: true } } },
            }) : null;
            const serviceFee = full ? await getAdminServiceFee(full) : 0;
            const r2 = (x: number) => Math.round(x * 100) / 100;
            priced = {
              fareDifference: r2(fareDifference), penalty: r2(penalty), serviceFee: r2(serviceFee),
              totalCollect: r2(Math.max(0, fareDifference) + Math.max(0, serviceFee)),
              currency: 'USD', providerCurrency,
              preferenceOption: Number(chosen?.Option) || (preferenceOption ?? 1),
            };
          } else {
            pricingError = 'The airline returned no priced options for this reissue.';
          }
        } catch (e: any) {
          pricingError = `Could not price the reissue: ${e?.message || 'exchange quote failed'}`;
          console.error('[PTR] ReIssueQuote pricing failed:', e?.message);
        }
      }

      if (ptrRecord) {
        await updatePtrRecord(ptrRecord.id, {
          status: 'QUOTE_RECEIVED',
          quoteTotalAmount: priced?.totalCollect ?? null,
          quotePenaltyAmount: priced?.penalty ?? null,
          quoteCurrency: priced?.currency || 'USD',
          fareSourceCode: newFareSourceCode,
          providerQuoteResponse: result,
        });
      }

      return {
        success: true,
        booking: publicRef(resolved.ref),
        ptrId: ptrRecord?.id,
        providerPtrId,
        // Same shape the Reissue + Collect modal renders, so the console can show the
        // breakdown instead of a PTR id with no numbers.
        quote: priced
          ? { ...priced, TotalAmount: priced.totalCollect, PenaltyAmount: priced.penalty, Currency: priced.currency }
          : quoteData,
        priced,
        pricingError,
        couponAdvice,
        optionCount: options.length,
        originDestinations: onds,
        raw: result,
      };
    } catch (error: any) {
      console.error('[PTR] ReIssueQuote error:', error.message);
      return reply.code(502).send({ error: `ReIssueQuote failed: ${error.message}` });
    }
  });

  // ── Reissue Execute ────────────────────────────

  fastify.post('/reissue', async (request, reply) => {
    try {
      const body = request.body as {
        reference?: string; airlinePnr?: string; uniqueId?: string; bookingId?: string;
        ptrId?: string; providerPtrId?: number; preferenceOption?: number;
        requestedBy?: string; newFareSourceCode?: string;
        collectDifference?: boolean; expectedTotalCollect?: number;
      };
      const {
        ptrId, providerPtrId, preferenceOption, requestedBy,
        newFareSourceCode, collectDifference, expectedTotalCollect,
      } = body;
      if (!providerPtrId) return reply.code(400).send({ error: 'providerPtrId (the ReIssueQuote PTR id) is required — run Get Reissue Quote first.', errorCode: 'MISSING_PTR_ID' });

      const resolved = await resolveServicingRef(body);
      if (!resolved.ref) return reply.code(resolved.status || 400).send({ error: resolved.error, errorCode: resolved.errorCode });
      const { mfRef: uniqueId, bookingId } = resolved.ref;

      if (ptrId) await updatePtrRecord(ptrId, { status: 'EXECUTING', approvedBy: requestedBy, approvedAt: new Date() });

      // A reissue costs the customer money — fare difference (which already includes the
      // airline penalty) plus the FareMind service fee — so the card must be charged
      // BEFORE the change is sent to the airline, and refunded if the airline then fails.
      // That is what initiateReissue does, and it is the same collect-then-act ordering the
      // refund flow uses. Executing without collecting reissued the ticket for free.
      let collection: Record<string, unknown> | null = null;
      if (collectDifference !== false) {
        const bk = await resolvePtrBooking(uniqueId, bookingId);
        if (!bk) {
          return reply.code(422).send({ error: 'Cannot collect the reissue difference: no booking found for this reference. Pass collectDifference:false to reissue without charging.', errorCode: 'BOOKING_NOT_FOUND' });
        }
        const full = await mbq.getMasterBookingFull(bk.id);
        try {
          const out = await initiateReissue({
            bookingId: bk.id,
            newFareSourceCode: newFareSourceCode || '',
            forcedBy: requestedBy ? `AGENT:${requestedBy}` : 'AGENT',
            preferenceOption: preferenceOption ?? 1,
            expectedTotalCollect,
          }, full);
          // initiateReissue quotes, charges, executes, enqueues settlement and refunds on
          // provider failure — nothing further to do here.
          return { success: true, booking: publicRef(resolved.ref), collected: true, ...out };
        } catch (e: any) {
          const code = e?.code || 'REISSUE_FAILED';

          // Awaiting the customer's payment is not a failure — the request is raised, the
          // customer has been told, and the change goes to the airline by itself once they
          // pay. Marking the PTR FAILED here would make staff retry something already in
          // hand, so it stays AWAITING_APPROVAL and the response says 202, not 4xx.
          if (code === 'REISSUE_PAYMENT_REQUESTED') {
            if (ptrId) await updatePtrRecord(ptrId, { status: 'AWAITING_APPROVAL', failureReason: e?.message });
            return reply.code(202).send({
              success: false,
              awaitingPayment: true,
              errorCode: code,
              error: e?.message,
              amountDue: e?.amountDue ?? null,
              currency: e?.currency ?? 'USD',
              servicePaymentId: e?.servicePaymentId ?? null,
            });
          }

          const status = code === 'REISSUE_PRICE_CHANGED' ? 409 : 422;
          if (ptrId) await updatePtrRecord(ptrId, { status: 'FAILED', failureReason: e?.message, failedAt: new Date() });
          return reply.code(status).send({
            error: e?.message || 'Reissue failed', errorCode: code,
            quotedTotalCollect: e?.quotedTotalCollect, expectedTotalCollect: e?.expectedTotalCollect,
          });
        }
      }

      // collectDifference:false — provider-only reissue (nothing charged). Kept for
      // airline-initiated/involuntary changes where the customer owes nothing.
      const result = await mystifly.confirmReissue(uniqueId, providerPtrId, preferenceOption ?? 1);
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        if (ptrId) await updatePtrRecord(ptrId, { status: 'FAILED', failureReason: message, failedAt: new Date(), providerExecResponse: result });
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_REISSUE_FAILED', raw: result });
      }

      // Accepting returns PTRType=ReIssue / PTRStatus=InProcess with an SLA (typically
      // 60 min) — the airline has NOT reissued yet. Mark COMPLETED only if the provider
      // itself says so; otherwise EXECUTING, exactly as /void and /refund do.
      const data = result?.Data || result;
      const ptrStatus = data?.PTRStatus || 'InProcess';
      const slaInMinutes = data?.SLAInMinutes ?? null;
      const settled = /completed/i.test(ptrStatus);
      if (ptrId) await updatePtrRecord(ptrId, { status: settled ? 'COMPLETED' : 'EXECUTING', executedAt: new Date(), providerExecResponse: result });

      // Queue fulfilment polling. Booking status is advanced by reissue-settlement only
      // after the provider reports Resolution=Reissued — never here.
      let settlementId: string | null = null;
      if (!settled) {
        settlementId = await enqueueReissueSettlement({
          uniqueId,
          bookingId,
          providerPtrId,
          requestedBy,
          providerResponse: result,
        });
      }

      return {
        success: true,
        booking: publicRef(resolved.ref),
        ptrId,
        providerPtrId,
        ptrStatus,
        slaInMinutes,
        settled,
        pendingFulfilment: !settled,
        settlementId,
        message: settled
          ? 'Reissue completed by the provider.'
          : data?.Message || `Reissue submitted. The airline fulfils it${slaInMinutes ? ` within ~${slaInMinutes} minutes` : ' shortly'}; the booking updates automatically once confirmed.`,
        raw: result,
      };
    } catch (error: any) {
      console.error('[PTR] ReIssue error:', error.message);
      return reply.code(502).send({ error: `ReIssue failed: ${error.message}` });
    }
  });

  // ── Quote Refresh ──────────────────────────────
  //
  // Re-read a quote we already raised. The console keeps its quote in React
  // state, so once the reconciler fills the amounts in there was no way to see
  // them short of running the quote again — and that raises a SECOND PTR at the
  // provider. This reads the stored record, polls the provider once if it is
  // still outstanding, and answers in the same shape the quote endpoints use so
  // the page can swap it straight in.

  fastify.post('/quote-refresh', async (request, reply) => {
    try {
      const { ptrId } = request.body as { ptrId?: string };
      if (!ptrId) return reply.code(400).send({ error: 'ptrId is required', errorCode: 'MISSING_PTR_ID' });

      const existing = await prisma.postTicketingRequest.findUnique({ where: { id: ptrId } });
      if (!existing) return reply.code(404).send({ error: 'No quote found for that id.' });

      if (existing.status === 'QUOTE_PENDING') await reconcilePtrQuoteById(ptrId);

      const rec = await prisma.postTicketingRequest.findUnique({ where: { id: ptrId } });
      if (!rec) return reply.code(404).send({ error: 'No quote found for that id.' });

      const pending = rec.status === 'QUOTE_PENDING';
      const isVoid = rec.requestType === 'VOID_QUOTE';
      const refund = rec.quoteRefundAmount != null ? Number(rec.quoteRefundAmount) : 0;
      const penalty = rec.quotePenaltyAmount != null ? Number(rec.quotePenaltyAmount) : 0;
      const currency = rec.quoteCurrency || 'USD';

      return {
        success: rec.status !== 'FAILED',
        ptrId: rec.id,
        providerPtrId: rec.providerRequestId ? Number(rec.providerRequestId) : null,
        ptrStatus: rec.providerStatus,
        quotePending: pending,
        pendingMessage: pending
          ? 'The airline still has not priced this. It is checked automatically every couple of minutes.'
          : undefined,
        error: rec.status === 'FAILED' ? (rec.failureReason || 'This quote could not be priced.') : undefined,
        quote: pending || rec.status === 'FAILED' ? null : (isVoid
          ? { TotalRefundAmount: refund, TotalVoidingFee: penalty, Currency: currency }
          : { TotalRefundAmount: refund, TotalRefundCharges: penalty, Currency: currency }),
      };
    } catch (error: any) {
      console.error('[PTR] quote-refresh error:', error.message);
      return reply.code(502).send({ error: `Could not refresh the quote: ${error.message}` });
    }
  });

  // ── PTR Status Search ──────────────────────────

  fastify.post('/status', async (request, reply) => {
    try {
      const body = request.body as {
        reference?: string; airlinePnr?: string; uniqueId?: string; bookingId?: string;
      };

      const resolved = await resolveServicingRef(body);
      if (!resolved.ref) return reply.code(resolved.status || 400).send({ error: resolved.error, errorCode: resolved.errorCode });

      const result = await mystifly.searchPtrStatus(resolved.ref.mfRef);
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_PTR_STATUS_FAILED', raw: result });
      }

      return { success: true, booking: publicRef(resolved.ref), ...result };
    } catch (error: any) {
      console.error('[PTR] Status search error:', error.message);
      return reply.code(502).send({ error: `PTR status search failed: ${error.message}` });
    }
  });

  // ── Mark As Read ───────────────────────────────

  fastify.post('/mark-read', async (request, reply) => {
    try {
      const body = request.body as {
        reference?: string; airlinePnr?: string; uniqueId?: string; bookingId?: string;
        providerPtrId?: number; requestType?: mystifly.MarkAsReadPtrType;
      };
      const { providerPtrId, requestType } = body;
      // `id` is the provider PTRId and must be > 0 — the endpoint 400s without it.
      if (!providerPtrId || providerPtrId <= 0) {
        return reply.code(400).send({ error: 'providerPtrId (the Mystifly PTR id) is required and must be greater than 0.', errorCode: 'MISSING_PTR_ID' });
      }

      const resolved = await resolveServicingRef(body);
      if (!resolved.ref) return reply.code(resolved.status || 400).send({ error: resolved.error, errorCode: resolved.errorCode });

      const result = await mystifly.markPtrAsRead(resolved.ref.mfRef, providerPtrId, requestType || 'None');
      const { hasError, message } = extractPtrError(result);

      if (hasError) {
        return reply.code(422).send({ error: message, errorCode: 'MYSTIFLY_MARK_READ_FAILED', raw: result });
      }

      return { success: true, ...result };
    } catch (error: any) {
      console.error('[PTR] MarkAsRead error:', error.message);
      return reply.code(502).send({ error: `MarkAsRead failed: ${error.message}` });
    }
  });
};

export default ptrPlugin;
