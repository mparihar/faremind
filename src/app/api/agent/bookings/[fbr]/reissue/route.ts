// FILE: src/app/api/agent/bookings/[fbr]/reissue/route.ts
// Agent "Reissue + Collect Difference" — owner-scoped. Quotes (mode:'quote') or
// executes the reissue (charge customer + provider reissue) via the backend.
import { NextRequest, NextResponse } from 'next/server';
import { withAgent } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

export const POST = withAgent(async (req: NextRequest, { agent, params }: any) => {
  try {
    const fbr = params?.fbr;
    if (!fbr) return NextResponse.json({ error: 'Missing booking reference' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const { newFareSourceCode, mode, reason } = body || {};
    if (!newFareSourceCode) return NextResponse.json({ error: 'newFareSourceCode is required' }, { status: 400 });
    const isQuoteOnly = mode === 'quote';

    // `fbr` may be the masterBookingReference OR the MasterBooking id.
    const booking = await prisma.masterBooking.findFirst({
      where: {
        AND: [
          { OR: [{ masterBookingReference: fbr }, { id: fbr }] },
          { OR: [{ agentUserId: agent.id }, { userId: agent.id }] },
        ],
      },
      select: { id: true, masterBookingReference: true, bookingStatus: true },
    });
    if (!booking) return NextResponse.json({ error: 'Booking not found or access denied' }, { status: 404 });

    const actor = (agent as any).email || agent.id;
    const res = await fetch(`${BACKEND_URL}/api/manage-booking/${booking.id}/reissue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newFareSourceCode, mode, requestedBy: actor, role: 'AGENT' }),
    });
    const data = await res.json().catch(() => ({}));

    if (isQuoteOnly) return NextResponse.json(data, { status: res.ok ? 200 : res.status });

    console.log(`[Agent][Reissue] agent=${actor} bookingRef=${booking.masterBookingReference} httpStatus=${res.status} success=${data?.success} collected=${data?.collected ?? 'n/a'} ptr=${data?.ptrNumber ?? 'n/a'}`);

    await prisma.bookingEvent.create({
      data: {
        bookingId: booking.id,
        eventType: 'REISSUE',
        eventTitle: 'Reissue + Collect Difference triggered by agent',
        eventDescription: `Agent ${actor} triggered a reissue. Collected: ${data?.collected ?? '—'} USD. PTR: ${data?.ptrNumber ?? '—'}. Reason: ${reason || 'N/A'}. Result: ${res.ok ? 'success' : 'failed'}.`,
        actorType: 'agent',
        actorId: agent.id,
        actorName: actor,
        payloadJson: { newFareSourceCode, reason: reason ?? null, result: data },
      },
    }).catch(() => {});

    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (err: any) {
    console.error('[agent/reissue] Error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
});
