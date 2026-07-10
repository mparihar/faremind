import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

/**
 * GET /api/admin/fare-management
 * List all fare inventory rules.
 */
export const GET = withAdmin(async (req: NextRequest) => {
  try {
    const rules = await prisma.providerFareInventoryRule.findMany({
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return NextResponse.json({ rules });
  } catch (err: any) {
    console.error('[Fare Management] List error:', err.message);
    return NextResponse.json({ error: 'Failed to load fare rules' }, { status: 500 });
  }
}, 'SUPPORT');

/**
 * POST /api/admin/fare-management
 * Create a new fare inventory rule.
 */
export const POST = withAdmin(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const {
      ruleName, fareType, originAirport, destinationAirport,
      airlineCode, airlineName, searchVersion, target,
      isActive, priority, holdAllowed, holdDurationMinutes, notes,
    } = body;

    if (!ruleName || !fareType) {
      return NextResponse.json({ error: 'ruleName and fareType are required' }, { status: 400 });
    }

    const rule = await prisma.providerFareInventoryRule.create({
      data: {
        provider: 'MYSTIFLY',
        ruleName,
        fareType,
        originAirport: originAirport || null,
        destinationAirport: destinationAirport || null,
        airlineCode: airlineCode || null,
        airlineName: airlineName || null,
        searchVersion: searchVersion || 'v2.2',
        target: target || 'Test',
        isActive: isActive ?? true,
        priority: priority || 1,
        holdAllowed: holdAllowed ?? false,
        holdDurationMinutes: holdDurationMinutes || null,
        notes: notes || null,
      },
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (err: any) {
    console.error('[Fare Management] Create error:', err.message);
    return NextResponse.json({ error: 'Failed to create fare rule' }, { status: 500 });
  }
}, 'OPS_ADMIN');
