import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

// GET: List all platform fee rules (with pagination and filters)
export const GET = withAdmin(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
    const limit    = Math.min(100, parseInt(searchParams.get('limit') ?? '20'));
    const feeType  = searchParams.get('feeType') ?? '';
    const provider = searchParams.get('provider') ?? '';
    const cabin    = searchParams.get('cabin') ?? '';
    const tripType = searchParams.get('tripType') ?? '';
    const active   = searchParams.get('active');
    const search   = searchParams.get('q') ?? '';

    const where: any = { deletedAt: null };

    if (feeType)  where.feeType = feeType;
    if (provider) where.providerScope = provider;
    if (cabin)    where.cabinScope = cabin;
    if (tripType) where.tripTypeScope = tripType;
    if (active !== null && active !== '') {
      where.active = active === 'true';
    }
    if (search) {
      where.OR = [
        { feeName: { contains: search, mode: 'insensitive' } },
        { feeDescription: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [rules, total] = await Promise.all([
      prisma.platformFeeRule.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        include: {
          createdByAdmin: { select: { fullName: true, email: true } },
          updatedByAdmin: { select: { fullName: true, email: true } },
        },
      }),
      prisma.platformFeeRule.count({ where }),
    ]);

    return NextResponse.json({
      rules: rules.map(r => ({
        ...r,
        fixedAmount: r.fixedAmount ? Number(r.fixedAmount) : null,
        percentageValue: r.percentageValue ? Number(r.percentageValue) : null,
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    console.error('[admin/commercial/platform-fees] GET error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'READ_ONLY');

// POST: Create new platform fee rule
export const POST = withAdmin(async (req: NextRequest, { admin }) => {
  try {
    const body = await req.json();

    // Validate required fields
    if (!body.feeType || !body.feeName || !body.calculationModel) {
      return NextResponse.json({ error: 'feeType, feeName, and calculationModel are required' }, { status: 400 });
    }

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

    // Validate calculation model has required amount fields
    const needsFixed = ['FIXED_PER_BOOKING', 'FIXED_PER_TRAVELER', 'HYBRID'].includes(body.calculationModel);
    const needsPercent = ['PERCENTAGE_OF_FARE', 'PERCENTAGE_OF_BOOKING_TOTAL', 'HYBRID'].includes(body.calculationModel);

    if (needsFixed && (body.fixedAmount === undefined || body.fixedAmount === null)) {
      return NextResponse.json({ error: 'Fixed amount is required for this calculation model' }, { status: 400 });
    }
    if (needsPercent && (body.percentageValue === undefined || body.percentageValue === null)) {
      return NextResponse.json({ error: 'Percentage value is required for this calculation model' }, { status: 400 });
    }

    // Validate markup is never display_to_customer
    if (body.feeType === 'MARKUP_FEE' && body.displayToCustomer === true) {
      return NextResponse.json({ error: 'Markup fee must not be displayed to customer' }, { status: 400 });
    }

    const rule = await prisma.platformFeeRule.create({
      data: {
        feeType: body.feeType,
        feeName: body.feeName,
        feeDescription: body.feeDescription ?? null,
        calculationModel: body.calculationModel,
        fixedAmount: body.fixedAmount ?? null,
        percentageValue: body.percentageValue ?? null,
        currency: body.currency ?? 'USD',
        appliesToAdult: body.appliesToAdult ?? true,
        appliesToChild: body.appliesToChild ?? true,
        appliesToInfant: body.appliesToInfant ?? true,
        providerScope: body.providerScope ?? 'ALL',
        cabinScope: body.cabinScope ?? 'ALL',
        tripTypeScope: body.tripTypeScope ?? 'ALL',
        routeScopeType: body.routeScopeType ?? 'ALL',
        originCountry: body.originCountry ?? null,
        destinationCountry: body.destinationCountry ?? null,
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
    console.error('[admin/commercial/platform-fees] POST error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'OPS_ADMIN');
