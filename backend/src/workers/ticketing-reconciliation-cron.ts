/**
 * Ticketing Reconciliation Cron — Background Worker
 *
 * Periodically drains the TicketingReconciliation queue by invoking
 * runTicketingReconciliation(), which polls Mystifly (AirTicketOrderStatus +
 * TripDetails) for bookings left in TICKETING_PENDING and resolves them to
 * TICKETED / NOT_BOOKED, or escalates to manual review after MAX_AUTO_POLLS.
 *
 * Cadence is admin-configurable via SystemConfig `ticketing_poll_frequency_minutes`
 * (default 3 hours; see lib/ticketing-poll-config.ts). The cron self-schedules at
 * that interval — it re-reads the config after every cycle, so a change from the
 * admin console takes effect on the next cycle without a redeploy. Each record's
 * nextPollAt uses the same value inside the worker.
 *
 * Registered in the Fastify startup lifecycle alongside the other schedulers.
 * Opt out with DISABLE_SCHEDULERS=true (e.g. local runs against the prod DB).
 */
import { runTicketingReconciliation } from './ticketing-reconciliation';
import { getTicketingPollFrequencyMs } from '../lib/ticketing-poll-config';

let schedulerTimeout: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

export function startTicketingReconciliationScheduler(): void {
  if (schedulerTimeout || (stopped === false && schedulerTimeout)) {
    console.log('[ticketing-reconciliation-cron] Scheduler already running.');
    return;
  }
  stopped = false;

  console.log('[ticketing-reconciliation-cron] Starting scheduler (interval: admin-configurable, default 3h)');

  // First run shortly after boot (don't block startup), then self-reschedule
  // at the configured interval.
  schedulerTimeout = setTimeout(runAndReschedule, 30_000);
}

async function runAndReschedule(): Promise<void> {
  if (stopped) return;
  await runCycle();
  if (stopped) return;

  const intervalMs = await getTicketingPollFrequencyMs();
  console.log(`[ticketing-reconciliation-cron] Next cycle in ${Math.round(intervalMs / 60_000)} min`);
  schedulerTimeout = setTimeout(runAndReschedule, intervalMs);
}

export function stopTicketingReconciliationScheduler(): void {
  stopped = true;
  if (schedulerTimeout) {
    clearTimeout(schedulerTimeout);
    schedulerTimeout = null;
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
