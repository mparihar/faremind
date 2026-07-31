/**
 * E-ticket backfill from Mystifly TripDetails.
 *
 * Mystifly ticketing is asynchronous: at checkout-confirm time the e-ticket
 * number is usually not available yet, so booking_tickets rows are created with
 * a null eTicketNumber, and the ticketing-reconciliation cron never writes the
 * number back. Result: every Post-Ticketing Request (Void / Refund / ReIssue)
 * sends a blank `eTicket`, and Mystifly rejects the quote ("not eligible for
 * voiding" / RefundQuote 500) → the flow falls back to a non-live no-refund
 * cancel and the customer is refunded $0.
 *
 * This fetches TripDetails (and AirTicketOrderStatus as a fallback), extracts the
 * e-ticket numbers, and persists them onto the booking_tickets rows so the PTR
 * passenger array (buildPtrPassengers) carries a real eTicket. Idempotent — a
 * no-op once numbers are present.
 */

import { prisma } from './db';
import * as mystifly from '../services/mystifly';

/** The TravelItinerary object, regardless of TripDetails version nesting. */
function travelItinerary(tripResult: any): any {
  const d = tripResult?.Data;
  // Base /api/TripDetails: Data.TripDetailsResult.TravelItinerary
  // Older/other shapes: Data.TravelItinerary
  return d?.TripDetailsResult?.TravelItinerary || d?.TravelItinerary || null;
}

/** The provider ticket status (e.g. "Ticketed" / "TktInProcess" / "Void"). */
export function tripTicketStatus(tripResult: any): string {
  const ti = travelItinerary(tripResult);
  return String(ti?.TicketStatus || tripResult?.Data?.TktStatus || '').trim();
}

/**
 * Is this e-ticket entry still the live one?
 *
 * TripDetails returns the booking's whole ticket history, each entry tagged with an
 * ETicketType — a booking that has been reissued carries both the superseded number
 * (`Reissued`) and the current one (`Ticketed`). Sending a superseded number to any PTR
 * endpoint is rejected with "Eticket number is wrong", so dead entries must be dropped
 * rather than collected alongside the live one.
 */
function isLiveEticketEntry(tk: any): boolean {
  const type = String(tk?.ETicketType ?? tk?.eTicketType ?? '').trim();
  if (!type) return true; // untyped entries: keep, nothing says they are dead
  return !/reissued|refunded|voided|exchanged|cancell?ed/i.test(type);
}

/**
 * Extract e-ticket numbers from TripDetails / AirTicketOrderStatus responses.
 *
 * Superseded numbers are skipped — see isLiveEticketEntry.
 */
export function extractEticketNumbers(tripResult: any, statusResult?: any): string[] {
  const nums: string[] = [];
  const push = (n: any) => {
    const s = typeof n === 'string' ? n.trim() : typeof n === 'number' ? String(n) : '';
    if (s && !nums.includes(s)) nums.push(s);
  };

  // AirTicketOrderStatus
  const st = statusResult?.Data || statusResult;
  (st?.TicketNumbers || st?.ETicketNumbers || []).forEach(push);

  const ti = travelItinerary(tripResult);

  // Primary shape: TravelItinerary.PassengerInfos[].Passenger.{TicketNumber,...}
  const paxInfos = ti?.PassengerInfos || [];
  for (const wrap of Array.isArray(paxInfos) ? paxInfos : [paxInfos]) {
    // ACTUAL Mystifly shape: PassengerInfos[].ETickets[].ETicketNumber
    // (the e-ticket array sits on the PassengerInfo wrapper, NOT under Passenger).
    const eTickets = wrap?.ETickets || [];
    for (const tk of Array.isArray(eTickets) ? eTickets : [eTickets]) {
      if (!isLiveEticketEntry(tk)) continue;
      push(tk?.ETicketNumber || tk?.eTicketNumber || tk?.TicketNumber || tk?.Number);
    }

    const p = wrap?.Passenger || wrap;
    push(p?.TicketNumber || p?.ETicketNumber || p?.eTicketNumber || p?.TicketDocumentNumber || p?.Ticket);
    // Some responses attach a list of ticket docs per passenger.
    const list = p?.ETicketNumbers || p?.TicketDocumentInfo || [];
    for (const tk of Array.isArray(list) ? list : [list]) {
      push(tk?.eTicketNumber || tk?.TicketNumber || tk?.ETicketNumber || tk?.Number || tk);
    }
  }

  // Legacy fallback shape: TravelItinerary.ItineraryInfo.CustomerInfos[]
  const customers = ti?.ItineraryInfo?.CustomerInfos || [];
  for (const wrap of Array.isArray(customers) ? customers : [customers]) {
    const c = wrap?.CustomerInfo || wrap;
    const list = c?.ETicketNumbers || c?.TicketDocumentInfo || [];
    for (const tk of Array.isArray(list) ? list : [list]) {
      push(tk?.eTicketNumber || tk?.TicketNumber || tk?.ETicketNumber || tk?.Number || tk);
    }
  }
  return nums;
}

