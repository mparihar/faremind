import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

export const GET = withAdmin(async (req: NextRequest, { params }: any) => {
  try {
    const id = params?.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    // Resolve booking to get both id and masterBookingReference
    const mb = await prisma.masterBooking.findFirst({
      where: { OR: [{ id }, { masterBookingReference: id }] },
      select: { id: true, masterBookingReference: true },
    });
    if (!mb) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { searchParams } = new URL(req.url);
    const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
    const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '50'));

    const where: any = {
      OR: [
        { bookingId: mb.id },
        { entityId: mb.id },
        { entityId: mb.masterBookingReference },
      ],
    };

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { createdAt: 'desc' },
        include: {
          adminUser: { select: { fullName: true, email: true, role: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return NextResponse.json({
      logs: logs.map(l => ({
        id: l.id,
        adminUser: l.adminUser ?? null,
        action: l.action,
        entityType: l.entityType,
        entityId: l.entityId,
        before: l.before,
        after: l.after,
        metadata: l.metadata,
        ipAddress: l.ipAddress,
        createdAt: l.createdAt,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    console.error('[admin/bookings/[id]/audit-logs] GET error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'SUPPORT');
