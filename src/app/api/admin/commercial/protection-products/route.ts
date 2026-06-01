import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

// GET: List all protection product rules
export const GET = withAdmin(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
    const limit    = Math.min(100, parseInt(searchParams.get('limit') ?? '20'));
    const cabin    = searchParams.get('cabin') ?? '';
    const tripType = searchParams.get('tripType') ?? '';
    const pricing  = searchParams.get('pricingModel') ?? '';
    const active   = searchParams.get('active');
    const search   = searchParams.get('q') ?? '';

    const where: any = { deletedAt: null };

    if (cabin)    where.cabinScope = cabin;
    if (tripType) where.tripTypeScope = tripType;
    if (pricing)  where.pricingModel = pricing;
    if (active !== null && active !== '') where.active = active === 'true';
    if (search) {
      where.OR = [
        { productName: { contains: search, mode: 'insensitive' } },
        { providerName: { contains: search, mode: 'insensitive' } },
        { productDescription: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [rules, total] = await Promise.all([
      prisma.protectionProductRule.findMany({
        where, take: limit, skip: (page - 1) * limit,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        include: {
          createdByAdmin: { select: { fullName: true, email: true } },
          updatedByAdmin: { select: { fullName: true, email: true } },
        },
      }),
      prisma.protectionProductRule.count({ where }),
    ]);

    return NextResponse.json({
      rules: rules.map(r => ({
        ...r,
        fixedAmount: r.fixedAmount ? Number(r.fixedAmount) : null,
        percentageValue: r.percentageValue ? Number(r.percentageValue) : null,
        minBookingAmount: r.minBookingAmount ? Number(r.minBookingAmount) : null,
        maxBookingAmount: r.maxBookingAmount ? Number(r.maxBookingAmount) : null,
      })),
      total, page, limit, pages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    console.error('[admin/commercial/protection-products] GET error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'READ_ONLY');

// POST: Create new protection product rule
export const POST = withAdmin(async (req: NextRequest, { admin }) => {
  try {
    const body = await req.json();

    if (!body.productName || !body.pricingModel) {
      return NextResponse.json({ error: 'productName and pricingModel are required' }, { status: 400 });
    }
    if (body.fixedAmount !== undefined && body.fixedAmount !== null && body.fixedAmount < 0) {
      return NextResponse.json({ error: 'Amount cannot be negative' }, { status: 400 });
    }
    if (body.percentageValue !== undefined && body.percentageValue !== null && (body.percentageValue < 0 || body.percentageValue > 100)) {
      return NextResponse.json({ error: 'Percentage must be between 0 and 100' }, { status: 400 });
    }
    if (body.pricingModel === 'PROVIDER_QUOTED' && !body.providerName) {
      return NextResponse.json({ error: 'Provider name is required for provider-quoted pricing' }, { status: 400 });
    }

    const rule = await prisma.protectionProductRule.create({
      data: {
        productType: 'PRICE_DROP_PROTECTION',
        providerName: body.providerName ?? null,
        providerProductCode: body.providerProductCode ?? null,
        productName: body.productName,
        productDescription: body.productDescription ?? null,
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
        appliesToAdult: body.appliesToAdult ?? true,
        appliesToChild: body.appliesToChild ?? true,
        appliesToInfant: body.appliesToInfant ?? true,
        coverageSummary: body.coverageSummary ?? null,
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
    console.error('[admin/commercial/protection-products] POST error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'OPS_ADMIN');
