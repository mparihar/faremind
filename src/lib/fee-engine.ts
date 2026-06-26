/**
 * ═══════════════════════════════════════════════
 * FareMind — Commercial Fee Calculation Engine
 * ═══════════════════════════════════════════════
 *
 * Replaces all hardcoded fee logic with dynamic,
 * admin-managed rules from the database.
 *
 * Supports:
 *   • Platform fees (service fee, markup)
 *   • Price drop protection products
 *   • Travel insurance products
 *
 * All amounts are in the smallest unit of precision
 * expected by the UI (integer cents or whole dollars
 * depending on context — this engine returns whole
 * dollar amounts to match the existing codebase).
 */

import { prisma } from '@/lib/db';
import { isBundleEnabled } from '@/lib/bundle-flags';

// ─── Types ────────────────────────────────────────

export interface PassengerInfo {
  id: string;
  type: 'adult' | 'child' | 'infant';
  baseFare: number;
}

export interface BookingContext {
  provider: string;               // 'duffel' | 'mystifly'
  tripType: string;               // 'ONE_WAY' | 'ROUND_TRIP' | 'MULTI_CITY'
  originCountry?: string;
  destinationCountry?: string;
  cabin: string;                  // 'economy' | 'premium_economy' | 'business' | 'first'
  fareClass?: string;             // e.g. 'Economy Basic', 'Economy Flex'
  passengers: PassengerInfo[];
  supplierFareTotal: number;      // total supplier fare for all passengers
  bookingTotalBeforeFees: number; // subtotal before platform fees
  currency: string;
}

export interface ComputedCharge {
  chargeType: 'SERVICE_FEE' | 'MARKUP_FEE' | 'PRICE_DROP_PROTECTION' | 'TRAVEL_INSURANCE';
  sourceType: 'PLATFORM' | 'PROVIDER' | 'ADMIN_CONFIG';
  ruleId: string | null;
  passengerId?: string;
  passengerType?: string;
  calculationModel: string;
  unitAmount: number;
  quantity: number;
  percentageValue: number;
  totalAmount: number;
  displayToCustomer: boolean;
  ruleSnapshot: Record<string, unknown>;
}

export interface FeeComputeResult {
  serviceFee: number;
  markupFee: number;
  protectionFee: number;       // per-traveler amount
  protectionFeeTotal: number;  // total across all eligible travelers
  insuranceFee: number;        // per-traveler amount
  insuranceFeeTotal: number;   // total across all eligible travelers
  charges: ComputedCharge[];
}

// ─── Scope Matching Helpers ───────────────────────

function matchesProvider(ruleScope: string, provider: string): boolean {
  if (ruleScope === 'ALL') return true;
  return ruleScope.toLowerCase() === provider.toLowerCase();
}

function matchesCabin(ruleScope: string, cabin: string, fareClass?: string): boolean {
  if (ruleScope === 'ALL') return true;
  const normalizedCabin = cabin.toLowerCase().replace(/\s+/g, '_');
  const normalizedScope = ruleScope.toLowerCase().replace(/\s+/g, '_');

  // Direct cabin match
  if (normalizedScope === normalizedCabin) return true;

  // Fare-class level matching (e.g., ECONOMY_BASIC matches economy cabin + 'Economy Basic' fare class)
  if (fareClass) {
    const normalizedFareClass = fareClass.toLowerCase().replace(/\s+/g, '_');
    if (normalizedScope === normalizedFareClass) return true;
  }

  // General cabin category match (ECONOMY matches economy, economy_basic, etc.)
  if (normalizedScope === 'economy' && normalizedCabin.startsWith('economy')) return true;
  if (normalizedScope === 'premium_economy' && normalizedCabin.startsWith('premium_economy')) return true;
  if (normalizedScope === 'business' && normalizedCabin.startsWith('business')) return true;

  return false;
}

function matchesTripType(ruleScope: string, tripType: string): boolean {
  if (ruleScope === 'ALL') return true;
  return ruleScope === tripType;
}

