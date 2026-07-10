import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

/**
 * GET /api/admin/operations/provider-errors
 * Returns recent provider API error payloads (last 24h).
 */
export const GET = withAdmin(async (req: NextRequest) => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const errors = await prisma.bookingProviderPayload.findMany({
      where: {
        createdAt: { gte: twentyFourHoursAgo },
      },
      include: {
        booking: {
          select: {
            masterBookingReference: true,
            customerEmail: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Filter to only include payloads that have error data
    const errorPayloads = errors.filter(p => {
      const json = p.payloadJson as any;
      return json?.error || json?.response?.Error || json?.response?.Data?.Error;
    });

    return NextResponse.json({ errors: errorPayloads });
  } catch (err: any) {
    console.error('[Admin Operations] Provider errors fetch error:', err.message);
    return NextResponse.json({ error: 'Failed to load provider errors' }, { status: 500 });
  }
}, 'SUPPORT');
