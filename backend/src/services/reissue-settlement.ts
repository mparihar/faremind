/**
 * Reissue (Flight Change) Settlement Reconciliation
 *
 * Accepting a Mystifly ReIssue Quote returns PTRStatus=InProcess; the provider
 * ops team fulfils the reissue within the SLA (Resolution=Reissued). This closes
 * the gap where change/confirm marked the change CONFIRMED at accept time and
 * never verified fulfilment.
 *
 * checkReissueSettlement() is called by the reissue-reconciliation cron for each
 * due ChangeRequest (status=PROVIDER_PROCESSING). It polls the ReIssue PTR and:
 *   - Reissued          → mark CONFIRMED, refresh TripDetails, notify customer
 *   - Rejected / Failed → refund the collected difference, mark REJECTED, escalate
 *   - Still InProcess   → reschedule the next poll (progressive back-off)
 *
 * Mirrors the refund reconciliation pattern (cancellation-orchestrator).
 */

import { prisma } from '../lib/db';
import { getProvider } from './provider-adapter';
import { refundCollection } from './customer-collect';
import { getTripDetails } from './mystifly';
import * as mbq from '../lib/manage-booking-queries';
import { fireNotification } from '../lib/notify';

// Escalate to a support ticket if the reissue has not settled after this long.
const ESCALATE_AFTER_HOURS = 30;

/**
 * Progressive poll back-off (hours) by attempt number.
 * First check ~30 min after accept, then widen out to 12h.
 */
function nextCheckDelayMs(attempt: number): number {
  const hours = attempt <= 1 ? 0.5 : attempt === 2 ? 1 : attempt === 3 ? 3 : attempt === 4 ? 6 : 12;
  return hours * 60 * 60 * 1000;
}

/**
 * Check one ChangeRequest's reissue settlement status.
 * Called by the reissue-reconciliation cron for each due record.
 */
