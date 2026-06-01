import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

// GET: Get single protection product rule
export const GET = withAdmin(async (req: NextRequest, { params }) => {
  try {
    const rule = await prisma.protectionProductRule.findUnique({
      where: { id: params.id },
      include: {
        createdByAdmin: { select: { fullName: true, email: true } },
        updatedByAdmin: { select: { fullName: true, email: true } },
      },
    });
    if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    return NextResponse.json({
      rule: { ...rule, fixedAmount: rule.fixedAmount ? Number(rule.fixedAmount) : null, percentageValue: rule.percentageValue ? Number(rule.percentageValue) : null, minBookingAmount: rule.minBookingAmount ? Number(rule.minBookingAmount) : null, maxBookingAmount: rule.maxBookingAmount ? Number(rule.maxBookingAmount) : null },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'READ_ONLY');

// PUT: Update protection product rule
export const PUT = withAdmin(async (req: NextRequest, { admin, params }) => {
  try {
    const body = await req.json();
    if (body.fixedAmount !== undefined && body.fixedAmount !== null && body.fixedAmount < 0) {
      return NextResponse.json({ error: 'Amount cannot be negative' }, { status: 400 });
    }
    if (body.percentageValue !== undefined && body.percentageValue !== null && (body.percentageValue < 0 || body.percentageValue > 100)) {
      return NextResponse.json({ error: 'Percentage must be between 0 and 100' }, { status: 400 });
    }
    const existing = await prisma.protectionProductRule.findUnique({ where: { id: params.id } });
    if (!existing || existing.deletedAt) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

    const rule = await prisma.protectionProductRule.update({
      where: { id: params.id },
      data: {
        ...(body.providerName !== undefined && { providerName: body.providerName }),
        ...(body.providerProductCode !== undefined && { providerProductCode: body.providerProductCode }),
        ...(body.productName !== undefined && { productName: body.productName }),
        ...(body.productDescription !== undefined && { productDescription: body.productDescription }),
        ...(body.pricingModel !== undefined && { pricingModel: body.pricingModel }),
        ...(body.fixedAmount !== undefined && { fixedAmount: body.fixedAmount }),
        ...(body.percentageValue !== undefined && { percentageValue: body.percentageValue }),
        ...(body.currency !== undefined && { currency: body.currency }),
        ...(body.cabinScope !== undefined && { cabinScope: body.cabinScope }),
        ...(body.fareClassScope !== undefined && { fareClassScope: body.fareClassScope }),
        ...(body.tripTypeScope !== undefined && { tripTypeScope: body.tripTypeScope }),
        ...(body.routeScopeType !== undefined && { routeScopeType: body.routeScopeType }),
        ...(body.originCountry !== undefined && { originCountry: body.originCountry }),
        ...(body.destinationCountry !== undefined && { destinationCountry: body.destinationCountry }),
        ...(body.minBookingAmount !== undefined && { minBookingAmount: body.minBookingAmount }),
        ...(body.maxBookingAmount !== undefined && { maxBookingAmount: body.maxBookingAmount }),
        ...(body.appliesToAdult !== undefined && { appliesToAdult: body.appliesToAdult }),
        ...(body.appliesToChild !== undefined && { appliesToChild: body.appliesToChild }),
        ...(body.appliesToInfant !== undefined && { appliesToInfant: body.appliesToInfant }),
        ...(body.coverageSummary !== undefined && { coverageSummary: body.coverageSummary }),
        ...(body.termsUrl !== undefined && { termsUrl: body.termsUrl }),
        ...(body.active !== undefined && { active: body.active }),
        ...(body.effectiveFrom !== undefined && { effectiveFrom: new Date(body.effectiveFrom) }),
        ...(body.effectiveTo !== undefined && { effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null }),
        ...(body.priority !== undefined && { priority: body.priority }),
        updatedByAdminId: admin.sub,
        updatedByAdminEmail: admin.email,
      },
    });
    return NextResponse.json({ rule });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'OPS_ADMIN');

// DELETE: Soft-delete
export const DELETE = withAdmin(async (req: NextRequest, { admin, params }) => {
  try {
    const existing = await prisma.protectionProductRule.findUnique({ where: { id: params.id } });
    if (!existing || existing.deletedAt) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    await prisma.protectionProductRule.update({
      where: { id: params.id },
      data: { active: false, deletedAt: new Date(), deletedBy: admin.email, updatedByAdminId: admin.sub, updatedByAdminEmail: admin.email },
    });
    return NextResponse.json({ success: true, message: 'Rule soft-deleted' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'SUPER_ADMIN');
