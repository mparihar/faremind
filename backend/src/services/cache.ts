/**
 * Redis cache service — gracefully no-ops when REDIS_URL is not set.
 * All cache misses fall through to live data; the app works without Redis.
 */

import Redis from 'ioredis';

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (_redis) return _redis;

  _redis = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    connectTimeout: 3_000,
    commandTimeout: 2_000,
    enableReadyCheck: false,
  });

  _redis.on('error', (err: Error) => {
    // Log once; don't crash the server on Redis failures
    console.warn('[Cache] Redis error:', err.message);
  });

  return _redis;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(key);
    if (!raw) return null;
    console.debug(`[Cache] HIT ${key}`);
    return JSON.parse(raw) as T;
  } catch {
    console.debug(`[Cache] MISS ${key}`);
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSec = 120): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(key, JSON.stringify(value), 'EX', ttlSec);
  } catch { /* non-critical — live data will still be returned */ }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  const r = getRedis();
  if (!r || keys.length === 0) return;
  try {
    await r.del(...keys);
  } catch { /* non-critical */ }
}

export async function cacheDelPattern(pattern: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    const keys = await r.keys(pattern);
    if (keys.length > 0) await r.del(...keys);
  } catch { /* non-critical */ }
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
