import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

/**
 * GET /api/admin/customers
 * List all customer (non-admin) users with search, filter, pagination.
 */
export const GET = withAdmin(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const page   = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'));
    const limit  = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20')));
    const q      = url.searchParams.get('q')?.trim() ?? '';
    const status = url.searchParams.get('status') ?? ''; // active | inactive | all
    const sort   = url.searchParams.get('sort') ?? 'createdAt';
    const order  = url.searchParams.get('order') === 'asc' ? 'asc' : 'desc';

    // Build where clause
    const where: any = {};

    if (q) {
      where.OR = [
        { email:     { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName:  { contains: q, mode: 'insensitive' } },
        { phone:     { contains: q, mode: 'insensitive' } },
      ];
    }

    if (status === 'active')   where.isActive = true;
    if (status === 'inactive') where.isActive = false;

    // Sorting
    const validSorts = ['createdAt', 'email', 'firstName', 'lastLoginAt'];
    const orderBy = validSorts.includes(sort) ? { [sort]: order } : { createdAt: 'desc' };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id:            true,
          email:         true,
          firstName:     true,
          lastName:      true,
          phone:         true,
          role:          true,
          emailVerified: true,
          isActive:      true,
          createdAt:     true,
          lastLoginAt:   true,
          _count: {
            select: {
              masterBookings: true,
              sessions:       true,
            },
          },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return NextResponse.json({
      users: users.map(u => ({
        id:            u.id,
        email:         u.email,
        firstName:     u.firstName,
        lastName:      u.lastName,
        phone:         u.phone,
        role:          u.role,
        emailVerified: u.emailVerified,
        isActive:      u.isActive,
        createdAt:     u.createdAt,
        lastLoginAt:   u.lastLoginAt,
        bookingCount:  u._count.masterBookings,
        sessionCount:  u._count.sessions,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    console.error('[admin/customers GET] Error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to load customers' }, { status: 500 });
  }
}, 'SUPPORT');
