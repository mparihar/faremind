import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withAdmin } from '@/lib/admin-rbac';

export const GET = withAdmin(async (req: NextRequest) => {
  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const email = url.searchParams.get('email');
  const errorCode = url.searchParams.get('errorCode');
  const resolved = url.searchParams.get('resolved'); // 'true' | 'false' | null
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '25', 10)));

  // Build where clause
  const where: Record<string, unknown> = {};

  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
    };
  }
  if (email) {
    where.customerEmail = { contains: email.toLowerCase(), mode: 'insensitive' };
  }
  if (errorCode) {
    where.errorCode = errorCode;
  }
  if (resolved === 'true') {
    where.resolvedAt = { not: null };
  } else if (resolved === 'false') {
    where.resolvedAt = null;
  }

  const [records, total] = await Promise.all([
    (prisma as any).bookingFailureAudit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    (prisma as any).bookingFailureAudit.count({ where }),
  ]);

  return NextResponse.json({
    records,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  });
}, 'SUPPORT');
