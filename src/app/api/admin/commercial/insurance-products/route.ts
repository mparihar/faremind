import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

// GET: List all travel insurance rules
export const GET = withAdmin(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
    const limit    = Math.min(100, parseInt(searchParams.get('limit') ?? '20'));
    const active   = searchParams.get('active');
    const search   = searchParams.get('q') ?? '';

    const where: any = { deletedAt: null };
    if (active !== null && active !== '') where.active = active === 'true';
    if (search) {
      where.OR = [
        { planName: { contains: search, mode: 'insensitive' } },
        { insuranceProviderName: { contains: search, mode: 'insensitive' } },
        { planDescription: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [rules, total] = await Promise.all([
      prisma.travelInsuranceRule.findMany({
        where, take: limit, skip: (page - 1) * limit,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        include: {
          createdByAdmin: { select: { fullName: true, email: true } },
          updatedByAdmin: { select: { fullName: true, email: true } },
        },
      }),
      prisma.travelInsuranceRule.count({ where }),
    ]);

    const toNum = (v: any) => v ? Number(v) : null;
    return NextResponse.json({
      rules: rules.map(r => ({
        ...r,
        fixedAmount: toNum(r.fixedAmount), percentageValue: toNum(r.percentageValue),
        minBookingAmount: toNum(r.minBookingAmount), maxBookingAmount: toNum(r.maxBookingAmount),
        medicalCoverageAmount: toNum(r.medicalCoverageAmount),
        cancellationCoverageAmount: toNum(r.cancellationCoverageAmount),
        baggageCoverageAmount: toNum(r.baggageCoverageAmount),
      })),
      total, page, limit, pages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'READ_ONLY');

// POST: Create new travel insurance rule
export const POST = withAdmin(async (req: NextRequest, { admin }) => {
  try {
    const body = await req.json();
    if (!body.insuranceProviderName || !body.planName || !body.pricingModel) {
      return NextResponse.json({ error: 'insuranceProviderName, planName, and pricingModel are required' }, { status: 400 });
    }
    if (body.fixedAmount !== undefined && body.fixedAmount !== null && body.fixedAmount < 0) {
      return NextResponse.json({ error: 'Amount cannot be negative' }, { status: 400 });
    }
    if (body.pricingModel === 'PROVIDER_QUOTED' && !body.insuranceProviderName) {
      return NextResponse.json({ error: 'Provider name is required for provider-quoted pricing' }, { status: 400 });
    }

    const rule = await prisma.travelInsuranceRule.create({
      data: {
        insuranceProviderName: body.insuranceProviderName,
        providerProductCode: body.providerProductCode ?? null,
        planName: body.planName,
        planDescription: body.planDescription ?? null,
        pricingModel: body.pricingModel,
        fixedAmount: body.fixedAmount ?? null,
        percentageValue: body.percentageValue ?? null,
        currency: body.currency ?? 'USD',
        cabinScope: body.cabinScope ?? 'ALL',
        fareClassScope: body.fareClassScope ?? null,
        tripTypeScope: body.tripTypeScope ?? 'ALL',
        routeScopeType: body.routeScopeType ?? 'ALL',
        originCountry: body.originCountry ?? null,
        destinationCountry: body.destinationCountry ?? null,
        minBookingAmount: body.minBookingAmount ?? null,
        maxBookingAmount: body.maxBookingAmount ?? null,
        passengerTypeScope: body.passengerTypeScope ?? null,
        coverageSummary: body.coverageSummary ?? null,
        medicalCoverageAmount: body.medicalCoverageAmount ?? null,
        cancellationCoverageAmount: body.cancellationCoverageAmount ?? null,
        baggageCoverageAmount: body.baggageCoverageAmount ?? null,
        termsUrl: body.termsUrl ?? null,
        active: body.active ?? true,
        effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
        effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
        priority: body.priority ?? 1,
        createdByAdminId: admin.sub,
        createdByAdminEmail: admin.email,
      },
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'OPS_ADMIN');
