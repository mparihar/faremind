import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

export const GET = withAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const page       = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit      = Math.min(100, parseInt(searchParams.get('limit') ?? '25'));
  const entityType = searchParams.get('entityType') ?? '';
  const entityId   = searchParams.get('entityId') ?? '';
  const adminId    = searchParams.get('adminId') ?? '';
  const action     = searchParams.get('action') ?? '';
  const from       = searchParams.get('from');
  const to         = searchParams.get('to');

  const where: Record<string, unknown> = {};
  if (entityType) where.entityType = entityType;
  if (entityId)   where.entityId   = entityId;
  if (adminId)    where.adminUserId = adminId;
  if (action)     where.action = { contains: action, mode: 'insensitive' };
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to) }   : {}),
    };
  }

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

  return NextResponse.json({ logs, total, page, limit, pages: Math.ceil(total / limit) });
}, 'SUPPORT');

// DELETE — Bulk delete audit logs within a date range
export const DELETE = withAdmin(async (req: NextRequest) => {
  try {
    const { from, to } = await req.json();
    if (!from || !to) {
      return NextResponse.json({ error: 'Missing "from" and "to" date range' }, { status: 400 });
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    const result = await prisma.auditLog.deleteMany({
      where: {
        createdAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
    });

    return NextResponse.json({ success: true, deletedCount: result.count });
  } catch (err: any) {
    console.error('[audit-logs] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete audit logs' }, { status: 500 });
  }
}, 'SUPER_ADMIN');
