/**
 * FX — hybrid currency conversion to USD.
 *
 * Mystifly returns some amounts (e.g. void/refund penalties) in the airline's
 * filing currency (often INR) while FareMind prices/charges in USD, and there is
 * no FX rate in the provider response. This resolves a <currency>→USD rate with a
 * layered strategy:
 *
 *   1. 24h in-memory cache           (fast, avoids per-request lookups)
 *   2. Live FX API                   (dynamic — tracks the market)
 *   3. SystemConfig static fallback  (admin-editable: key `fx_rate_<ccy>_usd`)
 *   4. Hardcoded last-resort default (so we never hard-fail)
 *
 * Amounts convert as: usdAmount = foreignAmount * getUsdRate(foreignCcy).
 * Returns 1 for USD / unknown currency (no conversion) — callers keep a guard for
 * the case where no rate is available.
 */

import { prisma } from '../lib/db';

interface FxEntry { rate: number; fetchedAt: number; source: string; }

const cache = new Map<string, FxEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // daily
const FETCH_TIMEOUT_MS = 4000;

// Last-resort approximate rates, used only if the live API AND SystemConfig are
// both unavailable. Deliberately conservative; admins should set SystemConfig
// `fx_rate_<ccy>_usd` for anything they care about.
const STATIC_DEFAULTS: Record<string, number> = {
  INR: 0.012, // 1 INR ≈ 0.012 USD
};

async function fetchLiveRate(ccy: string): Promise<number | null> {
  try {
    // open.er-api.com is a free, KEYLESS endpoint (no API key required).
    // Optional override: set FX_RATES_URL to a template containing {BASE}; it must
    // return JSON shaped like { rates: { USD: <number> } }.
    const template = process.env.FX_RATES_URL || 'https://open.er-api.com/v6/latest/{BASE}';
    const url = template.replace('{BASE}', encodeURIComponent(ccy));
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data: any = await res.json();
    const rate = data?.rates?.USD;
    return typeof rate === 'number' && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

// Ensure the admin-editable SystemConfig fallback key exists so it shows up in
// Admin → System → Feature Flags for viewing/editing. Seeds the default value only
// when the key is absent — never overwrites an admin-set value. Runs once per
// currency per process.
const ensuredKeys = new Set<string>();
async function ensureConfigKey(ccy: string): Promise<void> {
  if (ensuredKeys.has(ccy)) return;
  ensuredKeys.add(ccy);
  const def = STATIC_DEFAULTS[ccy];
  if (def == null) return;
  try {
    const key = `fx_rate_${ccy.toLowerCase()}_usd`;
    const existing = await prisma.systemConfig.findUnique({ where: { key } });
    if (!existing) {
      await prisma.systemConfig.create({
        data: {
          key,
          value: String(def),
          description: `Static fallback FX rate: 1 ${ccy} in USD, used when the live FX API is unavailable. Editable here in Admin → System → Feature Flags.`,
        },
      });
    }
  } catch { /* race / unique constraint — safe to ignore */ }
}

async function fetchConfigRate(ccy: string): Promise<number | null> {
  try {
    const key = `fx_rate_${ccy.toLowerCase()}_usd`;
    const cfg = await prisma.systemConfig.findUnique({ where: { key } });
    const val = cfg ? parseFloat(cfg.value) : NaN;
    return !isNaN(val) && val > 0 ? val : null;
  } catch {
    return null;
  }
}

/**
 * Rate to convert `from` currency into USD. Cached daily; falls back through
 * live API → SystemConfig → hardcoded default. Returns 1 for USD / unknown.
 */
export async function getUsdRate(from: string | undefined | null): Promise<number> {
  const ccy = (from || '').toUpperCase();
  if (!ccy || ccy === 'USD') return 1;

  // Make the admin-editable fallback key discoverable (fire-and-forget).
  void ensureConfigKey(ccy);

  const cached = cache.get(ccy);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.rate;

  const live = await fetchLiveRate(ccy);
  if (live != null) {
    cache.set(ccy, { rate: live, fetchedAt: Date.now(), source: 'live' });
    return live;
  }

  const configured = await fetchConfigRate(ccy);
  if (configured != null) {
    // Cache the fallback for a shorter window so we retry the live API sooner.
    cache.set(ccy, { rate: configured, fetchedAt: Date.now() - (CACHE_TTL_MS - 60 * 60 * 1000), source: 'config' });
    console.warn(`[FX] Live rate unavailable for ${ccy}, using SystemConfig fallback ${configured}`);
    return configured;
  }

  const def = STATIC_DEFAULTS[ccy];
  if (def != null) {
    cache.set(ccy, { rate: def, fetchedAt: Date.now() - (CACHE_TTL_MS - 60 * 60 * 1000), source: 'default' });
    console.warn(`[FX] No live/config rate for ${ccy}, using hardcoded default ${def}`);
    return def;
  }

  console.error(`[FX] No rate available for ${ccy}→USD — returning 1 (no conversion)`);
  return 1;
}

/** Convert a foreign amount into USD. */
export async function toUsd(amount: number, from: string | undefined | null): Promise<number> {
  if (!amount) return 0;
  const rate = await getUsdRate(from);
  return amount * rate;
}
