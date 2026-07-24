/**
 * Schedule Change Detection Cron — Background Worker
 *
 * Polls Mystifly's provider queue (/api/Search/GetQueue) for airline-initiated
 * schedule changes and persists them (ScheduleChange records + notifications).
 * Read-only detection — never dequeues; persistence is idempotent per booking.
 *
 * Registered in the Fastify startup lifecycle alongside the other reconcilers.
 */

import { runScheduleChangeDetection } from '../services/schedule-change';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export function startScheduleChangeScheduler(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (schedulerInterval) {
    console.log('[schedule-change-cron] Scheduler already running.');
    return;
  }
  console.log(`[schedule-change-cron] Starting scheduler (interval: ${intervalMs / 1000}s)`);
  setTimeout(runCycle, 60_000); // first run 1 min after startup
  schedulerInterval = setInterval(runCycle, intervalMs);
}

export function stopScheduleChangeScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[schedule-change-cron] Scheduler stopped.');
  }
}

async function runCycle(): Promise<void> {
  const start = Date.now();
  console.log('[schedule-change-cron] ⏰ Polling provider queue for schedule changes...');
  try {
    const { items, upserted } = await runScheduleChangeDetection();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[schedule-change-cron] ✅ Cycle complete: ${items} queue item(s), ${upserted} new schedule change(s) (${elapsed}s)`);
  } catch (err) {
    console.error('[schedule-change-cron] ❌ Cycle failed:', err instanceof Error ? err.message : err);
  }
}

export default { startScheduleChangeScheduler, stopScheduleChangeScheduler };
