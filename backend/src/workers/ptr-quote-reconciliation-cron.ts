/**
 * PTR Quote Reconciliation Cron — Background Worker
 *
 * Drains outstanding VoidQuote/RefundQuote PTRs by invoking
 * runPtrQuoteReconciliation(), which asks Mystifly for quotes priced since they
 * were requested and writes the amounts onto the PTR record.
 *
 * The interval is admin-configurable (Settings → PTR Poll Frequency, default
 * 3 h) and shared with the reissue poller — they ask the same endpoint the same
 * question. It self-reschedules after each cycle rather than using setInterval,
 * so a change to the setting is picked up on the next tick without a redeploy.
 *
 * This was a fixed 2 minutes, which spent ~720 provider calls chasing a single
 * unpriced refund quote across its 24-hour window.
 *
 * Registered in the Fastify startup lifecycle alongside the other schedulers.
 * Opt out with DISABLE_SCHEDULERS=true (e.g. local runs against the prod DB).
 */
import { runPtrQuoteReconciliation } from './ptr-quote-reconciliation';
import { getPtrPollFrequencyMs } from '../lib/ptr-poll-config';

let schedulerTimeout: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

export function startPtrQuoteReconciliationScheduler(): void {
  if (schedulerTimeout) {
    console.log('[ptr-quote-recon-cron] Scheduler already running.');
    return;
  }
  stopped = false;
  console.log('[ptr-quote-recon-cron] Starting scheduler (interval: admin-configurable, default 3h)');

  // First pass shortly after boot, then self-reschedule at the configured rate.
  schedulerTimeout = setTimeout(runAndReschedule, 45_000);
}

export function stopPtrQuoteReconciliationScheduler(): void {
  stopped = true;
  if (schedulerTimeout) {
    clearTimeout(schedulerTimeout);
    schedulerTimeout = null;
    console.log('[ptr-quote-recon-cron] Scheduler stopped.');
  }
}

async function runAndReschedule(): Promise<void> {
  if (stopped) return;
  await runCycle();
  if (stopped) return;

  const intervalMs = await getPtrPollFrequencyMs();
  console.log(`[ptr-quote-recon-cron] Next cycle in ${Math.round(intervalMs / 60_000)} min`);
  schedulerTimeout = setTimeout(runAndReschedule, intervalMs);
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
