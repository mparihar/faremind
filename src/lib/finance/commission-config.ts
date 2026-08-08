/**
 * How much of what FareMind earns is shared with the booking agent.
 *
 * Config-driven, never hard-coded: the split is a commercial decision that will
 * change, and changing it must not require a deploy. Stored in system_configs
 * alongside the wallet and offer-expiry settings, so there is one place an admin
 * changes platform policy.
 *
 * ── Read here, snapshot there ────────────────────────────────────────────────
 *
 * These rates apply to NEW bookings only. The amount each booking actually
 * earned is written onto the booking at book time (agentCommissionTotal and the
 * rates that produced it), because finance reporting has to stay true after the
 * policy changes. If this returned 40% next year and the dashboard recomputed
 * history from it, every closed month would silently restate — last year's books
 * would stop matching what was actually paid out.
 */
import { prisma } from '@/lib/db';
import type { CommissionRates } from './finance-math';

export const AGENT_SERVICE_FEE_RATE_KEY = 'agent_service_fee_commission_percent';
export const AGENT_ANCILLARY_RATE_KEY = 'agent_ancillary_commission_percent';

/** Both default to an even split until an admin says otherwise. */
export const DEFAULT_COMMISSION_RATES: CommissionRates = {
  serviceFeeRate: 50,
  ancillaryRate: 50,
};

const CACHE_MS = 60_000;
let cache: { rates: CommissionRates; at: number } | null = null;

function parseRate(value: string | undefined, fallback: number): number {
  const n = Number(String(value ?? '').trim());
  // A missing or corrupt value must not silently become 0% — that would quietly
  // stop paying agents. Fall back to the documented default instead.
  if (!Number.isFinite(n) || n < 0 || n > 100) return fallback;
  return n;
}

/**
 * Current rates. Cached briefly so a booking burst does not hit the config
 * table per booking; a change is live within a minute without a redeploy.
 */
export async function getCommissionRates(): Promise<CommissionRates> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rates;

  try {
    const rows = await prisma.systemConfig.findMany({
      where: { key: { in: [AGENT_SERVICE_FEE_RATE_KEY, AGENT_ANCILLARY_RATE_KEY] } },
      select: { key: true, value: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const rates: CommissionRates = {
      serviceFeeRate: parseRate(byKey.get(AGENT_SERVICE_FEE_RATE_KEY), DEFAULT_COMMISSION_RATES.serviceFeeRate),
      ancillaryRate: parseRate(byKey.get(AGENT_ANCILLARY_RATE_KEY), DEFAULT_COMMISSION_RATES.ancillaryRate),
    };
    cache = { rates, at: Date.now() };
    return rates;
  } catch {
    // The config table being unreachable must not fail a booking. Agents are
    // paid the documented default rather than nothing.
    return DEFAULT_COMMISSION_RATES;
  }
}

/** Drop the cache after an admin edits the rates, so the change is immediate. */
export function invalidateCommissionRates(): void {
  cache = null;
}
