/**
 * PTR Quote Reconciliation Cron — Background Worker
 *
 * Drains outstanding VoidQuote/RefundQuote PTRs by invoking
 * runPtrQuoteReconciliation(), which polls Mystifly for quotes the airline has
 * priced since they were requested and writes the amounts onto the PTR record.
 *
 * Slower than the ticketing cron on purpose: a quote is not time-critical the
 * way an unissued ticket is, and each cycle costs one provider call per
 * outstanding quote. Two minutes keeps an operator from waiting long without
 * hammering the provider.
 *
 * Registered in the Fastify startup lifecycle alongside the other schedulers.
 * Opt out with DISABLE_SCHEDULERS=true (e.g. local runs against the prod DB).
 */
import { runPtrQuoteReconciliation } from './ptr-quote-reconciliation';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const DEFAULT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

export function startPtrQuoteReconciliationScheduler(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (schedulerInterval) {
    console.log('[ptr-quote-recon-cron] Scheduler already running.');
    return;
  }

  console.log(`[ptr-quote-recon-cron] Starting scheduler (interval: ${intervalMs / 1000}s)`);

  // First run shortly after boot (don't block startup).
  setTimeout(runCycle, 45_000);
  schedulerInterval = setInterval(runCycle, intervalMs);
}

export function stopPtrQuoteReconciliationScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[ptr-quote-recon-cron] Scheduler stopped.');
  }
}

async function runCycle(): Promise<void> {
  try {
    const results = await runPtrQuoteReconciliation();
    if (results.length > 0) {
      const priced = results.filter(r => r.outcome === 'priced').length;
      const pending = results.filter(r => r.outcome === 'still_pending').length;
      const rejected = results.filter(r => r.outcome === 'rejected').length;
      const expired = results.filter(r => r.outcome === 'expired').length;
      const unreadable = results.filter(r => r.outcome === 'unreadable').length;
      console.log(
        `[ptr-quote-recon-cron] Cycle: ${results.length} processed | ` +
        `priced=${priced} pending=${pending} rejected=${rejected} expired=${expired} unreadable=${unreadable}`,
      );
    }
  } catch (err) {
    console.error('[ptr-quote-recon-cron] Cycle failed:', err);
  }
}
