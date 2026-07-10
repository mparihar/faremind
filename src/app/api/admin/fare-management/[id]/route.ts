import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

/**
 * PUT /api/admin/fare-management/[id]
 * Update an existing fare inventory rule.
 */
export const PUT = withAdmin(async (req: NextRequest, context: any) => {
  try {
    const id = (await context.params).id;
    const body = await req.json();

    const existing = await prisma.providerFareInventoryRule.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    const rule = await prisma.providerFareInventoryRule.update({
      where: { id },
      data: {
        ...(body.ruleName !== undefined && { ruleName: body.ruleName }),
        ...(body.fareType !== undefined && { fareType: body.fareType }),
        ...(body.originAirport !== undefined && { originAirport: body.originAirport || null }),
        ...(body.destinationAirport !== undefined && { destinationAirport: body.destinationAirport || null }),
        ...(body.airlineCode !== undefined && { airlineCode: body.airlineCode || null }),
        ...(body.airlineName !== undefined && { airlineName: body.airlineName || null }),
        ...(body.searchVersion !== undefined && { searchVersion: body.searchVersion }),
        ...(body.target !== undefined && { target: body.target }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.priority !== undefined && { priority: body.priority }),
        ...(body.holdAllowed !== undefined && { holdAllowed: body.holdAllowed }),
        ...(body.holdDurationMinutes !== undefined && { holdDurationMinutes: body.holdDurationMinutes }),
        ...(body.notes !== undefined && { notes: body.notes || null }),
      },
    });

    return NextResponse.json({ rule });
  } catch (err: any) {
    console.error('[Fare Management] Update error:', err.message);
    return NextResponse.json({ error: 'Failed to update fare rule' }, { status: 500 });
  }
}, 'OPS_ADMIN');

/**
 * DELETE /api/admin/fare-management/[id]
 * Delete a fare inventory rule.
 */
export const DELETE = withAdmin(async (req: NextRequest, context: any) => {
  try {
    const id = (await context.params).id;

    const existing = await prisma.providerFareInventoryRule.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    await prisma.providerFareInventoryRule.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[Fare Management] Delete error:', err.message);
    return NextResponse.json({ error: 'Failed to delete fare rule' }, { status: 500 });
  }
}, 'OPS_ADMIN');
