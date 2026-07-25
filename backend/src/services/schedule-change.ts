/**
 * Schedule Change (IROPS) — detection + handling.
 *
 * Airlines revise already-ticketed flights (time/flight/routing changes, cancels).
 * Mystifly surfaces these on a provider queue. This service:
 *   - detection: polls /api/Search/GetQueue, resolves each item to a booking,
 *     and upserts a ScheduleChange record (+ booking event, notification, ticket).
 *   - handling: Accept / Refund / ReIssue via /api/ScheduleChange, then refreshes
 *     TripDetails.
 *
 * Only items with ScheduleChangeType != 0 are real changes (GetQueue is a general
 * worklist listing every ticketed booking with type 0). Each real item's raw JSON
 * is stored on ScheduleChange.queueItemJson so the parser can be tightened against
 * the first real change. Detection never dequeues (read-only), and persistence is
 * idempotent per booking, so items re-appearing on the queue don't duplicate.
 */

import { prisma } from '../lib/db';
import * as mystifly from '../services/mystifly';
import * as mbq from '../lib/manage-booking-queries';
import { fireNotification } from '../lib/notify';

const MAX_QUEUE_PAGES = 10;

/** Pull an MFRef-like value out of an unknown queue item. */
function extractMfRef(item: any): string | null {
  if (!item || typeof item !== 'object') return null;
  for (const k of ['MFRef', 'MfRef', 'mfRef', 'UniqueID', 'UniqueId', 'uniqueId', 'BookingRef', 'ReferenceNo', 'PNR', 'ReferenceNumber']) {
    const v = item[k];
    if (typeof v === 'string' && /^MF/i.test(v.trim())) return v.trim();
  }
  // Fallback: scan any string value that looks like an MFRef.
  for (const v of Object.values(item)) {
    if (typeof v === 'string' && /^MF\d{6,}/i.test(v.trim())) return v.trim();
  }
  return null;
}

/**
 * Whether a queue item is an ACTUAL airline schedule change. Mystifly's GetQueue
 * is a general post-ticketing worklist — it lists every ticketed booking with
 * ScheduleChangeType=0 (no change). Only ScheduleChangeType != 0 is a real change.
 */
function isRealScheduleChange(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  const t = Number(item.ScheduleChangeType ?? item.scheduleChangeType);
  return Number.isFinite(t) && t !== 0;
}

