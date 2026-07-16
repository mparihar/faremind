/**
 * Markup Service — Backend
 *
 * Queries the database for active MARKUP_FEE rules from `platform_fee_rules`
 * and applies markup to provider offers before AI scoring/ranking.
 *
 * Markup is internal only — never shown as a separate line item to customers.
 * The customer sees `totalPrice` which already includes the markup.
 */

import { prisma } from '../lib/db';
import type { UnifiedFlight } from '../lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MarkupRule {
  id: string;
  calculationModel: string;
  fixedAmount: number;
  percentageValue: number;
  currency: string;
  providerScope: string;
  cabinScope: string;
  tripTypeScope: string;
}

interface MarkupContext {
  provider?: string;
  cabin?: string;
  tripType?: string;
  currency?: string;
}

// ─── Rule Fetcher ─────────────────────────────────────────────────────────────

/** In-memory cache to avoid DB round-trips on every search */
let cachedRule: { rule: MarkupRule | null; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Get the active MARKUP_FEE rule from the database.
 * Returns null if no active rule exists.
 */
export async function getActiveMarkupRule(ctx?: MarkupContext): Promise<MarkupRule | null> {
  // Check cache first
  if (cachedRule && Date.now() - cachedRule.fetchedAt < CACHE_TTL_MS) {
    return cachedRule.rule;
  }

  try {
    const now = new Date();
    const rules = await prisma.platformFeeRule.findMany({
      where: {
        feeType: 'MARKUP_FEE',
        active: true,
        deletedAt: null,
        effectiveFrom: { lte: now },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: now } },
        ],
      },
      orderBy: { priority: 'desc' },
    });

    // Find the best-matching rule considering scope
    const matched = rules.find(r => {
      if (ctx?.provider && r.providerScope !== 'ALL') {
        if (r.providerScope.toLowerCase() !== ctx.provider.toLowerCase()) return false;
      }
      if (ctx?.cabin && r.cabinScope !== 'ALL') {
        if (r.cabinScope.toLowerCase() !== ctx.cabin.toLowerCase()) return false;
      }
      if (ctx?.tripType && r.tripTypeScope !== 'ALL') {
        if (r.tripTypeScope.toLowerCase() !== ctx.tripType.toLowerCase()) return false;
      }
      return true;
    }) ?? rules[0] ?? null; // Fallback to highest priority if no scope match

    const result: MarkupRule | null = matched ? {
      id: matched.id,
      calculationModel: matched.calculationModel,
      fixedAmount: Number(matched.fixedAmount ?? 0),
      percentageValue: Number(matched.percentageValue ?? 0),
      currency: matched.currency,
      providerScope: matched.providerScope,
      cabinScope: matched.cabinScope,
      tripTypeScope: matched.tripTypeScope,
    } : null;

    cachedRule = { rule: result, fetchedAt: Date.now() };
    return result;
  } catch (err) {
    console.warn('[Markup] Failed to fetch markup rule:', (err as Error).message);
    return null;
  }
}

// ─── Calculation ──────────────────────────────────────────────────────────────

/**
 * Calculate the markup amount based on the rule and provider fare.
 */
export function calculateMarkupAmount(rule: MarkupRule, providerTotalFare: number): number {
  if (providerTotalFare <= 0) return 0;

  switch (rule.calculationModel) {
    case 'FIXED_PER_BOOKING':
      return rule.fixedAmount;

    case 'PERCENTAGE_OF_FARE':
      return Math.round(providerTotalFare * (rule.percentageValue / 100) * 100) / 100;

    default:
      console.warn(`[Markup] Unsupported calculation model: ${rule.calculationModel}`);
      return 0;
  }
}

// ─── Batch Application ────────────────────────────────────────────────────────

/**
 * Apply markup to an array of UnifiedFlight offers.
 * Mutates `totalPrice` in-place to become the FareMind displayed fare.
 * Preserves the original provider fare in `providerTotalFare`.
 */
export async function applyMarkupToOffers(flights: UnifiedFlight[]): Promise<void> {
  if (flights.length === 0) return;

  const rule = await getActiveMarkupRule();
  if (!rule) return;

  let appliedCount = 0;

  for (const flight of flights) {
    // Skip if already has markup applied (e.g. from cache)
    if (flight.providerTotalFare !== undefined) continue;

    // Currency mismatch check
    if (rule.currency !== 'USD' && flight.currency !== rule.currency) {
      console.warn(`[Markup] Currency mismatch: rule=${rule.currency} offer=${flight.currency} — skipping`);
      continue;
    }

    const markupAmount = calculateMarkupAmount(rule, flight.totalPrice);
    if (markupAmount > 0) {
      flight.providerTotalFare = flight.totalPrice;
      flight.totalPrice = Math.round((flight.totalPrice + markupAmount) * 100) / 100;
      // Adjust baseFare to include markup (markup is FareMind margin, not tax)
      if (flight.baseFare != null) {
        flight.baseFare = Math.round((flight.baseFare + markupAmount) * 100) / 100;
      }
      flight.fareMindMarkupAmount = markupAmount;
      flight.markupRuleId = rule.id;
      appliedCount++;
    }
  }


}

/** Clear the in-memory cache (for testing or admin rule changes) */
export function clearMarkupCache(): void {
  cachedRule = null;
}
