/**
 * Reissue Settlement Reconciliation Cron — Background Worker
 *
 * Monitors async Mystifly ReIssue PTRs for bookings whose flight change was
 * accepted (PTRStatus=InProcess) but not yet fulfilled. Polls each due
 * ChangeRequest and settles it (CONFIRMED / REJECTED+refund) via
 * checkReissueSettlement. Runs on a short interval because the first poll is
 * scheduled ~30 min after accept.
 *
 * Registered in the Fastify startup lifecycle alongside the other reconcilers.
 */

import { prisma } from '../lib/db';
import { checkReissueSettlement } from '../services/reissue-settlement';
import { syncItineraryFromTripDetails } from '../services/itinerary-sync';
import { searchPtrStatus } from '../services/mystifly';
import { getPtrPollFrequencyMs } from '../lib/ptr-poll-config';

let schedulerTimeout: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

export function startReissueReconciliationScheduler(): void {
  if (schedulerTimeout) {
    console.log('[reissue-reconciliation-cron] Scheduler already running.');
    return;
  }
  stopped = false;
  console.log('[reissue-reconciliation-cron] Starting scheduler (interval: admin-configurable, default 3h)');

  // Run first cycle after a short delay (don't block startup), then
  // self-reschedule at the configured rate so a settings change is picked up
  // on the next tick.
  schedulerTimeout = setTimeout(runAndReschedule, 45_000);
}

async function runAndReschedule(): Promise<void> {
  if (stopped) return;
  await runReissueReconciliationCycle();
  if (stopped) return;

  const intervalMs = await getPtrPollFrequencyMs();
  console.log(`[reissue-reconciliation-cron] Next cycle in ${Math.round(intervalMs / 60_000)} min`);
  schedulerTimeout = setTimeout(runAndReschedule, intervalMs);
}

export function stopReissueReconciliationScheduler(): void {
  stopped = true;
  if (schedulerTimeout) {
    clearTimeout(schedulerTimeout);
    schedulerTimeout = null;
    console.log('[reissue-reconciliation-cron] Scheduler stopped.');
  }
}

async function runReissueReconciliationCycle(): Promise<void> {
  const startTime = Date.now();
  console.log('[reissue-reconciliation-cron] ⏰ Running reissue reconciliation cycle...');

  try {
    const due = await prisma.changeRequest.findMany({
      where: {
        status: 'PROVIDER_PROCESSING',
        nextCheckAt: { lte: new Date() },
      },
      select: { id: true, bookingId: true },
      take: 50,
    });

    if (due.length === 0) {
      console.log('[reissue-reconciliation-cron] No due reissues to check.');
      return;
    }

    console.log(`[reissue-reconciliation-cron] Found ${due.length} due reissue(s) to check.`);

    let successCount = 0;
    let errorCount = 0;

    for (const cr of due) {
      try {
        await checkReissueSettlement(cr.id);
        successCount++;
      } catch (err) {
        errorCount++;
        console.error(
          `[reissue-reconciliation-cron] Error checking reissue ${cr.id} (booking ${cr.bookingId}):`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    await sweepUnlinkedReissues();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[reissue-reconciliation-cron] ✅ Cycle complete: ${successCount} checked, ${errorCount} errors (${elapsed}s)`,
    );
  } catch (err) {
    console.error('[reissue-reconciliation-cron] ❌ Cycle failed:', err);
  }
}

/**
 * Reissues the airline completed that we never linked to a ChangeRequest.
 *
 * checkReissueSettlement only polls rows in PROVIDER_PROCESSING carrying a
 * providerPtrId. FMVTT9ZQ had a DATE_CHANGE stuck at NEW with providerPtrId
 * null while the provider held ReIssue PTR 22884, Resolution "Reissued" — so
 * nothing ever settled it and the customer kept seeing the old flights. Anything
 * that leaves a change request unlinked lands here.
 *
 * Scoped to bookings where a change was actually attempted, so this is not a
 * scan of every booking.
 */
async function sweepUnlinkedReissues(): Promise<void> {
  try {
    const stale = new Date(Date.now() - 30 * 60 * 1000);
    const orphans = await prisma.changeRequest.findMany({
      where: {
        status: { in: ['NEW', 'QUOTED', 'CUSTOMER_PAYMENT_PENDING'] },
        providerPtrId: null,
        createdAt: { lte: stale },
        booking: { primaryProvider: 'mystifly', bookingStatus: { notIn: ['CANCELLED', 'FAILED'] } },
      },
      select: { id: true, bookingId: true, booking: { select: { mystiflyMfRef: true, masterBookingReference: true } } },
      take: 20,
    });
    if (orphans.length === 0) return;

    for (const cr of orphans) {
      const mfRef = cr.booking?.mystiflyMfRef;
      if (!mfRef) continue;
      try {
        const list = await searchPtrStatus(mfRef);
        const details = list?.Data?.PTRDetail ?? list?.PTRDetail ?? [];
        const reissued = (Array.isArray(details) ? details : []).find(
          (d: any) => /reissue/i.test(String(d?.PTRType ?? '')) && /reissued/i.test(String(d?.Resolution ?? '')),
        );
        if (!reissued) continue;

        console.warn(
          `[reissue-reconciliation-cron] ${cr.booking?.masterBookingReference}: provider reports PTR ${reissued.PTRId} Reissued but ChangeRequest ${cr.id} was never linked — syncing itinerary.`,
        );
        const result = await syncItineraryFromTripDetails(cr.bookingId, mfRef);
        await prisma.changeRequest.update({
          where: { id: cr.id },
          data: {
            status: result.applied ? 'CONFIRMED' : 'PROVIDER_PROCESSING',
            providerPtrId: String(reissued.PTRId),
            providerMfRef: mfRef,
          },
        }).catch(() => {});
      } catch (err) {
        console.error(`[reissue-reconciliation-cron] unlinked-reissue check failed for ${mfRef}:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[reissue-reconciliation-cron] unlinked-reissue sweep failed:', err instanceof Error ? err.message : err);
  }
}

export default {
  startReissueReconciliationScheduler,
  stopReissueReconciliationScheduler,
};
