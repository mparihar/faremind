import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Agent Mystifly PTR Records API
 *
 * Returns PostTicketingRequest records for a given booking.
 * MYSTIFLY ONLY — Duffel does not use PTR.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
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
    console.error('[Agent PTR Records] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch PTR records' }, { status: 500 });
  }
}