export async function checkReissueSettlement(changeRequestId: string): Promise<void> {
  const cr = await prisma.changeRequest.findUnique({ where: { id: changeRequestId } });
  if (!cr || cr.status !== 'PROVIDER_PROCESSING') return;
  if (!cr.providerPtrId || !cr.providerMfRef) {
    // Nothing to poll — leave for manual review rather than looping forever.
    console.warn(`[reissue-settlement] ChangeRequest ${cr.id} missing providerPtrId/mfRef; skipping.`);
    await prisma.changeRequest.update({
      where: { id: cr.id },
      data: { nextCheckAt: null, lastCheckedAt: new Date() },
    });
    return;
  }

  const attempt = cr.statusCheckCount + 1;
  const booking = await mbq.getMasterBookingFull(cr.bookingId);
  const provider = getProvider(booking?.primaryProvider || 'mystifly');

  const providerStatus = await provider.getProviderReissueStatus(cr.providerPtrId, cr.providerMfRef);
  const now = new Date();

  // ── Reissue fulfilled ────────────────────────────────────────────────
  if (providerStatus.status === 'SETTLED') {
    await prisma.changeRequest.update({
      where: { id: cr.id },
      data: {
        status: 'CONFIRMED',
        confirmedAt: now,
        lastCheckedAt: now,
        statusCheckCount: attempt,
        nextCheckAt: null,
        providerResponse: (providerStatus.rawResponse as any) ?? undefined,
      },
    });

    // Refresh the itinerary from the provider (best-effort).
    if ((booking?.primaryProvider || '').toLowerCase() === 'mystifly') {
      try {
        const trip = await getTripDetails(cr.providerMfRef);
        await prisma.bookingProviderPayload.create({
          data: {
            bookingId: cr.bookingId,
            provider: 'mystifly',
            payloadType: 'REISSUE_FULFILLED',
            providerReference: cr.providerMfRef,
            payloadJson: trip as any,
          },
        }).catch(() => null);
      } catch (err) {
        console.error(`[reissue-settlement] TripDetails refresh failed for ${cr.providerMfRef}:`, err instanceof Error ? err.message : err);
      }
    }

    await mbq.createBookingEvent({
      bookingId: cr.bookingId,
      eventType: 'CHANGE_CONFIRMED',
      eventTitle: 'Flight change fulfilled',
      eventDescription: `Provider reissue completed (PTR ${cr.providerPtrId}). Resolved after ${attempt} check(s).`,
      actorType: 'system',
    });

    if (booking?.customerEmail) {
      fireNotification({
        event_type: 'FLIGHT_CHANGE_CONFIRMED',
        booking_id: cr.bookingId,
        customer_email: booking.customerEmail || undefined,
        data: {
          booking_reference: booking.masterBookingReference,
          customer_name: booking.customerName ?? '',
        },
      });
    }

    console.log(`[reissue-settlement] ChangeRequest ${cr.id} SETTLED (PTR ${cr.providerPtrId}).`);
    return;
  }

  // ── Reissue rejected / failed → refund the collected difference ───────
  if (providerStatus.status === 'REJECTED' || providerStatus.status === 'FAILED') {
    let refundNote = '';
    if (cr.collectedChargeId) {
      try {
        await refundCollection(cr.collectedChargeId);
        refundNote = ` Collected amount ($${Number(cr.collectedAmount ?? 0).toFixed(2)}) refunded to the original card.`;
        console.log(`[reissue-settlement] Refunded collection ${cr.collectedChargeId} after reissue rejection.`);
      } catch (err) {
        refundNote = ` CRITICAL: refund of ${cr.collectedChargeId} FAILED — manual refund required.`;
        console.error(`[reissue-settlement] Refund of ${cr.collectedChargeId} failed:`, err instanceof Error ? err.message : err);
      }
    }

    const reason = `Provider reissue not fulfilled (PTR ${cr.providerPtrId}, status "${providerStatus.rawStatus}").${refundNote}`;

    await prisma.changeRequest.update({
      where: { id: cr.id },
      data: {
        status: 'REJECTED',
        rejectedAt: now,
        rejectionReason: reason,
        lastCheckedAt: now,
        statusCheckCount: attempt,
        nextCheckAt: null,
        providerResponse: (providerStatus.rawResponse as any) ?? undefined,
      },
    });

    await mbq.createBookingEvent({
      bookingId: cr.bookingId,
      eventType: 'CHANGE_REJECTED',
      eventTitle: 'Flight change failed',
      eventDescription: reason,
      actorType: 'system',
    });

    if (booking) {
      await prisma.supportTicket.create({
        data: {
          subject: `Flight change failed: ${booking.masterBookingReference} — ${booking.customerName ?? 'Customer'}`,
          description: [
            `The provider did not fulfil the reissue for booking ${booking.masterBookingReference}.`,
            '',
            `PTR ID: ${cr.providerPtrId}`,
            `Provider Ref: ${cr.providerMfRef}`,
            `Provider status: ${providerStatus.rawStatus}`,
            `Collected: $${Number(cr.collectedAmount ?? 0).toFixed(2)}${cr.collectedChargeId ? ` (charge ${cr.collectedChargeId})` : ''}`,
            refundNote.trim() || 'No collection to refund.',
          ].join('\n'),
          priority: refundNote.includes('CRITICAL') ? 'HIGH' : 'NORMAL',
          status: 'OPEN',
          category: 'Change Request',
          channel: 'SYSTEM',
          customerName: booking.customerName ?? '',
          customerEmail: booking.customerEmail ?? '',
          bookingRef: booking.masterBookingReference,
          airlinePnr: booking.masterPnr ?? undefined,
          ticketType: 'FLIGHT_CHANGE',
          queue: 'CANCELLATION_SUPPORT',
          providerPnr: cr.providerMfRef ?? undefined,
          providerBookingRef: cr.providerMfRef ?? undefined,
        },
      }).catch((err) => console.error('[reissue-settlement] support ticket create failed:', err instanceof Error ? err.message : err));
    }

    console.log(`[reissue-settlement] ChangeRequest ${cr.id} REJECTED (PTR ${cr.providerPtrId}).`);
    return;
  }

  // ── Still processing → reschedule the next poll ───────────────────────
  const ageHours = (Date.now() - cr.createdAt.getTime()) / (1000 * 60 * 60);
  const nextCheckAt = new Date(Date.now() + nextCheckDelayMs(attempt));

  await prisma.changeRequest.update({
    where: { id: cr.id },
    data: {
      lastCheckedAt: now,
      statusCheckCount: attempt,
      nextCheckAt,
    },
  });

  // Escalate (once) if the reissue is overdue but still not resolved.
  if (ageHours > ESCALATE_AFTER_HOURS && booking) {
    const existing = await prisma.supportTicket.findFirst({
      where: { bookingRef: booking.masterBookingReference, ticketType: 'FLIGHT_CHANGE', status: { in: ['OPEN', 'IN_PROGRESS'] } },
      select: { id: true },
    });
    if (!existing) {
      await prisma.supportTicket.create({
        data: {
          subject: `Reissue overdue: ${booking.masterBookingReference} — awaiting provider fulfilment`,
          description: `Reissue PTR ${cr.providerPtrId} (${cr.providerMfRef}) still "${providerStatus.rawStatus}" after ${ageHours.toFixed(1)}h. Please follow up with the provider ops team.`,
          priority: 'HIGH',
          status: 'OPEN',
          category: 'Change Request',
          channel: 'SYSTEM',
          customerName: booking.customerName ?? '',
          customerEmail: booking.customerEmail ?? '',
          bookingRef: booking.masterBookingReference,
          airlinePnr: booking.masterPnr ?? undefined,
          ticketType: 'FLIGHT_CHANGE',
          queue: 'CANCELLATION_SUPPORT',
          providerPnr: cr.providerMfRef ?? undefined,
          providerBookingRef: cr.providerMfRef ?? undefined,
        },
      }).catch(() => null);
    }
  }

  console.log(`[reissue-settlement] ChangeRequest ${cr.id} still ${providerStatus.status} (attempt ${attempt}); next check ${nextCheckAt.toISOString()}.`);
}
