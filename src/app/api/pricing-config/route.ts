import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/pricing-config
 *
 * Returns all pricing configuration from the database in a single call.
 * This is a PUBLIC endpoint (no auth) — used by search cards, fare selection, and checkout.
 *
 * Response:
 *   - serviceFee: { model, fixedAmount, percentageValue } from PlatformFeeRule (SERVICE_FEE)
 *   - fareTiers: FareTierTemplate[] from DB
 *   - taxRate: number from SystemConfig
 *   - extraBagFeeUsd: number from SystemConfig
 */
export async function GET() {
  try {
    // 1. Service fee rule (highest priority active SERVICE_FEE)
    const serviceFeeRule = await prisma.platformFeeRule.findFirst({
      where: { feeType: 'SERVICE_FEE', active: true, deletedAt: null },
      orderBy: { priority: 'desc' },
    });

    const serviceFee = serviceFeeRule
      ? {
          model: serviceFeeRule.calculationModel,
          fixedAmount: serviceFeeRule.fixedAmount !== null ? Number(serviceFeeRule.fixedAmount) : null,
          percentageValue: serviceFeeRule.percentageValue !== null ? Number(serviceFeeRule.percentageValue) : null,
        }
      : null;

    // 2. Fare tier templates (active, ordered by displayOrder)
    const fareTierRows = await prisma.fareTierTemplate.findMany({
      where: { active: true },
      orderBy: { displayOrder: 'asc' },
    });

    const fareTiers = fareTierRows.map(t => ({
      id: t.id,
      name: t.name,
      cabin: t.cabin,
      priceMultiplier: Number(t.priceMultiplier),
      displayOrder: t.displayOrder,
      carryOn: t.carryOn,
      carryOnPieces: t.carryOnPieces,
      carryOnWeightKg: t.carryOnWeightKg !== null ? Number(t.carryOnWeightKg) : null,
      checkedBags: t.checkedBags,
      checkedWeightKg: t.checkedWeightKg !== null ? Number(t.checkedWeightKg) : null,
      extraBagFeeUsd: t.extraBagFeeUsd !== null ? Number(t.extraBagFeeUsd) : null,
      refundable: t.refundable,
      refundFeeUsd: t.refundFeeUsd !== null ? Number(t.refundFeeUsd) : null,
      changeable: t.changeable,
      changeFeeUsd: t.changeFeeUsd !== null ? Number(t.changeFeeUsd) : null,
      seatSelection: t.seatSelection,
      seatSelectionFeeUsd: t.seatSelectionFeeUsd !== null ? Number(t.seatSelectionFeeUsd) : null,
      upgradeable: t.upgradeable,
      loungeAccess: t.loungeAccess,
      priorityBoarding: t.priorityBoarding,
      milesEarning: t.milesEarning,
    }));

    // 3. System configs (tax_rate, extra_bag_fee_usd)
    const configs = await prisma.systemConfig.findMany({
      where: { key: { in: ['tax_rate', 'extra_bag_fee_usd'] } },
    });

    const configMap: Record<string, string> = {};
    for (const c of configs) configMap[c.key] = c.value;

    const taxRate = configMap['tax_rate'] ? parseFloat(configMap['tax_rate']) : null;
    const extraBagFeeUsd = configMap['extra_bag_fee_usd'] ? parseFloat(configMap['extra_bag_fee_usd']) : null;

    return NextResponse.json({
      serviceFee,
      fareTiers,
      taxRate,
      extraBagFeeUsd,
    });
  } catch (err: any) {
    console.error('[pricing-config] GET error:', err);
    return NextResponse.json({ error: err.message ?? 'Failed to fetch pricing config' }, { status: 500 });
  }
}
