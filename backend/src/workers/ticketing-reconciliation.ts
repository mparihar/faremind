/**
 * Ticketing Reconciliation Worker
 *
 * Background service that polls Mystifly for TICKETING_PENDING bookings.
 * 
 * Flow:
 *   1. Load bookings in TICKETING_PENDING state from TicketingReconciliation table
 *   2. Call AirTicketOrderStatus for each
 *   3. If status is terminal (Ticketed, Not Booked) → update booking + resolve
 *   4. If still pending → schedule next poll with backoff
 *   5. If max polls exceeded → escalate to MANUAL_REVIEW
 *
 * Polling intervals: 0s, 15s, 30s, 60s, 2m, 5m, 10m → then MANUAL_REVIEW
 *
 * This worker is designed to be called:
 *   - On a cron schedule (every 30 seconds during business hours)
 *   - Manually from admin operations panel
 *   - Immediately after a TICKETING_PENDING status is detected
 */

import { prisma } from '../lib/db';
import * as mystifly from '../services/mystifly';
import { extractEticketNumbers, backfillEticketsFromTripDetails } from '../lib/eticket-backfill';
import { backfillFareRulesFromTripDetails } from '../lib/fare-rules-backfill';
import { backfillAirlinePnr } from '../lib/airline-pnr-backfill';
import { executeQueuedCancellation } from '../services/cancellation-orchestrator';
import {
  mapProviderBookingStatus,
  mapProviderTicketingStatus,
  shouldPollStatus,
  getNextPollIntervalMs,
  SLOW_ALERT_AGE_MS,
  MAX_POLL_AGE_MS,
} from '../providers/mystifly';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReconciliationResult {
  id: string;
  bookingId: string;
  mfRef: string;
  previousStatus: string;
  newStatus: string;
  action: 'RESOLVED_TICKETED' | 'RESOLVED_NOT_BOOKED' | 'STILL_PENDING' | 'ESCALATED' | 'ERROR';
  ticketNumbers?: string[];
  error?: string;
}

// ─── Core Worker Function ─────────────────────────────────────────────────────

/**
 * Process all pending ticketing reconciliation records that are due for polling.
 * Returns an array of results describing what happened to each record.
 */
