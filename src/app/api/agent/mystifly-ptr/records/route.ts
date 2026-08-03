import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withAgentServicing } from '@/lib/agent-auth';
import { resolveBookingByAnyRef } from '@/lib/resolve-booking';

/**
 * Agent Mystifly PTR Records API
 *
 * Returns PostTicketingRequest records for a given booking.
 * MYSTIFLY ONLY — Duffel does not use PTR.
 *
 * `bookingId` accepts anything that identifies the booking — the FareMind
 * reference or the airline PNR as well as the internal id — because the console
 * works in the codes people hold, not in cuids.
 *
 * That is exactly why this needs the agent session: a servicing history carries
 * quoted and refunded amounts, and an airline PNR is six characters. Keyed only
 * by an unguessable cuid it was awkward to enumerate; keyed by a PNR it would
 * not be.
 */
export const GET = withAgentServicing(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
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
    console.error('[Agent PTR Records] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch PTR records' }, { status: 500 });
  }
});
