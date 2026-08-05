/**
 * PTR poll frequency — admin-configurable.
 *
 * How often the workers ask Mystifly for the status of an outstanding
 * Post-Ticketing Request. One value covers every PTR type — void, refund and
 * reissue — because they are the same question asked of the same endpoint
 * (`Search/PostTicketingRequest`), and an operator tuning "how hard do we chase
 * the provider" should not have to reason about three numbers.
 *
 * Stored in `SystemConfig` under `ptr_poll_frequency_minutes` and editable from
 * the admin console (Settings → PTR Poll Frequency).
 *
 * Default is 3 hours. The values it replaces were a 2-minute quote poll and a
 * 15-minute reissue cron: an unpriced refund quote burned roughly 720 provider
 * calls over its 24-hour window, on an account where none has ever been priced.
 *
 * Deliberately separate from `ticketing_poll_frequency_minutes`. That one paces
 * TripDetails while a ticket is being issued — minutes matter there, because a
 * queued void cannot run until the e-ticket exists. A PTR is worked by the
 * provider's back office on its own clock, so the two want different numbers
 * even when both happen to default to 3 h.
 */
import { prisma } from './db';

export const PTR_POLL_CONFIG_KEY = 'ptr_poll_frequency_minutes';

export const DEFAULT_PTR_POLL_FREQUENCY_MINUTES = 180; // 3 hours
const MIN_MINUTES = 1;
const MAX_MINUTES = 24 * 60;
const CACHE_TTL_MS = 60 * 1000; // re-read at most once a minute

let cache: { ms: number; expiresAt: number } | null = null;

/** Clamp a minutes value into the allowed range. */
export function clampPtrPollMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_PTR_POLL_FREQUENCY_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes)));
}

/**
 * The configured PTR poll frequency in milliseconds (default 3 h).
 * Cached for 60 s, so a change takes effect without a redeploy; falls back to
 * the default on any read error rather than stopping the pollers.
 */
export async function getPtrPollFrequencyMs(): Promise<number> {
  if (cache && Date.now() < cache.expiresAt) return cache.ms;

  let minutes = DEFAULT_PTR_POLL_FREQUENCY_MINUTES;
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: PTR_POLL_CONFIG_KEY } });
    if (row) {
      const parsed = parseInt(row.value, 10);
      if (!Number.isNaN(parsed)) minutes = clampPtrPollMinutes(parsed);
    }
  } catch (err) {
    console.warn('[ptr-poll-config] Failed to read config, using default:', (err as Error).message);
  }

  const ms = minutes * 60 * 1000;
  cache = { ms, expiresAt: Date.now() + CACHE_TTL_MS };
  return ms;
}
