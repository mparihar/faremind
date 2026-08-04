/**
 * Ticketing reconciliation poll frequency — admin-configurable.
 *
 * How often the reconciliation worker polls Mystifly (AirTicketOrderStatus +
 * TripDetails) for a booking still awaiting ticketing. Stored in the
 * `SystemConfig` table under `ticketing_poll_frequency_minutes` and editable
 * from the admin console (Settings → TripDetails Poll Frequency).
 *
 * Default is 3 hours (was a hardcoded 20 s, which hammered TripDetails). Both
 * the cron cycle interval and each record's `nextPollAt` read this value, so a
 * change takes effect without a redeploy (within the cache TTL).
 */
import { prisma } from './db';

export const TICKETING_POLL_CONFIG_KEY = 'ticketing_poll_frequency_minutes';

export const DEFAULT_POLL_FREQUENCY_MINUTES = 180; // 3 hours
const MIN_MINUTES = 1;
const MAX_MINUTES = 24 * 60; // 24 hours — the max poll window
const CACHE_TTL_MS = 60 * 1000; // re-read config at most once a minute

let cache: { ms: number; expiresAt: number } | null = null;

/** Clamp a minutes value into the allowed range. */
export function clampPollMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_POLL_FREQUENCY_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes)));
}

/**
 * Read the configured poll frequency in milliseconds (default 3 h).
 * Cached for 60 s; falls back to the default on any read error.
 */
export async function getTicketingPollFrequencyMs(): Promise<number> {
  if (cache && Date.now() < cache.expiresAt) return cache.ms;

  let minutes = DEFAULT_POLL_FREQUENCY_MINUTES;
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: TICKETING_POLL_CONFIG_KEY } });
    if (row) {
      const parsed = parseInt(row.value, 10);
      if (!Number.isNaN(parsed)) minutes = clampPollMinutes(parsed);
    }
  } catch (err) {
    console.warn('[ticketing-poll-config] Failed to read config, using default:', (err as Error).message);
  }

  const ms = minutes * 60 * 1000;
  cache = { ms, expiresAt: Date.now() + CACHE_TTL_MS };
  return ms;
}
