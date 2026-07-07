/**
 * Rate Limiting Configuration & Helpers
 *
 * Centralizes all rate-limit settings for the FareMind Fastify backend.
 * Used by the @fastify/rate-limit plugin registered in index.ts.
 *
 * Design:
 *  - getClientIp()                — extracts the real client IP behind Cloudflare / Railway
 *  - getRouteRateLimit()          — returns per-route rate limit config based on URL pattern
 *  - buildRateLimitErrorResponse()— standard 429 JSON response
 *  - getCachedLimit()             — returns the current limit for a category,
 *                                   reading from DB (SystemConfig) with a 60s cache,
 *                                   falling back to env vars → hardcoded defaults
 *  - isRateLimitEnabled()         — checks DB/env for the global enabled flag
 *
 * Priority chain for each limit value:
 *   1. SystemConfig DB value  (set via admin console, cached 60s)
 *   2. Environment variable   (set in .env or Railway dashboard)
 *   3. Hardcoded default      (safe OTA-standard values)
 *
 * Redis support:
 *  - Set RATE_LIMIT_REDIS_URL to enable distributed rate limiting across
 *    multiple Railway instances.  When unset, uses in-memory storage
 *    (perfectly fine for a single-process deployment).
 */

import type { FastifyRequest } from 'fastify';
import { getPrisma } from './db';

// ─── Hardcoded Defaults (per minute) ──────────────────────────────────────────

const HARDCODED_DEFAULTS: Record<string, number> = {
  LOGIN:           10,
  SIGNUP:           5,
  OTP:              5,
  FORGOT_PASSWORD:  5,
  FLIGHT_SEARCH:   60,
  BOOKING:         20,
  PAYMENT:         10,
  CONTACT:         10,
  GLOBAL:         120,
};

// ─── Environment Helpers ──────────────────────────────────────────────────────

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Static env-based defaults — used as fallback when DB has no value.
 * Computed once at module load time.
 */
const ENV_DEFAULTS: Record<string, number> = {
  LOGIN:          envInt('RATE_LIMIT_LOGIN_PER_MINUTE',          HARDCODED_DEFAULTS.LOGIN),
  SIGNUP:         envInt('RATE_LIMIT_SIGNUP_PER_MINUTE',          HARDCODED_DEFAULTS.SIGNUP),
  OTP:            envInt('RATE_LIMIT_OTP_PER_MINUTE',             HARDCODED_DEFAULTS.OTP),
  FORGOT_PASSWORD:envInt('RATE_LIMIT_FORGOT_PASSWORD_PER_MINUTE', HARDCODED_DEFAULTS.FORGOT_PASSWORD),
  FLIGHT_SEARCH:  envInt('RATE_LIMIT_FLIGHT_SEARCH_PER_MINUTE',  HARDCODED_DEFAULTS.FLIGHT_SEARCH),
  BOOKING:        envInt('RATE_LIMIT_BOOKING_PER_MINUTE',        HARDCODED_DEFAULTS.BOOKING),
  PAYMENT:        envInt('RATE_LIMIT_PAYMENT_PER_MINUTE',        HARDCODED_DEFAULTS.PAYMENT),
  CONTACT:        envInt('RATE_LIMIT_CONTACT_PER_MINUTE',        HARDCODED_DEFAULTS.CONTACT),
  GLOBAL:         HARDCODED_DEFAULTS.GLOBAL,
};

// ─── DB-backed Dynamic Config Cache ──────────────────────────────────────────

/**
 * Maps SystemConfig DB key → internal category name.
 * DB keys are lowercase with underscores (e.g. "rate_limit_login_per_minute").
 */
const DB_KEY_TO_CATEGORY: Record<string, string> = {
  rate_limit_login_per_minute:           'LOGIN',
  rate_limit_signup_per_minute:          'SIGNUP',
  rate_limit_otp_per_minute:             'OTP',
  rate_limit_forgot_password_per_minute: 'FORGOT_PASSWORD',
  rate_limit_flight_search_per_minute:   'FLIGHT_SEARCH',
  rate_limit_booking_per_minute:         'BOOKING',
  rate_limit_payment_per_minute:         'PAYMENT',
  rate_limit_contact_per_minute:         'CONTACT',
};

/** Cached limit overrides from DB. `null` means "use env/hardcoded default". */
let dbLimits: Record<string, number | null> = {};
/** Cached enabled flag from DB. `null` means "use env default". */
let dbEnabled: boolean | null = null;
/** Timestamp of last DB fetch */
let lastDbFetch = 0;
/** Cache TTL: 60 seconds */
const DB_CACHE_TTL_MS = 60_000;
/** Prevent concurrent DB fetches */
let fetchInProgress: Promise<void> | null = null;