function matchesRoute(
  routeScope: string,
  originCountry?: string,
  destinationCountry?: string,
  ruleOrigin?: string | null,
  ruleDestination?: string | null,
): boolean {
  if (routeScope === 'ALL') return true;
  if (routeScope === 'DOMESTIC') return originCountry === destinationCountry;
  if (routeScope === 'INTERNATIONAL') return originCountry !== destinationCountry;
  if (routeScope === 'CUSTOM') {
    if (ruleOrigin && originCountry && ruleOrigin.toLowerCase() !== originCountry.toLowerCase()) return false;
    if (ruleDestination && destinationCountry && ruleDestination.toLowerCase() !== destinationCountry.toLowerCase()) return false;
    return true;
  }
  return true;
}

function isRuleActive(rule: { active: boolean; deletedAt: Date | null; effectiveFrom: Date; effectiveTo: Date | null }): boolean {
  if (!rule.active || rule.deletedAt) return false;
  const now = new Date();
  if (rule.effectiveFrom > now) return false;
  if (rule.effectiveTo && rule.effectiveTo < now) return false;
  return true;
}

function countEligiblePassengers(
  passengers: PassengerInfo[],
  appliesToAdult: boolean,
  appliesToChild: boolean,
  appliesToInfant: boolean,
): PassengerInfo[] {
  return passengers.filter(p => {
    if (p.type === 'adult' && appliesToAdult) return true;
    if (p.type === 'child' && appliesToChild) return true;
    if (p.type === 'infant' && appliesToInfant) return true;
    return false;
  });
}

// ─── Calculation Logic ────────────────────────────

function computeAmount(
  model: string,
  fixedAmount: number,
  percentageValue: number,
  eligibleCount: number,
  supplierFareTotal: number,
  bookingTotalBeforeFees: number,
): number {
  switch (model) {
    case 'FIXED_PER_BOOKING':
      return Math.round(fixedAmount);
    case 'FIXED_PER_TRAVELER':
      return Math.round(fixedAmount * eligibleCount);
    case 'PERCENTAGE_OF_FARE':
      return Math.round(supplierFareTotal * (percentageValue / 100));
    case 'PERCENTAGE_OF_BOOKING_TOTAL':
      return Math.round(bookingTotalBeforeFees * (percentageValue / 100));
    case 'HYBRID':
      return Math.round(fixedAmount * eligibleCount + supplierFareTotal * (percentageValue / 100));
    default:
      return 0;
  }
}

// ─── Main Engine ──────────────────────────────────

/**
 * Calculate all commercial fees for a booking context.
 * Queries the database for active rules and applies them
 * based on scope matching and priority.
 */
