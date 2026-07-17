/**
 * Markup Service — Frontend (Next.js Server-Side)
 *
 * Queries the database for active MARKUP_FEE rules from `platform_fee_rules`
 * and applies markup to provider offers before AI scoring/ranking.
 *
 * This runs server-side in Next.js API routes (e.g. /api/search).
 * Markup is internal only — never shown as a separate line item to customers.
 */

import { prisma } from '@/lib/db';
import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';

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

// ─── Rule Fetcher ─────────────────────────────────────────────────────────────

/** In-memory cache — avoids DB round-trips on every search */
let cachedRule: { rule: MarkupRule | null; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute

export async function getActiveMarkupRule(): Promise<MarkupRule | null> {
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

    const matched = rules[0] ?? null;
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

export function calculateMarkupAmount(rule: MarkupRule, providerTotalFare: number): number {
  if (providerTotalFare <= 0) return 0;

  switch (rule.calculationModel) {
    case 'FIXED_PER_BOOKING':
      return rule.fixedAmount;
    case 'PERCENTAGE_OF_FARE':
      return Math.round(providerTotalFare * (rule.percentageValue / 100) * 100) / 100;
    default:
      return 0;
  }
}

// ─── One-Way Offers ───────────────────────────────────────────────────────────

/**
 * Apply markup to an array of UnifiedFlight offers.
 * Mutates `totalPrice` in-place to become the FareMind displayed fare.
 * Preserves the original provider fare in `providerTotalFare`.
 */
export async function applyMarkupToOffers(flights: UnifiedFlight[]): Promise<void> {
  if (flights.length === 0) return;

  const rule = await getActiveMarkupRule();
  if (!rule) {
    return;
  }

  let appliedCount = 0;
  for (const flight of flights) {
    if (flight.providerTotalFare !== undefined) continue;

    if (rule.currency !== 'USD' && flight.currency !== rule.currency) {
      continue;
    }

    const markupAmount = calculateMarkupAmount(rule, flight.totalPrice);
    if (markupAmount > 0) {
      flight.providerTotalFare = flight.totalPrice;
      flight.totalPrice = Math.round((flight.totalPrice + markupAmount) * 100) / 100;
      flight.fareMindMarkupAmount = markupAmount;
      flight.markupRuleId = rule.id;
      appliedCount++;
    }
  }

  if (appliedCount > 0) {
  }
}

// ─── Round-Trip Options ───────────────────────────────────────────────────────

/**
 * Apply markup to an array of RoundTripOption offers.
 * For round-trips, the markup is applied to `totalPrice` at the option level.
 */
export async function applyMarkupToRoundTripOptions(options: RoundTripOption[]): Promise<void> {
  if (options.length === 0) return;

  const rule = await getActiveMarkupRule();
  if (!rule) {
    return;
  }

  let appliedCount = 0;
  for (const option of options) {
    if (option.providerTotalFare !== undefined) continue;

    if (rule.currency !== 'USD' && option.currency !== rule.currency) {
      continue;
    }

    const markupAmount = calculateMarkupAmount(rule, option.totalPrice);
    if (markupAmount > 0) {
      option.providerTotalFare = option.totalPrice;
      option.totalPrice = Math.round((option.totalPrice + markupAmount) * 100) / 100;
      option.fareMindMarkupAmount = markupAmount;
      option.markupRuleId = rule.id;
      appliedCount++;
    }
  }

  if (appliedCount > 0) {
  }
}

/** Clear the in-memory cache (for admin rule changes) */
export function clearMarkupCache(): void {
  cachedRule = null;
}
