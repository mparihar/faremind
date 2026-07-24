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

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export function startReissueReconciliationScheduler(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (schedulerInterval) {
    console.log('[reissue-reconciliation-cron] Scheduler already running.');
    return;
  }

  console.log(`[reissue-reconciliation-cron] Starting scheduler (interval: ${intervalMs / 1000}s)`);

  // Run first cycle after a short delay (don't block startup)
  setTimeout(runReissueReconciliationCycle, 45_000);

  schedulerInterval = setInterval(runReissueReconciliationCycle, intervalMs);
}

export function stopReissueReconciliationScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
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

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[reissue-reconciliation-cron] ✅ Cycle complete: ${successCount} checked, ${errorCount} errors (${elapsed}s)`,
    );
  } catch (err) {
    console.error('[reissue-reconciliation-cron] ❌ Cycle failed:', err);
  }
}

export default {
  startReissueReconciliationScheduler,
  stopReissueReconciliationScheduler,
};
