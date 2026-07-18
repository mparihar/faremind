/**
 * Provider Refund Reconciliation Cron — Background Worker
 *
 * Monitors provider reimbursement status for all pending refunds.
 * Uses progressive polling: 6h → 12h → 24h → overdue escalation.
 *
 * Registered in the Fastify startup lifecycle alongside limit-order-cron.
 */

import { prisma } from '../lib/db';
import { checkProviderReimbursement } from '../services/cancellation-orchestrator';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Start the refund reconciliation scheduler.
 * Called once during Fastify startup.
 */
export function startRefundReconciliationScheduler(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (schedulerInterval) {
    console.log('[refund-reconciliation-cron] Scheduler already running.');
    return;
  }

  console.log(`[refund-reconciliation-cron] Starting scheduler (interval: ${intervalMs / 1000}s)`);

  // Run first cycle after a short delay (don't block startup)
  setTimeout(runReconciliationCycle, 30_000);

  // Then schedule recurring
  schedulerInterval = setInterval(runReconciliationCycle, intervalMs);
}

/**
 * Stop the refund reconciliation scheduler.
 * Called during Fastify shutdown.
 */
export function stopRefundReconciliationScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[refund-reconciliation-cron] Scheduler stopped.');
  }
}

/**
 * Single reconciliation cycle.
 * Queries all due BookingRefund records and checks their provider status.
 */
async function runReconciliationCycle(): Promise<void> {
  const startTime = Date.now();
  console.log('[refund-reconciliation-cron] ⏰ Running reconciliation cycle...');

  try {
    // Query only due records — not every record in the DB
    const dueRefunds = await prisma.bookingRefund.findMany({
      where: {
        providerReimbursementStatus: { in: ['PENDING', 'PROCESSING'] },
        nextProviderStatusCheckAt: { lte: new Date() },
      },
      select: { id: true, bookingId: true, provider: true, providerRefundRequestId: true },
      take: 50, // Process max 50 per cycle to avoid overload
    });

    if (dueRefunds.length === 0) {
      console.log('[refund-reconciliation-cron] No due refunds to check.');
      return;
    }

    console.log(`[refund-reconciliation-cron] Found ${dueRefunds.length} due refund(s) to check.`);

    let successCount = 0;
    let errorCount = 0;

    for (const refund of dueRefunds) {
      try {
        await checkProviderReimbursement(refund.id);
        successCount++;
      } catch (err) {
        errorCount++;
        console.error(
          `[refund-reconciliation-cron] Error checking refund ${refund.id} (booking ${refund.bookingId}):`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[refund-reconciliation-cron] ✅ Cycle complete: ${successCount} checked, ${errorCount} errors (${elapsed}s)`,
    );
  } catch (err) {
    console.error('[refund-reconciliation-cron] ❌ Cycle failed:', err);
  }
}

export default {
  startRefundReconciliationScheduler,
  stopRefundReconciliationScheduler,
};
