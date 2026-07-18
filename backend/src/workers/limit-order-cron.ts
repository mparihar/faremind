/**
 * Limit Order Scheduler — Background Worker
 *
 * Runs on a configurable interval (default: every hour) to:
 * 1. Evaluate active limit orders whose nextEvaluationAt has passed
 * 2. Expire stale orders (past departure date or expiration)
 *
 * Registered in the Fastify startup lifecycle.
 */
import { runLimitOrderSchedulerCycle, expireStaleOrders } from '../services/limit-order-scheduler';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Start the limit order scheduler.
 * Called once during Fastify startup.
 */
export function startLimitOrderScheduler(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (schedulerInterval) {
    console.log('[limit-order-cron] Scheduler already running.');
    return;
  }

  console.log(`[limit-order-cron] Starting scheduler (interval: ${intervalMs / 1000}s)`);

  // Run immediately on startup
  runSchedulerCycle();

  // Then schedule recurring
  schedulerInterval = setInterval(runSchedulerCycle, intervalMs);
}

/**
 * Stop the limit order scheduler.
 * Called during Fastify shutdown.
 */
export function stopLimitOrderScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[limit-order-cron] Scheduler stopped.');
  }
}

async function runSchedulerCycle(): Promise<void> {
  const startTime = Date.now();
  console.log('[limit-order-cron] ⏰ Running scheduler cycle...');

  try {
    // Step 1: Expire stale orders
    const expired = await expireStaleOrders();

    // Step 2: Run evaluation cycle
    const stats = await runLimitOrderSchedulerCycle();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[limit-order-cron] ✅ Cycle complete in ${elapsed}s | ` +
      `Orders: ${stats.ordersEvaluated} | Routes: ${stats.routesSearched} | ` +
      `Matches: ${stats.matchesFound} | Expired: ${expired} | Errors: ${stats.errors}`
    );
  } catch (err) {
    console.error('[limit-order-cron] ❌ Scheduler cycle failed:', err);
  }
}
