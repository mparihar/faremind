import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

export const GET = withAdmin(async (req: NextRequest, { params }) => {
  try {
    const rule = await prisma.travelInsuranceRule.findUnique({
      where: { id: params.id },
      include: {
        createdByAdmin: { select: { fullName: true, email: true } },
        updatedByAdmin: { select: { fullName: true, email: true } },
      },
    });
    if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    const toNum = (v: any) => v ? Number(v) : null;
    return NextResponse.json({
      rule: { ...rule, fixedAmount: toNum(rule.fixedAmount), percentageValue: toNum(rule.percentageValue), minBookingAmount: toNum(rule.minBookingAmount), maxBookingAmount: toNum(rule.maxBookingAmount), medicalCoverageAmount: toNum(rule.medicalCoverageAmount), cancellationCoverageAmount: toNum(rule.cancellationCoverageAmount), baggageCoverageAmount: toNum(rule.baggageCoverageAmount) },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'READ_ONLY');

export const PUT = withAdmin(async (req: NextRequest, { admin, params }) => {
  try {
    const body = await req.json();
    if (body.fixedAmount !== undefined && body.fixedAmount !== null && body.fixedAmount < 0) {
      return NextResponse.json({ error: 'Amount cannot be negative' }, { status: 400 });
    }
    const existing = await prisma.travelInsuranceRule.findUnique({ where: { id: params.id } });
    if (!existing || existing.deletedAt) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

    const rule = await prisma.travelInsuranceRule.update({
      where: { id: params.id },
      data: {
        ...(body.insuranceProviderName !== undefined && { insuranceProviderName: body.insuranceProviderName }),
        ...(body.providerProductCode !== undefined && { providerProductCode: body.providerProductCode }),
        ...(body.planName !== undefined && { planName: body.planName }),
        ...(body.planDescription !== undefined && { planDescription: body.planDescription }),
        ...(body.pricingModel !== undefined && { pricingModel: body.pricingModel }),
        ...(body.fixedAmount !== undefined && { fixedAmount: body.fixedAmount }),
        ...(body.percentageValue !== undefined && { percentageValue: body.percentageValue }),
        ...(body.currency !== undefined && { currency: body.currency }),
        ...(body.cabinScope !== undefined && { cabinScope: body.cabinScope }),
        ...(body.fareClassScope !== undefined && { fareClassScope: body.fareClassScope }),
        ...(body.tripTypeScope !== undefined && { tripTypeScope: body.tripTypeScope }),
        ...(body.routeScopeType !== undefined && { routeScopeType: body.routeScopeType }),
        ...(body.minBookingAmount !== undefined && { minBookingAmount: body.minBookingAmount }),
        ...(body.maxBookingAmount !== undefined && { maxBookingAmount: body.maxBookingAmount }),
        ...(body.passengerTypeScope !== undefined && { passengerTypeScope: body.passengerTypeScope }),
        ...(body.coverageSummary !== undefined && { coverageSummary: body.coverageSummary }),
        ...(body.medicalCoverageAmount !== undefined && { medicalCoverageAmount: body.medicalCoverageAmount }),
        ...(body.cancellationCoverageAmount !== undefined && { cancellationCoverageAmount: body.cancellationCoverageAmount }),
        ...(body.baggageCoverageAmount !== undefined && { baggageCoverageAmount: body.baggageCoverageAmount }),
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

export const DELETE = withAdmin(async (req: NextRequest, { admin, params }) => {
  try {
    const existing = await prisma.travelInsuranceRule.findUnique({ where: { id: params.id } });
    if (!existing || existing.deletedAt) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    await prisma.travelInsuranceRule.update({
      where: { id: params.id },
      data: { active: false, deletedAt: new Date(), deletedBy: admin.email, updatedByAdminId: admin.sub, updatedByAdminEmail: admin.email },
    });
    return NextResponse.json({ success: true, message: 'Rule soft-deleted' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'SUPER_ADMIN');