/**
/** Whether a provider ticket status means the ticket is still being issued. */
export function isPendingIssuanceStatus(status: string | null | undefined): boolean {
  const s = (status || '').toLowerCase();
  if (!s) return false;
  if (/ticketed|issued/.test(s)) return false;
  return /process|book|pend|hold/.test(s); // TktInProcess / Booked / TicketingPending / Hold
}

export interface EticketBackfillResult {
  updated: number;        // ticket rows written with a number this run
  ticketStatus: string;   // provider TicketStatus from TripDetails ("" if unknown)
  hasEticket: boolean;    // booking now has at least one e-ticket number
  pendingIssuance: boolean; // no e-ticket yet AND provider says not-yet-issued
}

/**
 * Ensure the booking's ticket rows carry e-ticket numbers, fetching them from
 * Mystifly TripDetails when missing. Returns backfill outcome + issuance state.
 *
 * `force` re-reads and overwrites rows that already hold a number. A stored e-ticket
 * can go stale — a successful reissue replaces the number at the airline, after which
 * every later PTR on that booking is rejected with "Eticket number is wrong" — and the
 * default missing-only pass would never correct it.
 */
export async function backfillEticketsFromTripDetails(
  bookingId: string,
  mfRef: string,
  opts: { force?: boolean } = {},
): Promise<EticketBackfillResult> {
  const tickets = await prisma.bookingTicket.findMany({
    where: { bookingId },
    orderBy: { createdAt: 'asc' },
  });
  const alreadyHad = tickets.some((t) => t.eTicketNumber || t.ticketNumber);
  // Forced refresh targets every row; the normal pass only fills the blanks.
  const targets = opts.force ? tickets : tickets.filter((t) => !t.eTicketNumber && !t.ticketNumber);
  if (tickets.length === 0 || targets.length === 0) {
    return { updated: 0, ticketStatus: '', hasEticket: alreadyHad, pendingIssuance: false };
  }
  const missing = targets;

  let tripResult: any = null;
  let statusResult: any = null;
  // Version-fallback TripDetails (v3 errors on some bookings — see getTripDetailsResilient).
  try { tripResult = await mystifly.getTripDetailsResilient(mfRef); } catch (e) { console.warn(`[eticket-backfill] TripDetails failed for ${mfRef}:`, (e as Error).message); }
  try { statusResult = await mystifly.getTicketOrderStatus(mfRef); } catch { /* best-effort */ }

  const status = tripTicketStatus(tripResult);
  const nums = extractEticketNumbers(tripResult, statusResult);
  if (nums.length === 0) {
    const pendingIssuance = isPendingIssuanceStatus(status);
    if (pendingIssuance) {
      console.warn(`[eticket-backfill] ${mfRef}: ticket not issued yet (status="${status}") — no e-ticket to persist.`);
    }
    return { updated: 0, ticketStatus: status, hasEticket: alreadyHad, pendingIssuance };
  }

  // Best-effort 1:1 assignment, skipping rows already holding the right number so a
  // forced refresh only writes what actually changed.
  let updated = 0;
  for (let i = 0; i < missing.length && i < nums.length; i++) {
    const row = missing[i];
    if (row.eTicketNumber === nums[i] && row.ticketNumber === nums[i]) continue;
    await prisma.bookingTicket.update({
      where: { id: row.id },
      data: { eTicketNumber: nums[i], ticketNumber: nums[i] },
    });
    updated++;
  }
  console.log(`[eticket-backfill] ${mfRef}: persisted ${updated} e-ticket number(s).`);
  return { updated, ticketStatus: status, hasEticket: true, pendingIssuance: false };
}
