import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

// GET: Get single platform fee rule
export const GET = withAdmin(async (req: NextRequest, { params }) => {
  try {
    const rule = await prisma.platformFeeRule.findUnique({
      where: { id: params.id },
      include: {
        createdByAdmin: { select: { fullName: true, email: true } },
        updatedByAdmin: { select: { fullName: true, email: true } },
      },
    });

    if (!rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({
      rule: {
        ...rule,
        fixedAmount: rule.fixedAmount ? Number(rule.fixedAmount) : null,
        percentageValue: rule.percentageValue ? Number(rule.percentageValue) : null,
      },
    });
  } catch (err: any) {
    console.error('[admin/commercial/platform-fees/[id]] GET error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'READ_ONLY');

// PUT: Update platform fee rule
export const PUT = withAdmin(async (req: NextRequest, { admin, params }) => {
  try {
    const body = await req.json();

    // Validate fee amount
    if (body.fixedAmount !== undefined && body.fixedAmount !== null && body.fixedAmount < 0) {
      return NextResponse.json({ error: 'Fee amount cannot be negative' }, { status: 400 });
    }

    // Validate percentage
    if (body.percentageValue !== undefined && body.percentageValue !== null) {
      if (body.percentageValue < 0 || body.percentageValue > 100) {
        return NextResponse.json({ error: 'Percentage must be between 0 and 100' }, { status: 400 });
      }
    }

    // Validate markup is never display_to_customer
    if (body.feeType === 'MARKUP_FEE' && body.displayToCustomer === true) {
      return NextResponse.json({ error: 'Markup fee must not be displayed to customer' }, { status: 400 });
    }

    const existing = await prisma.platformFeeRule.findUnique({ where: { id: params.id } });
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    const rule = await prisma.platformFeeRule.update({
      where: { id: params.id },
      data: {
        ...(body.feeName !== undefined && { feeName: body.feeName }),
        ...(body.feeDescription !== undefined && { feeDescription: body.feeDescription }),
        ...(body.calculationModel !== undefined && { calculationModel: body.calculationModel }),
        ...(body.fixedAmount !== undefined && { fixedAmount: body.fixedAmount }),
        ...(body.percentageValue !== undefined && { percentageValue: body.percentageValue }),
        ...(body.currency !== undefined && { currency: body.currency }),
        ...(body.appliesToAdult !== undefined && { appliesToAdult: body.appliesToAdult }),
        ...(body.appliesToChild !== undefined && { appliesToChild: body.appliesToChild }),
        ...(body.appliesToInfant !== undefined && { appliesToInfant: body.appliesToInfant }),
        ...(body.providerScope !== undefined && { providerScope: body.providerScope }),
        ...(body.cabinScope !== undefined && { cabinScope: body.cabinScope }),
        ...(body.tripTypeScope !== undefined && { tripTypeScope: body.tripTypeScope }),
        ...(body.routeScopeType !== undefined && { routeScopeType: body.routeScopeType }),
        ...(body.originCountry !== undefined && { originCountry: body.originCountry }),
        ...(body.destinationCountry !== undefined && { destinationCountry: body.destinationCountry }),
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
    console.error('[admin/commercial/platform-fees/[id]] PUT error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'OPS_ADMIN');

// DELETE: Soft-delete platform fee rule
export const DELETE = withAdmin(async (req: NextRequest, { admin, params }) => {
  try {
    const existing = await prisma.platformFeeRule.findUnique({ where: { id: params.id } });
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    await prisma.platformFeeRule.update({
      where: { id: params.id },
      data: {
        active: false,
        deletedAt: new Date(),
        deletedBy: admin.email,
        updatedByAdminId: admin.sub,
        updatedByAdminEmail: admin.email,
      },
    });

    return NextResponse.json({ success: true, message: 'Rule soft-deleted' });
  } catch (err: any) {
    console.error('[admin/commercial/platform-fees/[id]] DELETE error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'SUPER_ADMIN');
