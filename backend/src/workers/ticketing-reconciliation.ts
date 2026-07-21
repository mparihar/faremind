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
import {
  mapProviderBookingStatus,
  mapProviderTicketingStatus,
  isTerminalStatus,
  shouldPollStatus,
  getNextPollIntervalMs,
  MAX_AUTO_POLLS,
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

    ticketStatus = statusResult?.Data?.TktStatus || 
                   statusResult?.Data?.Status || 
                   statusResult?.Status || null;
    ticketNumbers = statusResult?.Data?.TicketNumbers || 
                    statusResult?.Data?.ETicketNumbers || [];
  } catch (err) {
    console.warn(`[TicketRecon] AirTicketOrderStatus failed for ${mfRef}:`, (err as Error).message);
  }

  // ── Step 2: If ticketed or failed, confirm with TripDetails ──
  let tripDetailsResponse: any = null;

  if (ticketStatus && isTerminalStatus(ticketStatus)) {
    try {
      const tripResult = await mystifly.getTripDetails(mfRef);
      tripDetailsResponse = tripResult;

      // Extract ticket numbers from trip details (more reliable)
      const travelers = tripResult?.Data?.TravelItinerary?.ItineraryInfo?.CustomerInfos || [];
      for (const traveler of travelers) {
        const eTickets = traveler?.ETicketNumbers || traveler?.TicketDocumentInfo || [];
        for (const ticket of eTickets) {
          const num = ticket?.eTicketNumber || ticket?.TicketNumber || ticket;
          if (num && typeof num === 'string' && !ticketNumbers.includes(num)) {
            ticketNumbers.push(num);
          }
        }
      }
    } catch (err) {
      console.warn(`[TicketRecon] TripDetails failed for ${mfRef}:`, (err as Error).message);
    }
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

  // ── Case C: Still pending — check if we should escalate ──
  if (newPollCount >= MAX_AUTO_POLLS) {
    await prisma.ticketingReconciliation.update({
      where: { id: record.id },
      data: {
        status: 'ESCALATED',
        pollCount: newPollCount,
        lastPollAt: now,
        lastProviderStatus: ticketStatus,
        lastProviderResponse: rawStatusResponse,
        escalatedAt: now,
        resolutionNotes: `Auto-escalated after ${newPollCount} polls. Provider still returning: ${ticketStatus}`,
      },
    });

    await prisma.bookingEvent.create({
      data: {
        bookingId: record.bookingId,
        eventType: 'TICKETING_ESCALATED',
        eventTitle: 'Ticketing Escalated',
        eventDescription: `Ticketing still pending after ${newPollCount} automated polls. Escalated for manual review. Last provider status: ${ticketStatus}`,
        actorType: 'system',
        actorName: 'Ticketing Reconciliation',
        payloadJson: { providerStatus: ticketStatus, pollCount: newPollCount },
      },
    });

    await updateErbukTicket(record.bookingId, {
      status: 'ESCALATED',
      note: `Ticketing still pending after ${newPollCount} automated polls (last provider status: ${ticketStatus}). Escalated for manual review.`,
    });

    return {
      id: record.id,
      bookingId: record.bookingId,
      mfRef,
      previousStatus: record.status,
      newStatus: 'ESCALATED',
      action: 'ESCALATED',
    };
  }

  // ── Case D: Schedule next poll ──
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
    },
  });

  return {
    id: record.id,
    bookingId: record.bookingId,
    mfRef,
    previousStatus: record.status,
    newStatus: 'STILL_PENDING',
    action: 'STILL_PENDING',
  };
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
