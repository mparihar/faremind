// FILE: src/app/api/agent/bookings/[fbr]/force-cancel/route.ts
// Agent "Force Cancel + Refund" — same orchestration as admin, scoped to bookings the
// agent owns. Runs provider execute (PTR) → Stripe refund → status via the backend.
import { NextRequest, NextResponse } from 'next/server';
import { withAgent } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

export const POST = withAgent(async (req: NextRequest, { agent, params }: any) => {
  try {
    const fbr = params?.fbr;
    if (!fbr) return NextResponse.json({ error: 'Missing booking reference' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const { overrideRefundAmount, refundMethod, reason, mode } = body || {};
    const isQuoteOnly = mode === 'quote';

    // `fbr` may be the masterBookingReference OR the MasterBooking id (the agent
    // post-booking console works off the booking id).
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
    const res = await fetch(`${BACKEND_URL}/api/manage-booking/${booking.id}/force-cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        overrideRefundAmount: typeof overrideRefundAmount === 'number' ? overrideRefundAmount : undefined,
        refundMethod: refundMethod || 'ORIGINAL_PAYMENT',
        requestedBy: actor,
        role: 'AGENT',
        mode,
      }),
    });
    const data = await res.json().catch(() => ({}));

    // Quote-only: return the live quote for the confirm modal, no logging/audit.
    if (isQuoteOnly) return NextResponse.json(data, { status: res.ok ? 200 : res.status });

    console.log(`[Agent][ForceCancel] agent=${actor} bookingRef=${booking.masterBookingReference} httpStatus=${res.status} success=${data?.success} refundAmount=${data?.refundAmount ?? data?.netRefundAmount ?? 'n/a'}`);

    await prisma.bookingEvent.create({
      data: {
        bookingId: booking.id,
        eventType: 'FORCE_CANCELLATION',
        eventTitle: 'Force Cancel + Refund triggered by agent',
        eventDescription: `Agent ${actor} triggered Force Cancel + Refund. Override refund: ${overrideRefundAmount ?? 'auto'}. Reason: ${reason || 'N/A'}. Result: ${res.ok ? 'success' : 'failed'}.`,
        actorType: 'agent',
        actorId: agent.id,
        actorName: actor,
        payloadJson: { overrideRefundAmount: overrideRefundAmount ?? null, reason: reason ?? null, result: data },
      },
    }).catch(() => {});

    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (err: any) {
    console.error('[agent/force-cancel] Error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
});
