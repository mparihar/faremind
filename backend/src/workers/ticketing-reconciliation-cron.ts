/**
 * Ticketing Reconciliation Cron — Background Worker
 *
 * Periodically drains the TicketingReconciliation queue by invoking
 * runTicketingReconciliation(), which polls Mystifly (AirTicketOrderStatus +
 * TripDetails) for bookings left in TICKETING_PENDING and resolves them to
 * TICKETED / NOT_BOOKED, or escalates to manual review after MAX_AUTO_POLLS.
 *
 * Per-record cadence (backoff: 0s → 15s → 30s → 60s → 2m → 5m → 10m) is managed
 * inside the worker via each record's nextPollAt; this cron just fires often
 * enough to pick up records that are due.
 *
 * Registered in the Fastify startup lifecycle alongside the other schedulers.
 * Opt out with DISABLE_SCHEDULERS=true (e.g. local runs against the prod DB).
 */
import { runTicketingReconciliation } from './ticketing-reconciliation';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const DEFAULT_INTERVAL_MS = 30 * 1000; // 30 seconds

export function startTicketingReconciliationScheduler(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (schedulerInterval) {
    console.log('[ticketing-reconciliation-cron] Scheduler already running.');
    return;
  }

  console.log(`[ticketing-reconciliation-cron] Starting scheduler (interval: ${intervalMs / 1000}s)`);

  // First run shortly after boot (don't block startup).
  setTimeout(runCycle, 20_000);

  // Then poll on the interval.
  schedulerInterval = setInterval(runCycle, intervalMs);
}

export function stopTicketingReconciliationScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[ticketing-reconciliation-cron] Scheduler stopped.');
  }
}

async function runCycle(): Promise<void> {
  try {
    const results = await runTicketingReconciliation();
    if (results.length > 0) {
      const resolved = results.filter(r => r.action === 'RESOLVED_TICKETED').length;
      const failed = results.filter(r => r.action === 'RESOLVED_NOT_BOOKED').length;
      const escalated = results.filter(r => r.action === 'ESCALATED').length;
      const pending = results.filter(r => r.action === 'STILL_PENDING').length;
      console.log(
        `[ticketing-reconciliation-cron] Cycle: ${results.length} processed | ` +
        `ticketed=${resolved} notBooked=${failed} escalated=${escalated} pending=${pending}`
      );
    }
  } catch (err) {
    console.error('[ticketing-reconciliation-cron] Cycle failed:', err);
  }
}

export default {
  startTicketingReconciliationScheduler,
  stopTicketingReconciliationScheduler,
};
