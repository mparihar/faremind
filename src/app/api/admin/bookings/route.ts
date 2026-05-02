import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

export const GET = withAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit  = Math.min(100, parseInt(searchParams.get('limit') ?? '20'));
  const search = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const from   = searchParams.get('from');
  const to     = searchParams.get('to');

  const where: Record<string, unknown> = {};

  if (status) where.status = status;
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to) }   : {}),
    };
  }
  if (search) {
    where.OR = [
      { pnr: { contains: search, mode: 'insensitive' } },
      { user: { email: { contains: search, mode: 'insensitive' } } },
      { user: { firstName: { contains: search, mode: 'insensitive' } } },
      { user: { lastName: { contains: search, mode: 'insensitive' } } },
      { originAirport: { contains: search.toUpperCase() } },
      { destinationAirport: { contains: search.toUpperCase() } },
    ];
  }

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      take: limit,
      skip: (page - 1) * limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        payments: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { status: true, amount: true, currency: true },
        },
        passengers: { select: { id: true, firstName: true, lastName: true, type: true } },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  return NextResponse.json({ bookings, total, page, limit, pages: Math.ceil(total / limit) });
}, 'READ_ONLY');
