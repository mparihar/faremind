/**
 * Lightweight in-memory TTL cache.
 *
 * Replaces the previous ioredis-based implementation to eliminate:
 *  - ioredis library loading overhead (~50ms)
 *  - Connection attempt delays when REDIS_URL is absent
 *  - Debug logging on every hit/miss
 *
 * Perfectly adequate for a single-process Fastify backend.
 * All cache misses fall through to live data.
 */

interface CacheEntry { value: string; expiresAt: number; }

const store = new Map<string, CacheEntry>();

// Lazy cleanup — runs at most every 60s to evict expired entries
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 60_000;

function maybeCleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return JSON.parse(entry.value) as T;
}

export async function cacheSet(key: string, value: unknown, ttlSec = 120): Promise<void> {
  maybeCleanup();
  store.set(key, {
    value: JSON.stringify(value),
    expiresAt: Date.now() + ttlSec * 1000,
  });
}

export async function cacheDel(...keys: string[]): Promise<void> {
  for (const k of keys) store.delete(k);
}

export async function cacheDelPattern(pattern: string): Promise<void> {
  // Convert simple glob pattern (e.g. "flight_search:*") to a prefix match
  const prefix = pattern.replace(/\*.*$/, '');
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

// ─── Cache key builders ───────────────────────────────────────────────────────

export function searchKey(
  origin: string,
  dest: string,
  date: string,
  returnDate = '',
  adults = 1,
  children = 0,
  infants = 0,
): string {
  return `flight_search:${origin}:${dest}:${date}:${returnDate}:${adults}:${children}:${infants}`;
}

export function fareOptionsKey(offerId: string, basePrice: number, travelers: number): string {
  return `fare_options:${offerId}:${basePrice}:${travelers}`;
}

export function seatMapKey(origin: string, dest: string, flightNumber: string): string {
  return `seat_map:${origin}:${dest}:${flightNumber}`;
}

export function priceProtectionKey(fareId: string, totalPrice: number): string {
  return `price_protection:${fareId}:${totalPrice}`;
}