export async function runTicketingReconciliation(): Promise<ReconciliationResult[]> {
  const now = new Date();
  const results: ReconciliationResult[] = [];

  // ── Auto-re-queue escalated records that can still ticket ──
  // Any record ESCALATED (including under the old ~18-min window) whose booking
  // is still awaiting ticketing and is within MAX_POLL_AGE_MS resumes polling.
  // Bounded by age (createdAt >= threshold) so it can never loop forever.
  try {
    const requeueThreshold = new Date(now.getTime() - MAX_POLL_AGE_MS);
    const escalated = await prisma.ticketingReconciliation.findMany({
      where: { status: 'ESCALATED', createdAt: { gte: requeueThreshold } },
      select: { id: true, booking: { select: { ticketingStatus: true } } },
      take: 50,
    });
    const requeueIds = escalated
      .filter((r) => r.booking && r.booking.ticketingStatus === 'TICKETING_PENDING')
      .map((r) => r.id);
    if (requeueIds.length) {
      await prisma.ticketingReconciliation.updateMany({
        where: { id: { in: requeueIds } },
        data: { status: 'PENDING', nextPollAt: now },
      });
      console.log(`[TicketRecon] Re-queued ${requeueIds.length} escalated record(s) still awaiting ticketing.`);
    }
  } catch (err) {
    console.error('[TicketRecon] Re-queue step failed:', (err as Error).message);
  }

  // Find records that are due for polling
  const pendingRecords = await prisma.ticketingReconciliation.findMany({
    where: {
      status: { in: ['PENDING', 'POLLING'] },
      OR: [
        { nextPollAt: null },
        { nextPollAt: { lte: now } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: 20, // Process up to 20 at a time to avoid overloading
  });

  if (pendingRecords.length === 0) {
    return results;
  }

  for (const record of pendingRecords) {
    try {
      const result = await reconcileSingleBooking(record);
      results.push(result);
    } catch (err) {
      const error = err as Error;
      console.error(`[TicketRecon] Error processing ${record.providerUniqueId}:`, error.message);
      results.push({
        id: record.id,
        bookingId: record.bookingId,
        mfRef: record.providerUniqueId,
        previousStatus: record.status,
        newStatus: 'ERROR',
        action: 'ERROR',
        error: error.message,
      });

      // Update the record with error
      await prisma.ticketingReconciliation.update({
        where: { id: record.id },
        data: {
          errorMessage: error.message,
          pollCount: record.pollCount + 1,
          lastPollAt: now,
          nextPollAt: new Date(now.getTime() + getNextPollIntervalMs(record.pollCount + 1)),
        },
      });
    }
  }

  return results;
}

// ─── Single Booking Reconciliation ────────────────────────────────────────────

async function reconcileSingleBooking(record: any): Promise<ReconciliationResult> {
  const now = new Date();
  const mfRef = record.providerUniqueId;

  // Mark as actively polling
  await prisma.ticketingReconciliation.update({
    where: { id: record.id },
    data: { status: 'POLLING', lastPollAt: now },
  });

  // ── Step 1: Check AirTicketOrderStatus ──
  let ticketStatus: string | null = null;
  let ticketNumbers: string[] = [];
  let rawStatusResponse: any = null;

  try {
    const statusResult = await mystifly.getTicketOrderStatus(mfRef);
    rawStatusResponse = statusResult;

    // Real AirTicketOrderStatus shape:
    //   Data.TicketOrderStatuses: [{ StatusCode, StatusMessage, StatusDateTime }]
    // StatusMessage is "Placed" (order placed, not ticketed) → "Ticketed" once issued.
    // Take the LATEST status entry. Keep legacy fields as fallbacks.
    const orderStatuses = statusResult?.Data?.TicketOrderStatuses;
    const latest = Array.isArray(orderStatuses) && orderStatuses.length
      ? orderStatuses[orderStatuses.length - 1]
      : null;
    ticketStatus = latest?.StatusMessage ||
                   statusResult?.Data?.TktStatus ||
                   statusResult?.Data?.Status ||
                   statusResult?.Status || null;
    ticketNumbers = statusResult?.Data?.TicketNumbers ||
                    statusResult?.Data?.ETicketNumbers || [];
    console.log(`[TicketRecon] ${mfRef} AirTicketOrderStatus → "${ticketStatus ?? 'unknown'}"`);
  } catch (err) {
    console.warn(`[TicketRecon] AirTicketOrderStatus failed for ${mfRef}:`, (err as Error).message);
  }

  // ── Step 2: Fetch TripDetails on EVERY poll (persisted below) ──
  // Version-fallback TripDetails (v3 errors on some bookings) + the corrected
  // extraction path (Data.TripDetailsResult.TravelItinerary.PassengerInfos[]).
  let tripDetailsResponse: any = null;
  try {
    const tripResult = await mystifly.getTripDetailsResilient(mfRef);
    tripDetailsResponse = tripResult;
    for (const num of extractEticketNumbers(tripResult, rawStatusResponse)) {
      if (!ticketNumbers.includes(num)) ticketNumbers.push(num);
    }
  } catch (err) {
    console.warn(`[TicketRecon] TripDetails failed for ${mfRef}:`, (err as Error).message);
  }

  // ── Step 2a: Capture what the airline has already published ──
  // These ran only on the TICKETED transition, which is too late and sometimes
  // never: the airline publishes the record locator at BOOK time (BookingStatus
  // "Booked", TicketStatus "TktInProcess"), and a booking that stalls in
  // ticketing — or gives up at Case C1 — never reached the capture at all. The
  // customer needs the locator for check-in regardless of ticketing state.
  //
  // Safe to call on every poll: both backfills write nothing when the provider
  // has published nothing, and never overwrite a stored value with a blank.
  if (tripDetailsResponse) {
    try { await backfillAirlinePnr(record.bookingId, mfRef, tripDetailsResponse); }
    catch (err) { console.warn(`[TicketRecon] airline-PNR capture failed for ${mfRef}:`, (err as Error).message); }

    // Same reasoning for the fare-rule snapshot. It is written moments after Book
    // from the search view, which reports RefundAllowed=false for fares the airline
    // will actually refund; TripDetailsPTC_FareBreakdowns corrects it. Leaving that
    // until ticketing left bookings marked non-refundable and blocked self-service
    // refund/change in the meantime.
    try { await backfillFareRulesFromTripDetails(record.bookingId, mfRef, tripDetailsResponse); }
    catch (err) { console.warn(`[TicketRecon] fare-rules backfill failed for ${mfRef}:`, (err as Error).message); }
  }

  // ── Step 3: Determine outcome ──
  const mappedBookingStatus = mapProviderBookingStatus(ticketStatus);
  const mappedTicketingStatus = mapProviderTicketingStatus(ticketStatus);
  const newPollCount = record.pollCount + 1;

  // ── Case A: TICKETED — resolve successfully ──
  if (mappedBookingStatus === 'TICKETED' && ticketNumbers.length > 0) {
    await prisma.ticketingReconciliation.update({
      where: { id: record.id },
      data: {
        status: 'TICKETED',
        pollCount: newPollCount,
        lastPollAt: now,
        lastProviderStatus: ticketStatus,
        lastProviderResponse: rawStatusResponse,
        tripDetailsResponse: tripDetailsResponse,
        ticketNumbers: ticketNumbers,
        resolvedAt: now,
        resolvedBy: 'SYSTEM',
        resolutionNotes: `Auto-resolved after ${newPollCount} poll(s). Tickets: ${ticketNumbers.join(', ')}`,
      },
    });

    // Update the MasterBooking
    await prisma.masterBooking.update({
      where: { id: record.bookingId },
      data: {
        bookingStatus: 'TICKETED',
        ticketingStatus: 'ISSUED',
        providerBookingStatus: ticketStatus,
      },
    });

    // Persist the e-ticket number(s) onto booking_tickets so post-booking PTRs
    // (void/refund/reissue) carry a real eTicket. Best-effort — never fail the
    // reconciliation on a backfill error.
    try { await backfillEticketsFromTripDetails(record.bookingId, mfRef); }
    catch (err) { console.warn(`[TicketRecon] eTicket persist failed for ${mfRef}:`, (err as Error).message); }

    // If a cancellation was queued while the ticket was still issuing, execute it
    // now (void within the window + refund). Best-effort — never fail reconciliation.
    try { await executeQueuedCancellation(record.bookingId); }
    catch (err) { console.warn(`[TicketRecon] queued cancellation failed for ${mfRef}:`, (err as Error).message); }

    // Log timeline event
    await prisma.bookingEvent.create({
      data: {
        bookingId: record.bookingId,
        eventType: 'TICKETING_RESOLVED',
        eventTitle: 'Tickets Issued',
        eventDescription: `Ticketing reconciliation resolved — ${ticketNumbers.length} ticket(s) issued: ${ticketNumbers.join(', ')}. Resolved after ${newPollCount} poll(s).`,
        actorType: 'system',
        actorName: 'Ticketing Reconciliation',
        payloadJson: { ticketNumbers, pollCount: newPollCount, providerStatus: ticketStatus },
      },
    });

    await updateErbukTicket(record.bookingId, {
      status: 'RESOLVED',
      note: `Ticket issuance CONFIRMED by the carrier. Ticket number(s): ${ticketNumbers.join(', ')}. Resolved automatically after ${newPollCount} poll(s).`,
    });

    return {
      id: record.id,
      bookingId: record.bookingId,
      mfRef,
      previousStatus: record.status,
      newStatus: 'TICKETED',
      action: 'RESOLVED_TICKETED',
      ticketNumbers,
    };
  }

  // ── Case B: NOT_BOOKED / CANCELLED — resolve as failed ──
  if (mappedBookingStatus === 'NOT_BOOKED' || mappedBookingStatus === 'CANCELLED') {
    await prisma.ticketingReconciliation.update({
      where: { id: record.id },
      data: {
        status: 'NOT_BOOKED',
        pollCount: newPollCount,
        lastPollAt: now,
        lastProviderStatus: ticketStatus,
        lastProviderResponse: rawStatusResponse,
        tripDetailsResponse: tripDetailsResponse,
        resolvedAt: now,
        resolvedBy: 'SYSTEM',
        resolutionNotes: `Auto-resolved as NOT_BOOKED after ${newPollCount} poll(s). Provider status: ${ticketStatus}`,
      },
    });

    await prisma.masterBooking.update({
      where: { id: record.bookingId },
      data: {
        bookingStatus: 'NOT_BOOKED',
        ticketingStatus: 'FAILED',
        providerBookingStatus: ticketStatus,
      },
    });

    await prisma.bookingEvent.create({
      data: {
        bookingId: record.bookingId,
        eventType: 'TICKETING_FAILED',
        eventTitle: 'Booking Not Completed',
        eventDescription: `Ticketing reconciliation found status "${ticketStatus}". Booking was not completed by the provider. Manual review may be required for refund.`,
        actorType: 'system',
        actorName: 'Ticketing Reconciliation',
        payloadJson: { providerStatus: ticketStatus, pollCount: newPollCount },
      },
    });

    await updateErbukTicket(record.bookingId, {
      status: 'ESCALATED',
      note: `Carrier returned "${ticketStatus}" — the booking was NOT completed. Manual review may be required for refund. Resolved after ${newPollCount} poll(s).`,
    });

    return {
      id: record.id,
      bookingId: record.bookingId,
      mfRef,
      previousStatus: record.status,
      newStatus: 'NOT_BOOKED',
      action: 'RESOLVED_NOT_BOOKED',
    };
  }

  // ── Case C: Still pending ──
  // We keep polling on an extended backoff (minutes → 30-min tail) for up to
  // MAX_POLL_AGE_MS, because carrier ticketing can take hours. We only give up
  // (final escalation → stop) once the booking has been pending that long.
  const bookingAgeMs = now.getTime() - new Date(record.createdAt).getTime();

  // ── Case C1: Final give-up — stop auto-polling after the max window ──
  if (bookingAgeMs >= MAX_POLL_AGE_MS) {
    await prisma.ticketingReconciliation.update({
      where: { id: record.id },
      data: {
        status: 'ESCALATED',
        pollCount: newPollCount,
        lastPollAt: now,
        lastProviderStatus: ticketStatus,
        lastProviderResponse: rawStatusResponse,
        escalatedAt: record.escalatedAt ?? now,
        tripDetailsResponse: tripDetailsResponse,
        resolutionNotes: `Auto-polling exhausted after ~${Math.round(bookingAgeMs / 3_600_000)}h (${newPollCount} polls). Provider still returning: ${ticketStatus}. Manual review required.`,
      },
    });
    await prisma.bookingEvent.create({
      data: {
        bookingId: record.bookingId,
        eventType: 'TICKETING_ESCALATED',
        eventTitle: 'Ticketing Escalated',
        eventDescription: `Ticketing still pending after ~${Math.round(bookingAgeMs / 3_600_000)}h of automated polling (${newPollCount} polls). Escalated for manual review. Last provider status: ${ticketStatus}`,
        actorType: 'system',
        actorName: 'Ticketing Reconciliation',
        payloadJson: { providerStatus: ticketStatus, pollCount: newPollCount, ageHours: Math.round(bookingAgeMs / 3_600_000) },
      },
    }).catch(() => {});
    await updateErbukTicket(record.bookingId, {
      status: 'ESCALATED',
      note: `Ticketing still pending after ~${Math.round(bookingAgeMs / 3_600_000)}h of automated polling (last provider status: ${ticketStatus}). Escalated for manual review.`,
    });
    return { id: record.id, bookingId: record.bookingId, mfRef, previousStatus: record.status, newStatus: 'ESCALATED', action: 'ESCALATED' };
  }

  // ── Case C2: Slow alert (once) — flag ops it's taking a while, but KEEP polling ──
  const flagSlowNow = bookingAgeMs >= SLOW_ALERT_AGE_MS && !record.escalatedAt;
  if (flagSlowNow) {
    await prisma.bookingEvent.create({
      data: {
        bookingId: record.bookingId,
        eventType: 'TICKETING_SLOW',
        eventTitle: 'Ticketing taking longer than usual',
        eventDescription: `Ticket not yet issued after ${newPollCount} polls (provider status: ${ticketStatus}). Still auto-polling — no action needed unless it persists.`,
        actorType: 'system',
        actorName: 'Ticketing Reconciliation',
        payloadJson: { providerStatus: ticketStatus, pollCount: newPollCount },
      },
    }).catch(() => {});
    await updateErbukTicket(record.bookingId, {
      status: 'IN_PROGRESS',
      note: `Ticketing still pending after ${newPollCount} polls (last provider status: ${ticketStatus}). The system continues to auto-poll the airline; no manual action needed yet.`,
    }).catch(() => {});
  }

  // ── Case D: Schedule next poll (fixed 20s); keep the record active ──
  const nextInterval = getNextPollIntervalMs(newPollCount);
  const nextPollAt = new Date(now.getTime() + nextInterval);

  await prisma.ticketingReconciliation.update({
    where: { id: record.id },
    data: {
      status: 'PENDING',
      pollCount: newPollCount,
      lastPollAt: now,
      nextPollAt: nextPollAt,
      lastProviderStatus: ticketStatus,
      lastProviderResponse: rawStatusResponse,
      tripDetailsResponse: tripDetailsResponse, // persist every poll for visibility
      ...(flagSlowNow ? { escalatedAt: now } : {}), // one-time slow flag (dedupes the alert)
    },
  });

  return { id: record.id, bookingId: record.bookingId, mfRef, previousStatus: record.status, newStatus: 'STILL_PENDING', action: 'STILL_PENDING' };
}

// ─── ERBUK082 Support-Ticket Tracking ─────────────────────────────────────────

/**
 * Update the open ERBUK082 support ticket for a booking as its ticketing status
 * resolves, and append a customer/agent-visible action note. No-op if the
 * booking has no ERBUK082 ticket (e.g. hold/webfare pendings).
 *
 * @param bookingId  MasterBooking id (stored as the ticket's correlationId)
 * @param outcome    New ticket status + action note to append
 */
async function updateErbukTicket(
  bookingId: string,
  outcome: { status: 'IN_PROGRESS' | 'ESCALATED' | 'RESOLVED'; note: string },
): Promise<void> {
  try {
    const ticket = await prisma.supportTicket.findFirst({
      where: {
        correlationId: bookingId,
        category: 'ERBUK082',
        status: { notIn: ['RESOLVED', 'CLOSED'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!ticket) return;

    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status: outcome.status,
        ...(outcome.status === 'RESOLVED' ? { closedAt: new Date() } : {}),
        ...(outcome.status === 'ESCALATED' ? { escalatedAt: new Date() } : {}),
      },
    });

    // Customer/agent-visible action note (isInternal=false).
    await prisma.supportTicketMessage.create({
      data: { ticketId: ticket.id, senderId: null, isInternal: false, content: outcome.note },
    });
  } catch (err) {
    console.warn(`[TicketRecon] Failed to update ERBUK082 ticket for booking ${bookingId}:`, (err as Error).message);
  }
}

// ─── Queue a New Record ───────────────────────────────────────────────────────

/**
 * Create a new ticketing reconciliation record for a booking
 * that received TICKETING_PENDING status from Mystifly.
 */
export async function queueForReconciliation(params: {
  bookingId: string;
  providerUniqueId: string;
  fareSourceCode?: string;
}): Promise<string> {
  // Check if already queued
  const existing = await prisma.ticketingReconciliation.findFirst({
    where: {
      bookingId: params.bookingId,
      providerUniqueId: params.providerUniqueId,
      status: { in: ['PENDING', 'POLLING'] },
    },
  });

  if (existing) {
    return existing.id;
  }

  const record = await prisma.ticketingReconciliation.create({
    data: {
      bookingId: params.bookingId,
      providerUniqueId: params.providerUniqueId,
      fareSourceCode: params.fareSourceCode,
      status: 'PENDING',
      nextPollAt: new Date(), // Poll immediately
    },
  });

  return record.id;
}

// ─── Admin API: Get Pending Queue ─────────────────────────────────────────────

export async function getPendingQueue(): Promise<any[]> {
  return prisma.ticketingReconciliation.findMany({
    where: {
      status: { in: ['PENDING', 'POLLING', 'ESCALATED', 'MANUAL_REVIEW'] },
    },
    include: {
      booking: {
        select: {
          masterBookingReference: true,
          customerEmail: true,
          customerName: true,
          totalAmount: true,
          currency: true,
          primaryProvider: true,
        },
      },
    },
    orderBy: [
      { status: 'asc' }, // ESCALATED first
      { createdAt: 'asc' },
    ],
  });
}

// ─── Admin API: Manually Resolve ──────────────────────────────────────────────

export async function manuallyResolve(params: {
  reconciliationId: string;
  resolution: 'TICKETED' | 'NOT_BOOKED' | 'RESOLVED';
  ticketNumbers?: string[];
  adminEmail: string;
  notes?: string;
}): Promise<void> {
  const now = new Date();
  const record = await prisma.ticketingReconciliation.findUnique({
    where: { id: params.reconciliationId },
  });

  if (!record) throw new Error('Reconciliation record not found');

  // Update reconciliation record
  await prisma.ticketingReconciliation.update({
    where: { id: params.reconciliationId },
    data: {
      status: params.resolution === 'TICKETED' ? 'TICKETED' : 
              params.resolution === 'NOT_BOOKED' ? 'NOT_BOOKED' : 'RESOLVED',
      ticketNumbers: params.ticketNumbers || [],
      resolvedAt: now,
      resolvedBy: params.adminEmail,
      resolutionNotes: params.notes || `Manually resolved as ${params.resolution} by ${params.adminEmail}`,
    },
  });

  // Update MasterBooking
  if (params.resolution === 'TICKETED') {
    await prisma.masterBooking.update({
      where: { id: record.bookingId },
      data: {
        bookingStatus: 'TICKETED',
        ticketingStatus: 'ISSUED',
      },
    });
    await updateErbukTicket(record.bookingId, {
      status: 'RESOLVED',
      note: `Manually resolved as TICKETED by ${params.adminEmail}.` +
        (params.ticketNumbers?.length ? ` Ticket(s): ${params.ticketNumbers.join(', ')}.` : '') +
        (params.notes ? ` Notes: ${params.notes}` : ''),
    });
  } else if (params.resolution === 'NOT_BOOKED') {
    await prisma.masterBooking.update({
      where: { id: record.bookingId },
      data: {
        bookingStatus: 'NOT_BOOKED',
        ticketingStatus: 'FAILED',
      },
    });
    await updateErbukTicket(record.bookingId, {
      status: 'ESCALATED',
      note: `Manually resolved as NOT_BOOKED by ${params.adminEmail}. Manual review may be required for refund.` +
        (params.notes ? ` Notes: ${params.notes}` : ''),
    });
  }

  // Log timeline event
  await prisma.bookingEvent.create({
    data: {
      bookingId: record.bookingId,
      eventType: 'TICKETING_MANUALLY_RESOLVED',
      eventTitle: `Ticketing Manually Resolved: ${params.resolution}`,
      eventDescription: params.notes || `Resolved as ${params.resolution} by admin ${params.adminEmail}`,
      actorType: 'admin',
      actorName: params.adminEmail,
      payloadJson: {
        resolution: params.resolution,
        ticketNumbers: params.ticketNumbers,
        reconciliationId: params.reconciliationId,
      },
    },
  });
}
