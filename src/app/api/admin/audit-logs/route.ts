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
}, 'OPS_ADMIN');
