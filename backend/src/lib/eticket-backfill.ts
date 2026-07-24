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
function extractEtickets(tripResult: any, statusResult: any): string[] {
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
 * Ensure the booking's ticket rows carry e-ticket numbers, fetching them from
 * Mystifly TripDetails when missing. Returns the count of rows updated.
 */
export async function backfillEticketsFromTripDetails(bookingId: string, mfRef: string): Promise<number> {
  const tickets = await prisma.bookingTicket.findMany({
    where: { bookingId },
    orderBy: { createdAt: 'asc' },
  });
  const missing = tickets.filter((t) => !t.eTicketNumber && !t.ticketNumber);
  if (tickets.length === 0 || missing.length === 0) return 0; // nothing to do

  let tripResult: any = null;
  let statusResult: any = null;
  // Version-fallback TripDetails (v3 errors on some bookings — see getTripDetailsResilient).
  try { tripResult = await mystifly.getTripDetailsResilient(mfRef); } catch (e) { console.warn(`[TICKETS][DEBUG] TripDetails failed for ${mfRef}:`, (e as Error).message); }
  try { statusResult = await mystifly.getTicketOrderStatus(mfRef); } catch { /* best-effort */ }

  // Raw shape capture — so if extraction finds nothing we can see where the
  // e-ticket actually lives and fix the field mapping.
  console.log(`[TICKETS][DEBUG] TripDetails RAW for ${mfRef} ←`, JSON.stringify(tripResult)?.slice(0, 4000));

  const status = tripTicketStatus(tripResult);
  const nums = extractEtickets(tripResult, statusResult);
  console.log(`[TICKETS][DEBUG] ${mfRef}: provider TicketStatus="${status}" extracted eTickets=[${nums.join(', ')}] | ticketRows=${tickets.length} missing=${missing.length}`);
  if (nums.length === 0) {
    if (status && !/ticketed|issued/i.test(status)) {
      console.warn(`[TICKETS][DEBUG] ${mfRef}: ticket NOT issued (status="${status}") — no e-ticket exists yet; void/refund is not applicable until ticketing completes.`);
    }
    return 0;
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
  return updated;
}
