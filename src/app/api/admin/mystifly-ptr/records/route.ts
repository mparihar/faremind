// FILE: src/app/api/admin/mystifly-ptr/records/route.ts
// Admin Mystifly PTR Records API — returns PostTicketingRequest records for a booking.
// MYSTIFLY ONLY — Duffel does not use PTR. Mirrors the agent records endpoint but
// gated by admin RBAC (SUPPORT+).
import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import prisma from '@/lib/db';

export const GET = withAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const bookingId = searchParams.get('bookingId')?.trim();

  if (!bookingId) {
    return NextResponse.json({ error: 'bookingId is required' }, { status: 400 });
  }

  try {
    const records = await prisma.postTicketingRequest.findMany({
      where: { bookingId, provider: 'MYSTIFLY' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({
      records: records.map(r => ({
        ...r,
        quoteTotalAmount: r.quoteTotalAmount ? Number(r.quoteTotalAmount) : null,
        quotePenaltyAmount: r.quotePenaltyAmount ? Number(r.quotePenaltyAmount) : null,
        quoteRefundAmount: r.quoteRefundAmount ? Number(r.quoteRefundAmount) : null,
      })),
    });
  } catch (error) {
    console.error('[Admin PTR Records] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch PTR records' }, { status: 500 });
  }
}, 'SUPPORT');
