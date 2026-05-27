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
  // Cabin-agnostic key: searchRoundTripFlights now fetches all 4 cabin classes,
  // so the cached dataset is the same regardless of which cabin the user picked.
  return [origin, destination, dep, ret, adults].join('|').toUpperCase();
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
