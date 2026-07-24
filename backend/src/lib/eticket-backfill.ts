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

/** Extract e-ticket numbers from TripDetails / AirTicketOrderStatus responses. */
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
 */
export async function backfillEticketsFromTripDetails(bookingId: string, mfRef: string): Promise<EticketBackfillResult> {
  const tickets = await prisma.bookingTicket.findMany({
    where: { bookingId },
    orderBy: { createdAt: 'asc' },
  });
  const alreadyHad = tickets.some((t) => t.eTicketNumber || t.ticketNumber);
  const missing = tickets.filter((t) => !t.eTicketNumber && !t.ticketNumber);
  if (tickets.length === 0 || missing.length === 0) {
    return { updated: 0, ticketStatus: '', hasEticket: alreadyHad, pendingIssuance: false };
  }

  let tripResult: any = null;
  let statusResult: any = null;
  // Version-fallback TripDetails (v3 errors on some bookings — see getTripDetailsResilient).
  try { tripResult = await mystifly.getTripDetailsResilient(mfRef); } catch (e) { console.warn(`[TICKETS][DEBUG] TripDetails failed for ${mfRef}:`, (e as Error).message); }
  try { statusResult = await mystifly.getTicketOrderStatus(mfRef); } catch { /* best-effort */ }

  // Raw shape capture — so if extraction finds nothing we can see where the
  // e-ticket actually lives and fix the field mapping.
  console.log(`[TICKETS][DEBUG] TripDetails RAW for ${mfRef} ←`, JSON.stringify(tripResult)?.slice(0, 4000));

  const status = tripTicketStatus(tripResult);
  const nums = extractEticketNumbers(tripResult, statusResult);
  console.log(`[TICKETS][DEBUG] ${mfRef}: provider TicketStatus="${status}" extracted eTickets=[${nums.join(', ')}] | ticketRows=${tickets.length} missing=${missing.length}`);
  if (nums.length === 0) {
    const pendingIssuance = isPendingIssuanceStatus(status);
    if (pendingIssuance) {
      console.warn(`[TICKETS][DEBUG] ${mfRef}: ticket NOT issued (status="${status}") — no e-ticket yet; void/refund not applicable until ticketing completes.`);
    }
    return { updated: 0, ticketStatus: status, hasEticket: alreadyHad, pendingIssuance };
  }

  // Best-effort 1:1 assignment to the rows still missing a number.
  let updated = 0;
  for (let i = 0; i < missing.length && i < nums.length; i++) {
    await prisma.bookingTicket.update({
      where: { id: missing[i].id },
      data: { eTicketNumber: nums[i], ticketNumber: nums[i] },
    });
    updated++;
  }
  console.log(`[TICKETS][DEBUG] ${mfRef}: backfilled ${updated} ticket row(s) with e-ticket numbers.`);
  return { updated, ticketStatus: status, hasEticket: true, pendingIssuance: false };
}
