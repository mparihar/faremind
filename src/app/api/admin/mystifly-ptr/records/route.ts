// FILE: src/app/api/admin/mystifly-ptr/records/route.ts
// Admin Mystifly PTR Records API — returns PostTicketingRequest records for a booking.
// MYSTIFLY ONLY — Duffel does not use PTR. Mirrors the agent records endpoint but
// gated by admin RBAC (SUPPORT+).
// `bookingId` accepts anything that identifies the booking — the FareMind
// reference or the airline PNR as well as the internal id — because the console
// works in the codes people hold, not in cuids.
import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import prisma from '@/lib/db';
import { resolveBookingByAnyRef } from '@/lib/resolve-booking';

export const GET = withAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const ref = searchParams.get('bookingId')?.trim();

  if (!ref) {
    return NextResponse.json({ error: 'bookingId is required' }, { status: 400 });
  }

  try {
    const booking = await resolveBookingByAnyRef(ref);
    if (!booking) return NextResponse.json({ records: [] });

    const records = await prisma.postTicketingRequest.findMany({
      where: { bookingId: booking.id, provider: 'MYSTIFLY' },
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
