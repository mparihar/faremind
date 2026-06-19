/**
 * Server-side in-memory cache shared between /api/flex-prices and /api/search.
 *
 * When the flex-price strip pre-fetches results for each ±3-day tile it stores
 * the full RoundTripOption array here.  When the user clicks a tile and the
 * search route runs for those exact same params, it returns the cached options
 * instead of making a new non-deterministic Duffel call — guaranteeing the
 * cheapest card shown in results matches the price shown in the tile.
 */
import type { RoundTripOption } from './round-trip-types';

interface CacheEntry {
  options: RoundTripOption[];
  ts: number;
}

const TTL_MS = 15 * 60 * 1_000; // 15 minutes

// Module-level Map persists across requests within the same Next.js process.
const store = new Map<string, CacheEntry>();

export function flexCacheKey(
  origin: string,
  destination: string,
  dep: string,
  ret: string,
  adults: number,
  cabin?: string,         // kept for backward-compat but excluded from the key
): string {
  // Include provider mode in key so switching DUFFEL↔MYSTIFLY invalidates stale entries
  const mode = process.env.FLIGHT_PROVIDER_MODE || 'BOTH';
  return [mode, origin, destination, dep, ret, adults].join('|').toUpperCase();
}

export function flexCacheGet(key: string): RoundTripOption[] | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) { store.delete(key); return null; }
  return entry.options;
}

export function flexCacheSet(key: string, options: RoundTripOption[]): void {
  store.set(key, { options, ts: Date.now() });
}

/** Clear all flex-cache entries for a given origin→destination route.
 *  Called on fresh searches (hero / modify) so the flex-date strip
 *  re-fetches live prices instead of showing stale cached tiles. */
export function flexCacheClearRoute(origin: string, destination: string): void {
  const prefix = `${(process.env.FLIGHT_PROVIDER_MODE || 'BOTH').toUpperCase()}|${origin.toUpperCase()}|${destination.toUpperCase()}|`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

/** Clear ALL flex-cache entries across all routes.
 *  Called when user navigates back to the home page (hero).
 */
export function flexCacheClearAll(): void {
  store.clear();
}