export async function calculateCommercialFees(ctx: BookingContext): Promise<FeeComputeResult> {
  const charges: ComputedCharge[] = [];
  let serviceFee = 0;
  let markupFee = 0;
  let protectionFee = 0;
  let protectionFeeTotal = 0;
  let insuranceFee = 0;
  let insuranceFeeTotal = 0;

  // ── 1. Platform Fees (Service Fee + Markup) ──

  const platformRules = await prisma.platformFeeRule.findMany({
    where: { active: true, deletedAt: null },
    orderBy: { priority: 'desc' },
  });

  for (const feeType of ['SERVICE_FEE', 'MARKUP_FEE'] as const) {
    const matchingRules = platformRules.filter(r =>
      r.feeType === feeType &&
      isRuleActive(r) &&
      matchesProvider(r.providerScope, ctx.provider) &&
      matchesCabin(r.cabinScope, ctx.cabin, ctx.fareClass) &&
      matchesTripType(r.tripTypeScope, ctx.tripType) &&
      matchesRoute(r.routeScopeType, ctx.originCountry, ctx.destinationCountry, r.originCountry, r.destinationCountry)
    );

    // Take highest priority matching rule
    const rule = matchingRules[0];
    if (!rule) {
      console.log(`[fee-engine] No active ${feeType} rule matched for provider=${ctx.provider} cabin=${ctx.cabin} trip=${ctx.tripType}`);
      continue;
    }

    const eligible = countEligiblePassengers(
      ctx.passengers,
      rule.appliesToAdult,
      rule.appliesToChild,
      rule.appliesToInfant,
    );

    const amount = computeAmount(
      rule.calculationModel,
      Number(rule.fixedAmount ?? 0),
      Number(rule.percentageValue ?? 0),
      eligible.length,
      ctx.supplierFareTotal,
      ctx.bookingTotalBeforeFees,
    );

    if (feeType === 'SERVICE_FEE') serviceFee = amount;
    if (feeType === 'MARKUP_FEE') markupFee = amount;

    charges.push({
      chargeType: feeType,
      sourceType: 'PLATFORM',
      ruleId: rule.id,
      calculationModel: rule.calculationModel,
      unitAmount: Number(rule.fixedAmount ?? 0),
      quantity: eligible.length,
      percentageValue: Number(rule.percentageValue ?? 0),
      totalAmount: amount,
      displayToCustomer: feeType === 'SERVICE_FEE', // Markup is never shown to customer
      ruleSnapshot: JSON.parse(JSON.stringify(rule)),
    });
  }

  // ── 2. Price Drop Protection ──

  const protectionRules = await prisma.protectionProductRule.findMany({
    where: { active: true, deletedAt: null },
    orderBy: { priority: 'desc' },
  });

  const matchingProtection = protectionRules.filter(r =>
    isRuleActive(r) &&
    matchesCabin(r.cabinScope, ctx.cabin, ctx.fareClass) &&
    matchesTripType(r.tripTypeScope, ctx.tripType) &&
    matchesRoute(r.routeScopeType, ctx.originCountry, ctx.destinationCountry, r.originCountry, r.destinationCountry) &&
    (r.minBookingAmount === null || ctx.supplierFareTotal >= Number(r.minBookingAmount)) &&
    (r.maxBookingAmount === null || ctx.supplierFareTotal <= Number(r.maxBookingAmount))
  );

  const protectionRule = matchingProtection[0];
  if (!protectionRule) {
    console.log(`[fee-engine] No active PRICE_DROP_PROTECTION rule matched for cabin=${ctx.cabin} trip=${ctx.tripType}`);
  }
  if (protectionRule && protectionRule.pricingModel !== 'PROVIDER_QUOTED') {
    const eligible = countEligiblePassengers(
      ctx.passengers,
      protectionRule.appliesToAdult,
      protectionRule.appliesToChild,
      protectionRule.appliesToInfant,
    );

    const fixedAmt = Number(protectionRule.fixedAmount ?? 0);
    const pctVal = Number(protectionRule.percentageValue ?? 0);

    if (protectionRule.pricingModel === 'FIXED_PER_TRAVELER') {
      protectionFee = Math.round(fixedAmt);
      protectionFeeTotal = Math.round(fixedAmt * eligible.length);
    } else if (protectionRule.pricingModel === 'FIXED_PER_BOOKING') {
      protectionFee = Math.round(fixedAmt); // flat fee, same for display
      protectionFeeTotal = Math.round(fixedAmt);
    } else if (protectionRule.pricingModel === 'PERCENTAGE_OF_FARE') {
      const perPerson = Math.round(ctx.supplierFareTotal / ctx.passengers.length * (pctVal / 100));
      protectionFee = perPerson;
      protectionFeeTotal = protectionFee * eligible.length;
    }

    charges.push({
      chargeType: 'PRICE_DROP_PROTECTION',
      sourceType: 'ADMIN_CONFIG',
      ruleId: protectionRule.id,
      calculationModel: protectionRule.pricingModel,
      unitAmount: protectionFee,
      quantity: eligible.length,
      percentageValue: pctVal,
      totalAmount: protectionFeeTotal,
      displayToCustomer: true,
      ruleSnapshot: JSON.parse(JSON.stringify(protectionRule)),
    });
  }

  // ── 3. Travel Insurance ──

  const insuranceRules = await prisma.travelInsuranceRule.findMany({
    where: { active: true, deletedAt: null },
    orderBy: { priority: 'desc' },
  });

  const matchingInsurance = insuranceRules.filter(r =>
    isRuleActive(r) &&
    matchesCabin(r.cabinScope, ctx.cabin, ctx.fareClass) &&
    matchesTripType(r.tripTypeScope, ctx.tripType) &&
    matchesRoute(r.routeScopeType, ctx.originCountry, ctx.destinationCountry, r.originCountry, r.destinationCountry) &&
    (r.minBookingAmount === null || ctx.supplierFareTotal >= Number(r.minBookingAmount)) &&
    (r.maxBookingAmount === null || ctx.supplierFareTotal <= Number(r.maxBookingAmount))
  );

  const insuranceRule = matchingInsurance[0];
  if (!insuranceRule) {
    console.log(`[fee-engine] No active TRAVEL_INSURANCE rule matched for cabin=${ctx.cabin} trip=${ctx.tripType}`);
  }
  if (insuranceRule && insuranceRule.pricingModel !== 'PROVIDER_QUOTED') {
    const fixedAmt = Number(insuranceRule.fixedAmount ?? 0);
    const pctVal = Number(insuranceRule.percentageValue ?? 0);

    if (insuranceRule.pricingModel === 'FIXED_PER_TRAVELER') {
      insuranceFee = Math.round(fixedAmt);
      insuranceFeeTotal = Math.round(fixedAmt * ctx.passengers.length);
    } else if (insuranceRule.pricingModel === 'FIXED_PER_BOOKING') {
      insuranceFee = Math.round(fixedAmt);
      insuranceFeeTotal = Math.round(fixedAmt);
    } else if (insuranceRule.pricingModel === 'PERCENTAGE_OF_BOOKING_TOTAL') {
      insuranceFeeTotal = Math.round(ctx.bookingTotalBeforeFees * (pctVal / 100));
      insuranceFee = Math.round(insuranceFeeTotal / ctx.passengers.length);
    }

    charges.push({
      chargeType: 'TRAVEL_INSURANCE',
      sourceType: 'ADMIN_CONFIG',
      ruleId: insuranceRule.id,
      calculationModel: insuranceRule.pricingModel,
      unitAmount: insuranceFee,
      quantity: ctx.passengers.length,
      percentageValue: pctVal,
      totalAmount: insuranceFeeTotal,
      displayToCustomer: true,
      ruleSnapshot: JSON.parse(JSON.stringify(insuranceRule)),
    });
  }

  // FAREMIND_BUNDLE gate: zero out protection & insurance when disabled
  if (!isBundleEnabled()) {
    protectionFee = 0;
    protectionFeeTotal = 0;
    insuranceFee = 0;
    insuranceFeeTotal = 0;
    // Remove protection/insurance charges from the array
    const filtered = charges.filter(c => c.chargeType !== 'PRICE_DROP_PROTECTION' && c.chargeType !== 'TRAVEL_INSURANCE');
    charges.length = 0;
    charges.push(...filtered);
  }

  return {
    serviceFee,
    markupFee,
    protectionFee,
    protectionFeeTotal,
    insuranceFee,
    insuranceFeeTotal,
    charges,
  };
}

/**
 * Fallback fee calculation when DB is unavailable.
 * Uses the same hardcoded defaults that existed before.
 */
export function calculateFallbackFees(ctx: BookingContext): FeeComputeResult {
  const passengerCount = ctx.passengers.length;
  const perPersonBase = ctx.supplierFareTotal / passengerCount;

  // Service fee: $10 per traveler
  const serviceFee = 10 * passengerCount;

  // Markup: 0 (no markup by default)
  const markupFee = 0;

  // Protection: 6% of per-person fare, clamped $49-$399
  const protectionFee = Math.min(Math.max(Math.round(perPersonBase * 0.06), 49), 399);
  const protectionFeeTotal = protectionFee * passengerCount;

  // Insurance: 4% of total fare
  const insuranceFeeTotal = Math.round(ctx.supplierFareTotal * 0.04);
  const insuranceFee = Math.round(insuranceFeeTotal / passengerCount);

  return {
    serviceFee,
    markupFee,
    protectionFee,
    protectionFeeTotal,
    insuranceFee,
    insuranceFeeTotal,
    charges: [],
  };
}