/** Best-effort human summary from a real schedule-change queue item. */
function summarize(item: any): string {
  if (!item || typeof item !== 'object') return 'Airline schedule change — review required.';
  const explicit = item.Subject || item.Message || item.Description;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const airline = item.airlineCode || item.AirlineCode || '';
  const route = (item.origin && item.destination) ? `${item.origin} → ${item.destination}` : '';
  const date = item.travelDate ? new Date(item.travelDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const bits = [airline && `${airline}`, route, date && `(${date})`].filter(Boolean).join(' ');
  return bits ? `Airline schedule change — ${bits}. Please review.` : 'Airline schedule change — review required.';
}

async function resolveBooking(mfRef: string) {
  return prisma.masterBooking.findFirst({
    where: {
      OR: [
        { masterPnr: mfRef },
        { providerOrderId: mfRef },
        { pnrs: { some: { providerOrderId: mfRef } } },
      ],
    },
  });
}

/**
 * Poll the provider queue and persist any schedule changes. Called by the cron.
 */
export async function runScheduleChangeDetection(): Promise<{ items: number; upserted: number }> {
  let page = 1;
  let totalItems = 0;
  let upserted = 0;
  const seen = new Set<string>();

  while (page <= MAX_QUEUE_PAGES) {
    let res: any;
    try {
      res = await mystifly.searchQueue(page);
    } catch (err) {
      console.error('[schedule-change] GetQueue failed:', err instanceof Error ? err.message : err);
      break;
    }
    const items: any[] = Array.isArray(res?.Data) ? res.Data : [];
    totalItems += items.length;
    if (items.length === 0) break;

    for (const item of items) {
      const mfRef = extractMfRef(item);
      if (!mfRef || seen.has(mfRef)) continue;
      seen.add(mfRef);

      // Skip general queue entries that aren't real schedule changes
      // (GetQueue lists every ticketed booking with ScheduleChangeType=0).
      if (!isRealScheduleChange(item)) continue;

      const booking = await resolveBooking(mfRef);
      if (!booking) {
        console.warn(`[schedule-change] queue item for ${mfRef} — no matching booking; skipping.`);
        continue;
      }

      const existing = await prisma.scheduleChange.findUnique({ where: { bookingId: booking.id } });
      if (existing && existing.status !== 'DETECTED' && existing.status !== 'NOTIFIED') {
        // Already being handled/resolved — refresh the raw item only.
        await prisma.scheduleChange.update({ where: { bookingId: booking.id }, data: { queueItemJson: item as any, lastCheckedAt: new Date() } });
        continue;
      }

      const summary = summarize(item);
      if (existing) {
        await prisma.scheduleChange.update({
          where: { bookingId: booking.id },
          data: { queueItemJson: item as any, summary, providerRef: mfRef, lastCheckedAt: new Date() },
        });
      } else {
        await prisma.scheduleChange.create({
          data: { bookingId: booking.id, providerRef: mfRef, status: 'DETECTED', summary, queueItemJson: item as any },
        });
        upserted++;

        await mbq.createBookingEvent({
          bookingId: booking.id,
          eventType: 'SCHEDULE_CHANGE_DETECTED',
          eventTitle: 'Airline schedule change',
          eventDescription: summary,
          actorType: 'system',
        });

        // Notify the customer + open an ops ticket.
        if (booking.customerEmail) {
          fireNotification({
            event_type: 'SCHEDULE_CHANGE',
            booking_id: booking.id,
            customer_email: booking.customerEmail || undefined,
            data: { booking_reference: booking.masterBookingReference, customer_name: booking.customerName ?? '', summary },
          });
        }
        await prisma.supportTicket.create({
          data: {
            subject: `Schedule change: ${booking.masterBookingReference} — ${booking.customerName ?? 'Customer'}`,
            description: `Airline schedule change detected for ${booking.masterBookingReference} (${mfRef}).\n\n${summary}\n\nReview and accept / refund / reissue.`,
            priority: 'HIGH',
            status: 'OPEN',
            category: 'Schedule Change',
            channel: 'SYSTEM',
            customerName: booking.customerName ?? '',
            customerEmail: booking.customerEmail ?? '',
            bookingRef: booking.masterBookingReference,
            airlinePnr: booking.masterPnr ?? undefined,
            ticketType: 'SCHEDULE_CHANGE',
            queue: 'CANCELLATION_SUPPORT',
            providerPnr: mfRef,
          },
        }).catch((e) => console.error('[schedule-change] support ticket failed:', e instanceof Error ? e.message : e));

        await prisma.scheduleChange.update({ where: { bookingId: booking.id }, data: { status: 'NOTIFIED', notifiedAt: new Date() } });
        console.log(`[schedule-change] detected + notified for ${booking.masterBookingReference} (${mfRef}).`);
      }
    }

    const totalPages = Number(res?.TotalPages) || 1;
    if (page >= totalPages) break;
    page++;
  }

  return { items: totalItems, upserted };
}

// ── Handling ───────────────────────────────────────────────────────────

async function loadActive(bookingId: string) {
  const sc = await prisma.scheduleChange.findUnique({ where: { bookingId } });
  if (!sc) throw new Error('No schedule change on this booking.');
  const booking = await mbq.getMasterBookingFull(bookingId);
  if (!booking) throw new Error('Booking not found.');
  const mfRef = sc.providerRef || booking.pnrs.find((p: any) => p.providerOrderId)?.providerOrderId || booking.masterPnr;
  if (!mfRef) throw new Error('No provider reference for this booking.');
  return { sc, booking, mfRef };
}

/** Accept the revised schedule (ActionType=Accept). */
export async function acceptScheduleChange(bookingId: string, actor: string): Promise<any> {
  const { booking, mfRef } = await loadActive(bookingId);
  const result = await mystifly.applyScheduleChange(mfRef, 'Accept', { allowRevalidation: true });
  const ok = (result?.Data?.Success ?? result?.Success) !== false;
  await prisma.scheduleChange.update({
    where: { bookingId },
    data: { status: ok ? 'RESOLVED' : 'FAILED', actionTaken: 'ACCEPT', policyJson: result as any, resolvedAt: ok ? new Date() : null },
  });
  // Refresh itinerary best-effort.
  try { await mystifly.getTripDetailsResilient(mfRef); } catch { /* ignore */ }
  await mbq.createBookingEvent({
    bookingId, eventType: ok ? 'SCHEDULE_CHANGE_ACCEPTED' : 'SCHEDULE_CHANGE_FAILED',
    eventTitle: ok ? 'Schedule change accepted' : 'Schedule change accept failed',
    eventDescription: `By ${actor}. ${ok ? 'New airline schedule confirmed.' : 'Provider rejected the accept.'}`,
    actorType: 'system',
  });
  if (ok && booking.customerEmail) {
    fireNotification({ event_type: 'SCHEDULE_CHANGE_ACCEPTED', booking_id: bookingId, customer_email: booking.customerEmail || undefined,
      data: { booking_reference: booking.masterBookingReference, customer_name: booking.customerName ?? '' } });
  }
  return { success: ok, raw: result };
}

/** Request a refund for an unacceptable schedule change (ActionType=Refund). */
export async function refundScheduleChange(bookingId: string, actor: string): Promise<any> {
  const { mfRef } = await loadActive(bookingId);
  const result = await mystifly.applyScheduleChange(mfRef, 'Refund', { rejectOption: 'ApplyforRefund' });
  const ok = (result?.Data?.Success ?? result?.Success) !== false;
  await prisma.scheduleChange.update({
    where: { bookingId },
    data: { status: ok ? 'REFUND_REQUESTED' : 'FAILED', actionTaken: 'REFUND', policyJson: result as any },
  });
  await mbq.createBookingEvent({
    bookingId, eventType: 'SCHEDULE_CHANGE_REFUND', eventTitle: 'Schedule-change refund requested',
    eventDescription: `By ${actor}. Provider refund requested for the airline schedule change; Finance/ops to reconcile customer refund.`,
    actorType: 'system',
  });
  return { success: ok, raw: result };
}

/** Request a reissue onto an acceptable alternative (ActionType=ReIssue). */
export async function reissueScheduleChange(bookingId: string, actor: string): Promise<any> {
  const { mfRef } = await loadActive(bookingId);
  const result = await mystifly.applyScheduleChange(mfRef, 'ReIssue', { allowReissue: true });
  const ok = (result?.Data?.Success ?? result?.Success) !== false;
  await prisma.scheduleChange.update({
    where: { bookingId },
    data: { status: ok ? 'REISSUE_REQUESTED' : 'FAILED', actionTaken: 'REISSUE', policyJson: result as any },
  });
  await mbq.createBookingEvent({
    bookingId, eventType: 'SCHEDULE_CHANGE_REISSUE', eventTitle: 'Schedule-change reissue requested',
    eventDescription: `By ${actor}. Reissue requested against the revised airline schedule.`,
    actorType: 'system',
  });
  return { success: ok, raw: result };
}