/**
 * Loads rate limit config from the SystemConfig table.
 * Results are cached in-memory for 60 seconds.
 * On DB error, silently falls back to env/hardcoded defaults.
 */
async function refreshDbConfig(): Promise<void> {
  try {
    const prisma = getPrisma();
    const configs = await prisma.systemConfig.findMany({
      where: {
        key: {
          startsWith: 'rate_limit_',
        },
      },
    });

    const newLimits: Record<string, number | null> = {};
    let newEnabled: boolean | null = null;

    for (const config of configs) {
      if (config.key === 'rate_limit_enabled') {
        newEnabled = config.value.toLowerCase() === 'true';
        continue;
      }

      const category = DB_KEY_TO_CATEGORY[config.key];
      if (category) {
        const val = parseInt(config.value, 10);
        if (!isNaN(val) && val >= 1 && val <= 10000) {
          newLimits[category] = val;
        }
      }
    }

    dbLimits = newLimits;
    dbEnabled = newEnabled;
    lastDbFetch = Date.now();
  } catch {
    // DB error — keep using previous cached values or fall back to defaults.
    // Don't retry immediately — the 60s cache TTL provides backoff.
    lastDbFetch = Date.now();
  }
}

/**
 * Ensures DB config is loaded and fresh (within 60s).
 * Safe to call on every request — returns immediately if cache is valid.
 */
async function ensureDbConfig(): Promise<void> {
  if (Date.now() - lastDbFetch < DB_CACHE_TTL_MS) return;

  // Coalesce concurrent callers — only one DB fetch at a time
  if (!fetchInProgress) {
    fetchInProgress = refreshDbConfig().finally(() => {
      fetchInProgress = null;
    });
  }
  await fetchInProgress;
}

// ─── Public Accessors ─────────────────────────────────────────────────────────

/**
 * Returns the current rate limit for a given category.
 * Priority: DB (cached 60s) → env var → hardcoded default.
 *
 * Used as a dynamic `max` function by @fastify/rate-limit.
 */
export async function getCachedLimit(category: string): Promise<number> {
  await ensureDbConfig();
  return dbLimits[category] ?? ENV_DEFAULTS[category] ?? HARDCODED_DEFAULTS.GLOBAL;
}

/**
 * Returns whether rate limiting is currently enabled.
 * Priority: DB (cached 60s) → env var → default true.
 */
export async function isRateLimitEnabledDynamic(): Promise<boolean> {
  await ensureDbConfig();
  if (dbEnabled !== null) return dbEnabled;
  return (process.env.RATE_LIMIT_ENABLED ?? 'true') !== 'false';
}

/**
 * Returns all current rate limit values (for admin API / debugging).
 * Each entry shows the effective value and its source.
 */
export async function getAllLimits(): Promise<Record<string, { value: number; source: string }>> {
  await ensureDbConfig();
  const result: Record<string, { value: number; source: string }> = {};

  for (const category of Object.keys(ENV_DEFAULTS)) {
    if (dbLimits[category] != null) {
      result[category] = { value: dbLimits[category]!, source: 'database' };
    } else if (ENV_DEFAULTS[category] !== HARDCODED_DEFAULTS[category]) {
      result[category] = { value: ENV_DEFAULTS[category], source: 'env' };
    } else {
      result[category] = { value: HARDCODED_DEFAULTS[category], source: 'default' };
    }
  }

  return result;
}

// ─── Client IP Detection ──────────────────────────────────────────────────────

/**
 * Extracts the real client IP address from a Fastify request.
 *
 * Behind Cloudflare + Railway (reverse-proxy chain), the real client IP
 * is available in several headers, in order of trust:
 *
 *  1. `cf-connecting-ip`  — Set by Cloudflare; contains the visitor's
 *     original IP.  Most reliable when traffic flows through CF.
 *
 *  2. `x-forwarded-for`   — Standard proxy header.  May contain a
 *     comma-separated list of IPs; the FIRST entry is the original client.
 *     Railway and other proxies append to this header.
 *
 *  3. `x-real-ip`         — Some proxies (nginx, Railway) set this
 *     to the connecting client's IP.
 *
 *  4. `request.ip`        — Fastify's built-in IP detection (uses
 *     `trustProxy` setting).  Final fallback.
 *
 * We trust these headers because the Fastify server runs behind
 * Cloudflare → Railway, both of which are trusted proxies that set
 * these headers correctly.  Direct access to the Fastify server
 * should be blocked at the network/firewall level.
 */
export function getClientIp(request: FastifyRequest): string {
  // 1. Cloudflare always sets this to the true visitor IP
  const cfIp = request.headers['cf-connecting-ip'];
  if (cfIp && typeof cfIp === 'string') return cfIp.trim();

  // 2. X-Forwarded-For: take the first (leftmost) IP — that's the client
  const xff = request.headers['x-forwarded-for'];
  if (xff) {
    const first = (typeof xff === 'string' ? xff : xff[0])
      .split(',')[0]
      ?.trim();
    if (first) return first;
  }

  // 3. X-Real-IP fallback
  const realIp = request.headers['x-real-ip'];
  if (realIp && typeof realIp === 'string') return realIp.trim();

  // 4. Fastify's own IP (direct connection or trustProxy)
  return request.ip;
}

// ─── Route → Rate Limit Mapping ──────────────────────────────────────────────

/**
 * Route matching rules.  Checked in order — first match wins.
 * `prefix: true` matches any URL starting with the pattern.
 * `prefix: false` matches the exact URL string.
 * `category` references the limit category for dynamic lookup.
 */
interface RouteRule {
  pattern: string;
  prefix: boolean;
  category: string;
}

const ROUTE_RULES: RouteRule[] = [
  // ── Signup (strictest) ────────────────────────────────────────────────
  { pattern: '/api/auth/register',                    prefix: false, category: 'SIGNUP' },

  // ── OTP endpoints ─────────────────────────────────────────────────────
  { pattern: '/api/auth/send-otp',                    prefix: false, category: 'OTP' },
  { pattern: '/api/auth/resend-otp',                  prefix: false, category: 'OTP' },
  { pattern: '/api/manage-booking/lookup/send-otp',   prefix: false, category: 'OTP' },
  { pattern: '/api/manage-booking/lookup/verify-otp', prefix: false, category: 'OTP' },

  // ── Login / auth verification ─────────────────────────────────────────
  { pattern: '/api/auth/verify-otp',                  prefix: false, category: 'LOGIN' },
  { pattern: '/api/auth/check-user',                  prefix: false, category: 'LOGIN' },

  // ── Flight search (before booking to match first) ─────────────────────
  { pattern: '/api/search',                           prefix: true,  category: 'FLIGHT_SEARCH' },
  { pattern: '/api/flexible-search',                  prefix: true,  category: 'FLIGHT_SEARCH' },
  { pattern: '/api/fares',                            prefix: true,  category: 'FLIGHT_SEARCH' },

  // ── Booking / checkout / cancellation ─────────────────────────────────
  { pattern: '/api/book',                             prefix: true,  category: 'BOOKING' },
  { pattern: '/api/booking-session',                  prefix: true,  category: 'BOOKING' },
  { pattern: '/api/checkout',                         prefix: true,  category: 'BOOKING' },
  { pattern: '/api/cancel',                           prefix: true,  category: 'BOOKING' },
  { pattern: '/api/manage-booking',                   prefix: true,  category: 'BOOKING' },
  { pattern: '/api/mystifly',                         prefix: true,  category: 'BOOKING' },
];

/**
 * Returns the category name for a given route URL, or null for global default.
 * Used by the `onRoute` hook in index.ts.
 */
export function getRouteCategoryForUrl(url: string): string | null {
  for (const rule of ROUTE_RULES) {
    if (rule.prefix ? url.startsWith(rule.pattern) : url === rule.pattern) {
      return rule.category;
    }
  }
  return null;
}

/**
 * Returns a dynamic rate limit config for a given route URL.
 * The `max` property is an async function that reads from the DB-backed cache,
 * so admin console changes take effect within 60 seconds without restart.
 *
 * Called from the `onRoute` hook in index.ts at registration time.
 */
export function getRouteRateLimit(
  url: string,
): { max: () => Promise<number>; timeWindow: string } | null {
  const category = getRouteCategoryForUrl(url);
  if (!category) return null;
  return {
    max: () => getCachedLimit(category),
    timeWindow: '1 minute',
  };
}

// ─── Standard 429 Error Response ──────────────────────────────────────────────

/**
 * Builds the standard JSON body returned when a rate limit is exceeded.
 * Used as `errorResponseBuilder` in the @fastify/rate-limit plugin config.
 *
 * @param request - The Fastify request that triggered the limit
 * @param context - Rate limit context provided by the plugin (max, ttl, etc.)
 */
export function buildRateLimitErrorResponse(
  request: FastifyRequest,
  context: { max: number; after: string },
) {
  // Log the rate-limit event (no sensitive data — only IP and route)
  request.log.warn(
    {
      ip: getClientIp(request),
      url: request.url,
      method: request.method,
      limit: context.max,
      retryAfter: context.after,
    },
    '[rate-limit] Request rate limit exceeded',
  );

  return {
    statusCode: 429,
    success: false,
    error: 'Too many requests. Please wait and try again.',
    code: 'RATE_LIMIT_EXCEEDED',
  };
}
